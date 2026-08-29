/**
 * Repackage a browser voice recording as Ogg/Opus for WhatsApp.
 *
 * Meta accepts audio/ogg only when the codec inside is Opus, and rejects
 * audio/webm outright. Chrome's MediaRecorder can only produce
 * `audio/webm;codecs=opus` — the Opus frames it makes are exactly the ones
 * WhatsApp wants, sitting in the one container it will not take.
 *
 * So this is a remux, not a transcode: the encoded packets are lifted out of
 * the WebM/Matroska stream and rewritten into Ogg pages untouched. No decode,
 * no re-encode, no quality loss, and no ffmpeg — which matters, because the
 * API host would otherwise need a system binary installed before anyone could
 * send a voice note.
 */

/* Ogg's CRC is the plain (non-reflected) CRC-32, unlike almost every other
   CRC-32 in use — same polynomial, but no input/output reflection and no
   final xor. Getting this wrong produces a file every player silently
   refuses, so it is built from the polynomial rather than copied. */
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let r = i << 24;
        for (let bit = 0; bit < 8; bit++) {
            r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
        }
        table[i] = r >>> 0;
    }
    return table;
})();

function oggCrc(buf) {
    let crc = 0;
    for (let i = 0; i < buf.length; i++) {
        crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ buf[i]) & 0xff]) >>> 0;
    }
    return crc >>> 0;
}

/* ── Matroska (WebM) ─────────────────────────────────────────────────────── */

const ID_SEGMENT = 0x18538067;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_AUDIO = 0xe1;
const ID_CHANNELS = 0x9f;
const ID_CODEC_ID = 0x86;
const ID_CODEC_PRIVATE = 0x63a2;
const ID_CLUSTER = 0x1f43b675;
const ID_BLOCK_GROUP = 0xa0;
const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK = 0xa1;

const MASTER_IDS = new Set([ID_SEGMENT, ID_TRACKS, ID_TRACK_ENTRY, ID_AUDIO, ID_CLUSTER, ID_BLOCK_GROUP]);

/**
 * Read one EBML variable-length integer.
 *
 * Element ids keep their marker bit (that is how the spec writes them);
 * sizes have it stripped. A size whose value bits are all 1 means "unknown",
 * which live-recorded WebM uses for Segment and Cluster because the length is
 * not known until recording stops.
 */
function readVint(buf, pos, stripMarker) {
    if (pos >= buf.length) return null;
    const first = buf[pos];
    if (first === 0) return null; // 8+ byte vint: not produced by any recorder

    let length = 1;
    let mask = 0x80;
    while (!(first & mask)) { mask >>= 1; length++; }
    if (pos + length > buf.length) return null;

    let value = stripMarker ? (first & (mask - 1)) : first;
    let unknown = stripMarker && (first & (mask - 1)) === (mask - 1);
    for (let i = 1; i < length; i++) {
        value = value * 256 + buf[pos + i];
        if (buf[pos + i] !== 0xff) unknown = false;
    }
    return { value, length, unknown };
}

/** Walk the element tree, collecting the codec header and every block. */
function parseWebm(buf) {
    const found = { codecId: '', codecPrivate: null, channels: 0, blocks: [] };

    const walk = (start, end) => {
        let pos = start;
        while (pos < end) {
            const id = readVint(buf, pos, false);
            if (!id) return;
            const sizePos = pos + id.length;
            const size = readVint(buf, sizePos, true);
            if (!size) return;

            const bodyStart = sizePos + size.length;
            // An unknown-length master element runs to the end of its parent.
            const bodyEnd = size.unknown ? end : Math.min(bodyStart + size.value, end);
            if (bodyStart > end) return;

            if (MASTER_IDS.has(id.value)) {
                walk(bodyStart, bodyEnd);
            } else if (id.value === ID_CODEC_ID) {
                found.codecId = buf.toString('ascii', bodyStart, bodyEnd).replace(/\0+$/, '');
            } else if (id.value === ID_CODEC_PRIVATE) {
                found.codecPrivate = buf.subarray(bodyStart, bodyEnd);
            } else if (id.value === ID_CHANNELS) {
                let n = 0;
                for (let i = bodyStart; i < bodyEnd; i++) n = n * 256 + buf[i];
                found.channels = n;
            } else if (id.value === ID_SIMPLE_BLOCK || id.value === ID_BLOCK) {
                found.blocks.push(buf.subarray(bodyStart, bodyEnd));
            }

            pos = bodyEnd;
            if (size.unknown && MASTER_IDS.has(id.value)) return;
        }
    };

    walk(0, buf.length);
    return found;
}

/**
 * Split one block into its frames.
 *
 * Recorders do not lace audio, so in practice every block holds a single
 * frame — but all four lacing modes are handled, because a block silently
 * misread as one frame produces noise rather than an error.
 */
function framesFromBlock(block) {
    const track = readVint(block, 0, true);
    if (!track) return [];
    let pos = track.length + 2; // + int16 timecode
    if (pos >= block.length) return [];
    const flags = block[pos];
    pos += 1;

    const lacing = (flags >> 1) & 0x03;
    if (lacing === 0) return [block.subarray(pos)];

    const count = block[pos] + 1;
    pos += 1;
    const sizes = [];

    if (lacing === 2) {
        // Fixed: every frame the same size.
        const each = Math.floor((block.length - pos) / count);
        for (let i = 0; i < count; i++) sizes.push(each);
    } else if (lacing === 1) {
        // Xiph: sizes as runs of 255.
        for (let i = 0; i < count - 1; i++) {
            let size = 0;
            while (pos < block.length) {
                size += block[pos];
                if (block[pos++] !== 255) break;
            }
            sizes.push(size);
        }
    } else {
        // EBML: first size absolute, the rest signed deltas.
        const first = readVint(block, pos, true);
        if (!first) return [];
        pos += first.length;
        sizes.push(first.value);
        for (let i = 1; i < count - 1; i++) {
            const delta = readVint(block, pos, true);
            if (!delta) return [];
            pos += delta.length;
            // Signed vint: biased by half its range.
            sizes.push(sizes[i - 1] + (delta.value - (2 ** (7 * delta.length - 1) - 1)));
        }
    }

    const frames = [];
    for (const size of sizes) {
        if (pos + size > block.length) break;
        frames.push(block.subarray(pos, pos + size));
        pos += size;
    }
    // The last frame runs to the end of the block in every mode but fixed.
    if (lacing !== 2 && pos < block.length) frames.push(block.subarray(pos));
    return frames;
}

/**
 * How many samples one Opus packet holds, at Opus's fixed 48 kHz clock.
 *
 * Read from the packet's own table-of-contents byte. Needed for the Ogg
 * granule position, which is what a player reads the duration from — get it
 * wrong and a perfectly good recording shows as 0:00 and refuses to seek.
 */
export function opusPacketSamples(packet) {
    if (!packet || packet.length === 0) return 0;
    const toc = packet[0];
    const config = toc >> 3;

    let perFrame;
    if (config < 12) {
        // SILK: 10, 20, 40, 60 ms, repeating across three bandwidths.
        perFrame = [480, 960, 1920, 2880][config % 4];
    } else if (config < 16) {
        // Hybrid: 10 or 20 ms.
        perFrame = config % 2 === 0 ? 480 : 960;
    } else {
        // CELT: 2.5, 5, 10, 20 ms.
        perFrame = [120, 240, 480, 960][config % 4];
    }

    const code = toc & 3;
    let frames;
    if (code === 0) frames = 1;
    else if (code === 1 || code === 2) frames = 2;
    else frames = packet.length > 1 ? (packet[1] & 0x3f) : 1;

    return perFrame * frames;
}

/* ── Ogg ─────────────────────────────────────────────────────────────────── */

function oggPage({ serial, sequence, headerType, granule, packets }) {
    const segments = [];
    for (const packet of packets) {
        let remaining = packet.length;
        while (remaining >= 255) { segments.push(255); remaining -= 255; }
        // A packet that is an exact multiple of 255 still needs this 0, or the
        // next packet is read as a continuation of it.
        segments.push(remaining);
    }

    const header = Buffer.alloc(27 + segments.length);
    header.write('OggS', 0, 'ascii');
    header[4] = 0;
    header[5] = headerType;
    header.writeUInt32LE(granule >>> 0, 6);
    header.writeUInt32LE(Math.floor(granule / 4294967296), 10);
    header.writeUInt32LE(serial, 14);
    header.writeUInt32LE(sequence, 18);
    header.writeUInt32LE(0, 22); // CRC, filled in over the finished page
    header[26] = segments.length;
    for (let i = 0; i < segments.length; i++) header[27 + i] = segments[i];

    const page = Buffer.concat([header, ...packets]);
    page.writeUInt32LE(oggCrc(page), 22);
    return page;
}

function opusHead(channels) {
    const head = Buffer.alloc(19);
    head.write('OpusHead', 0, 'ascii');
    head[8] = 1;                       // version
    head[9] = channels;
    head.writeUInt16LE(3840, 10);      // pre-skip
    head.writeUInt32LE(48000, 12);     // original sample rate
    head.writeInt16LE(0, 16);          // output gain
    head[18] = 0;                      // channel mapping family
    return head;
}

function opusTags() {
    const vendor = Buffer.from('purplebox', 'utf8');
    const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
    tags.write('OpusTags', 0, 'ascii');
    tags.writeUInt32LE(vendor.length, 8);
    vendor.copy(tags, 12);
    tags.writeUInt32LE(0, 12 + vendor.length); // no comments
    return tags;
}

/** Mime types Meta will accept as-is, so nothing is done to them. */
const WHATSAPP_READY_AUDIO = /^audio\/(ogg|mpeg|mp4|aac|amr)\b/i;

export function needsRemux(mimeType) {
    const mime = String(mimeType || '').toLowerCase();
    if (!mime.startsWith('audio/') && !mime.startsWith('video/webm')) return false;
    if (WHATSAPP_READY_AUDIO.test(mime)) return false;
    return /webm|x-matroska/.test(mime);
}

/**
 * Lift the Opus packets out of a WebM buffer and rewrite them as Ogg.
 *
 * Throws rather than returning something half-valid: a corrupt voice note
 * that WhatsApp accepts and then shows as a broken bubble is worse than a
 * clear failure at the point of sending.
 */
export function webmToOggOpus(buffer) {
    if (!buffer || buffer.length === 0) throw new Error('The recording is empty');

    const parsed = parseWebm(buffer);
    if (parsed.codecId && !/opus/i.test(parsed.codecId)) {
        throw new Error(`This recording is ${parsed.codecId}, and only Opus can be sent to WhatsApp`);
    }

    const packets = [];
    for (const block of parsed.blocks) {
        for (const frame of framesFromBlock(block)) {
            if (frame.length > 0) packets.push(frame);
        }
    }
    if (packets.length === 0) throw new Error('No audio was found in the recording');

    // The recorder's own OpusHead is preferred — it carries the real channel
    // count and pre-skip. Synthesised only when the file has none.
    const head = parsed.codecPrivate?.length >= 19 && parsed.codecPrivate.toString('ascii', 0, 8) === 'OpusHead'
        ? Buffer.from(parsed.codecPrivate)
        : opusHead(parsed.channels || 1);
    const preSkip = head.readUInt16LE(10);

    // A fixed serial is fine: each file is a single stream on its own.
    const serial = 0x50427831; // "PBx1"
    const out = [
        oggPage({ serial, sequence: 0, headerType: 0x02, granule: 0, packets: [head] }),
        oggPage({ serial, sequence: 1, headerType: 0x00, granule: 0, packets: [opusTags()] }),
    ];

    // Pack packets into pages, respecting the 255-segment ceiling. The page's
    // granule is that of the last packet finishing on it.
    const pages = [];
    let current = [];
    let currentSegments = 0;
    let granule = preSkip;
    let pageGranule = preSkip;

    for (const packet of packets) {
        const needed = Math.floor(packet.length / 255) + 1;
        if (currentSegments + needed > 255) {
            pages.push({ packets: current, granule: pageGranule });
            current = [];
            currentSegments = 0;
        }
        current.push(packet);
        currentSegments += needed;
        granule += opusPacketSamples(packet);
        pageGranule = granule;
    }
    if (current.length) pages.push({ packets: current, granule: pageGranule });

    pages.forEach((page, i) => {
        out.push(oggPage({
            serial,
            sequence: i + 2,
            headerType: i === pages.length - 1 ? 0x04 : 0x00, // end of stream
            granule: page.granule,
            packets: page.packets,
        }));
    });

    return Buffer.concat(out);
}
