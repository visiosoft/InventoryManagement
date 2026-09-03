import test from 'node:test';
import assert from 'node:assert/strict';
import { webmToOggOpus, opusPacketSamples, needsRemux } from './audioRemux.js';

/* ── Building a WebM to remux ─────────────────────────────────────────────── */

/** EBML element: id bytes, then a length as a vint, then the body. */
function el(idBytes, body) {
    const id = Buffer.from(idBytes);
    const len = body.length;
    let size;
    if (len < 0x7f) size = Buffer.from([0x80 | len]);
    else if (len < 0x3fff) size = Buffer.from([0x40 | (len >> 8), len & 0xff]);
    else size = Buffer.from([0x10, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
    return Buffer.concat([id, size, body]);
}

/** A SimpleBlock for track 1, no lacing, carrying one frame. */
function simpleBlock(frame) {
    return el([0xa3], Buffer.concat([
        Buffer.from([0x81]),       // track number 1
        Buffer.from([0x00, 0x00]), // timecode
        Buffer.from([0x80]),       // flags: keyframe, no lacing
        frame,
    ]));
}

function opusHead(channels = 1, preSkip = 3840) {
    const head = Buffer.alloc(19);
    head.write('OpusHead', 0, 'ascii');
    head[8] = 1;
    head[9] = channels;
    head.writeUInt16LE(preSkip, 10);
    head.writeUInt32LE(48000, 12);
    head.writeInt16LE(0, 16);
    head[18] = 0;
    return head;
}

/** A 20 ms mono packet: TOC config 16 (CELT), frame count 1, plus payload. */
function packet(config, byteCount, fill) {
    const p = Buffer.alloc(byteCount, fill);
    p[0] = (config << 3) | 0; // code 0 => one frame
    return p;
}

function buildWebm(frames, { codecId = 'A_OPUS', includeHead = true } = {}) {
    const trackBits = [el([0x86], Buffer.from(codecId, 'ascii'))];
    if (includeHead) trackBits.push(el([0x63, 0xa2], opusHead()));
    trackBits.push(el([0xe1], el([0x9f], Buffer.from([0x01]))));

    return Buffer.concat([
        el([0x1a, 0x45, 0xdf, 0xa3], Buffer.from([0x42, 0x86, 0x81, 0x01])), // EBML header
        el([0x18, 0x53, 0x80, 0x67], Buffer.concat([                          // Segment
            el([0x16, 0x54, 0xae, 0x6b], el([0xae], Buffer.concat(trackBits))), // Tracks
            el([0x1f, 0x43, 0xb6, 0x75], Buffer.concat(frames.map(simpleBlock))), // Cluster
        ])),
    ]);
}

/* ── Reading the Ogg back ─────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let r = i << 24;
        for (let b = 0; b < 8; b++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
        t[i] = r >>> 0;
    }
    return t;
})();

function crcOf(buf) {
    let crc = 0;
    for (let i = 0; i < buf.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ buf[i]) & 0xff]) >>> 0;
    return crc >>> 0;
}

/** Walk the container back apart, so assertions are about real structure. */
function readOgg(buf) {
    const pages = [];
    let pos = 0;
    while (pos < buf.length) {
        assert.equal(buf.toString('ascii', pos, pos + 4), 'OggS', `page at ${pos}`);
        const segCount = buf[pos + 26];
        const table = buf.subarray(pos + 27, pos + 27 + segCount);
        const bodyLen = table.reduce((s, n) => s + n, 0);
        const headerLen = 27 + segCount;
        const page = Buffer.from(buf.subarray(pos, pos + headerLen + bodyLen));

        const stated = page.readUInt32LE(22);
        page.writeUInt32LE(0, 22);
        assert.equal(crcOf(page), stated, 'page CRC');

        // Reassemble packets from the lacing table.
        const packets = [];
        let bodyPos = headerLen;
        let acc = [];
        for (const n of table) {
            acc.push(buf.subarray(pos + bodyPos, pos + bodyPos + n));
            bodyPos += n;
            if (n < 255) { packets.push(Buffer.concat(acc)); acc = []; }
        }

        pages.push({
            headerType: buf[pos + 5],
            granule: buf.readUInt32LE(pos + 6) + buf.readUInt32LE(pos + 10) * 4294967296,
            sequence: buf.readUInt32LE(pos + 18),
            packets,
        });
        pos += headerLen + bodyLen;
    }
    return pages;
}

/* ── Tests ────────────────────────────────────────────────────────────────── */

test('a recording comes back as Ogg with its Opus packets untouched', () => {
    const frames = [packet(16, 40, 0xa1), packet(16, 55, 0xb2), packet(16, 33, 0xc3)];
    const pages = readOgg(webmToOggOpus(buildWebm(frames)));

    assert.equal(pages[0].packets[0].toString('ascii', 0, 8), 'OpusHead');
    assert.equal(pages[0].headerType, 0x02, 'first page marked beginning-of-stream');
    assert.equal(pages[1].packets[0].toString('ascii', 0, 8), 'OpusTags');

    const audio = pages.slice(2).flatMap((p) => p.packets);
    assert.equal(audio.length, frames.length);
    // The whole point of a remux: the encoded bytes must be identical.
    frames.forEach((f, i) => assert.deepEqual(audio[i], f));
});

test('the granule position counts real samples, so the duration is right', () => {
    // Config 19 is CELT at 20 ms — 960 samples each at 48 kHz.
    const frames = [packet(19, 20, 1), packet(19, 20, 2), packet(19, 20, 3)];
    const pages = readOgg(webmToOggOpus(buildWebm(frames)));
    const last = pages[pages.length - 1];

    // Pre-skip (3840) plus 3 x 960.
    assert.equal(last.granule, 3840 + 2880);
    assert.equal(last.headerType, 0x04, 'last page marked end-of-stream');
});

test('page sequence numbers run in order from zero', () => {
    const pages = readOgg(webmToOggOpus(buildWebm([packet(16, 30, 7)])));
    pages.forEach((p, i) => assert.equal(p.sequence, i));
});

test('a long recording is split across pages and still round-trips', () => {
    // 300 packets cannot fit one page's 255-segment table.
    const frames = Array.from({ length: 300 }, (_, i) => packet(16, 12, i % 251));
    const pages = readOgg(webmToOggOpus(buildWebm(frames)));

    assert.ok(pages.length > 3, 'audio spilled onto more than one page');
    const audio = pages.slice(2).flatMap((p) => p.packets);
    assert.equal(audio.length, 300);
    frames.forEach((f, i) => assert.deepEqual(audio[i], f));
});

test('a packet that is an exact multiple of 255 bytes is not merged into the next', () => {
    const frames = [packet(16, 255, 0x5a), packet(16, 10, 0x6b)];
    const audio = readOgg(webmToOggOpus(buildWebm(frames))).slice(2).flatMap((p) => p.packets);
    assert.equal(audio.length, 2);
    assert.equal(audio[0].length, 255);
    assert.equal(audio[1].length, 10);
});

test('the recorder’s own OpusHead is kept, not replaced', () => {
    const pages = readOgg(webmToOggOpus(buildWebm([packet(16, 20, 1)])));
    const head = pages[0].packets[0];
    assert.equal(head.readUInt16LE(10), 3840, 'pre-skip preserved');
    assert.equal(head[9], 1, 'channel count preserved');
});

test('a file with no OpusHead still produces a valid stream', () => {
    const pages = readOgg(webmToOggOpus(buildWebm([packet(16, 20, 1)], { includeHead: false })));
    assert.equal(pages[0].packets[0].toString('ascii', 0, 8), 'OpusHead');
});

/* A live recording does not know its own length while it is being made, so
   Chrome writes Segment and Cluster with an "unknown" size and lets them run
   to the end. Every real voice note arrives this way, so it matters more than
   the tidy fixed-size form above. */
test('a live-recorded file, with unknown-size Segment and Cluster, remuxes', () => {
    const frames = [packet(19, 24, 0x11), packet(19, 24, 0x22), packet(19, 24, 0x33)];
    const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], Buffer.concat([
        el([0x86], Buffer.from('A_OPUS', 'ascii')),
        el([0x63, 0xa2], opusHead()),
    ])));

    const webm = Buffer.concat([
        el([0x1a, 0x45, 0xdf, 0xa3], Buffer.from([0x42, 0x86, 0x81, 0x01])),
        Buffer.from([0x18, 0x53, 0x80, 0x67]),                       // Segment id
        Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), // 8-byte unknown size
        tracks,
        Buffer.from([0x1f, 0x43, 0xb6, 0x75]),                       // Cluster id
        Buffer.from([0xff]),                                          // 1-byte unknown size
        ...frames.map(simpleBlock),
    ]);

    const audio = readOgg(webmToOggOpus(webm)).slice(2).flatMap((p) => p.packets);
    assert.equal(audio.length, 3);
    frames.forEach((f, i) => assert.deepEqual(audio[i], f));
});

test('a non-Opus recording is refused by name rather than silently mangled', () => {
    assert.throws(
        () => webmToOggOpus(buildWebm([packet(16, 20, 1)], { codecId: 'A_VORBIS' })),
        /A_VORBIS/,
    );
});

test('empty and audio-less input fail loudly', () => {
    assert.throws(() => webmToOggOpus(Buffer.alloc(0)), /empty/i);
    assert.throws(() => webmToOggOpus(buildWebm([])), /No audio/i);
});

test('packet durations are read from the table-of-contents byte', () => {
    assert.equal(opusPacketSamples(Buffer.from([16 << 3])), 120, 'CELT 2.5 ms');
    assert.equal(opusPacketSamples(Buffer.from([19 << 3])), 960, 'CELT 20 ms');
    assert.equal(opusPacketSamples(Buffer.from([0 << 3])), 480, 'SILK 10 ms');
    assert.equal(opusPacketSamples(Buffer.from([3 << 3])), 2880, 'SILK 60 ms');
    assert.equal(opusPacketSamples(Buffer.from([12 << 3])), 480, 'hybrid 10 ms');
    // Code 1 means two frames in the packet.
    assert.equal(opusPacketSamples(Buffer.from([(19 << 3) | 1])), 1920);
    assert.equal(opusPacketSamples(Buffer.alloc(0)), 0);
});

test('only the containers WhatsApp refuses are remuxed', () => {
    assert.equal(needsRemux('audio/webm;codecs=opus'), true);
    assert.equal(needsRemux('audio/webm'), true);
    assert.equal(needsRemux('audio/ogg;codecs=opus'), false, 'already what Meta wants');
    assert.equal(needsRemux('audio/mp4'), false, 'Safari records this and Meta takes it');
    assert.equal(needsRemux('audio/mpeg'), false);
    assert.equal(needsRemux('image/png'), false);
});

/**
 * Walk the finished file the way a player does.
 *
 * The tests above check the pieces; this checks the whole thing is a stream a
 * decoder will accept — right capture patterns, right flags in the right
 * places, checksums that match, a granule that only moves forwards. A file
 * that uploads happily and will not play on the recipient's phone fails here
 * and nowhere else.
 */
function walkOgg(buf) {
   const pages = [];
   let off = 0;
   while (off < buf.length) {
      assert.equal(buf.toString('ascii', off, off + 4), 'OggS', `page ${pages.length} does not start with OggS`);
      assert.equal(buf[off + 4], 0, 'stream structure version must be 0');
      const flags = buf[off + 5];
      const granule = Number(buf.readBigUInt64LE(off + 6));
      const serial = buf.readUInt32LE(off + 14);
      const sequence = buf.readUInt32LE(off + 18);
      const stored = buf.readUInt32LE(off + 22);
      const segCount = buf[off + 26];
      const table = buf.subarray(off + 27, off + 27 + segCount);
      const bodyLen = table.reduce((s, v) => s + v, 0);
      const end = off + 27 + segCount + bodyLen;
      assert.ok(end <= buf.length, `page ${pages.length} runs past the end of the file`);

      // The checksum is computed with its own field zeroed.
      const page = Buffer.from(buf.subarray(off, end));
      page.writeUInt32LE(0, 22);
      assert.equal(crcOf(page), stored, `page ${pages.length} has a bad checksum`);

      pages.push({ flags, granule, serial, sequence, segCount });
      off = end;
   }
   return pages;
}

test('the finished file is a stream a decoder will accept', () => {
   // 700 packets, so the audio spills over several pages.
   const frames = Array.from({ length: 700 }, (_, i) => packet(16, 12 + (i % 7), i % 251));
   const pages = walkOgg(webmToOggOpus(buildWebm(frames)));

   assert.ok(pages.length >= 3, 'a header page, a tags page and at least one of audio');
   assert.equal(pages[0].flags, 0x02, 'the first page must be flagged beginning-of-stream');
   assert.equal(pages.filter((p) => p.flags & 0x02).length, 1, 'only the first page may be');
   assert.equal(pages.at(-1).flags & 0x04, 0x04, 'the last page must be flagged end-of-stream');
   assert.equal(pages.filter((p) => p.flags & 0x04).length, 1, 'only the last page may be');

   const serials = new Set(pages.map((p) => p.serial));
   assert.equal(serials.size, 1, 'every page belongs to the same stream');

   pages.forEach((p, i) => assert.equal(p.sequence, i, `page ${i} is numbered ${p.sequence}`));

   assert.equal(pages[0].granule, 0, 'the header page carries no samples');
   assert.equal(pages[1].granule, 0, 'nor does the tags page');
   for (let i = 3; i < pages.length; i++) {
      assert.ok(pages[i].granule > pages[i - 1].granule,
         `granule went backwards at page ${i}: ${pages[i - 1].granule} then ${pages[i].granule}`);
   }
   pages.forEach((p, i) => assert.ok(p.segCount <= 255, `page ${i} has ${p.segCount} segments`));
});

test('a one-packet recording is still a complete stream', () => {
   // The shortest thing somebody can send: tap record, tap stop.
   const pages = walkOgg(webmToOggOpus(buildWebm([packet(15, 40, 0x11)])));
   assert.equal(pages.length, 3);
   assert.equal(pages[0].flags, 0x02);
   assert.equal(pages[2].flags & 0x04, 0x04, 'the single audio page is also the last one');
   assert.ok(pages[2].granule > 0, 'and it carries samples');
});

/* What Meta refuses, and why a rep never found out until the customer said so. */
test('a file whose bytes do not match its declared type is caught', async () => {
   const { containerMismatch } = await import('./audioRemux.js');

   // The real failure: Safari and recent Chrome write a fragmented mp4 that is
   // not recognisable as one, and Meta answers "on processing it is of type
   // application/octet-stream".
   const notMp4 = Buffer.alloc(64, 0);
   assert.match(containerMismatch(notMp4, 'audio/mp4'), /not an MP4/);

   const realMp4 = Buffer.alloc(64, 0);
   realMp4.write('ftyp', 4, 'ascii');
   assert.equal(containerMismatch(realMp4, 'audio/mp4'), '', 'a real mp4 passes');

   const ogg = Buffer.alloc(64, 0);
   ogg.write('OggS', 0, 'ascii');
   assert.equal(containerMismatch(ogg, 'audio/ogg'), '');
   assert.match(containerMismatch(Buffer.alloc(64), 'audio/ogg'), /not an Ogg/);

   const webm = Buffer.alloc(64, 0);
   webm.writeUInt32BE(0x1a45dfa3, 0);
   assert.equal(containerMismatch(webm, 'audio/webm;codecs=opus'), '');
   assert.match(containerMismatch(Buffer.alloc(64), 'video/webm'), /not a WebM/);

   const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, ...Array(60).fill(0)]);
   assert.equal(containerMismatch(mp3, 'audio/mpeg'), '');
   assert.equal(containerMismatch(Buffer.from('ID3aaaaaaaaaaaa'), 'audio/mpeg'), '');

   // Anything without an unambiguous signature is left alone rather than
   // guessed at — a false accusation is worse than no check.
   assert.equal(containerMismatch(Buffer.alloc(64), 'application/pdf'), '');
   assert.equal(containerMismatch(Buffer.alloc(64), 'image/jpeg'), '');
   assert.equal(containerMismatch(Buffer.alloc(4), 'audio/mp4'), '', 'too short to judge');
});

/* Speech this system encodes itself goes through the same muxer as a browser
 * recording. A second muxer would be a second set of files players refuse. */
test('the muxer packages packets we encoded ourselves', async () => {
   const { oggFromOpusPackets } = await import('./audioRemux.js');
   const OpusScript = (await import('opusscript')).default;

   // Two seconds of quiet tone at 24 kHz, the rate the speech arrives at.
   const RATE = 24000;
   const FRAME = RATE / 50;
   const encoder = new OpusScript(RATE, 1, OpusScript.Application.AUDIO);
   const packets = [];
   for (let f = 0; f < 100; f++) {
      const pcm = Buffer.alloc(FRAME * 2);
      for (let i = 0; i < FRAME; i++) {
         pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * (f * FRAME + i)) / RATE) * 6000), i * 2);
      }
      packets.push(Buffer.from(encoder.encode(pcm, FRAME)));
   }

   const ogg = oggFromOpusPackets({ packets, channels: 1, sampleRate: RATE });
   const pages = walkOgg(ogg);

   assert.equal(ogg.toString('ascii', 0, 4), 'OggS');
   assert.equal(pages[0].flags, 0x02, 'flagged beginning of stream');
   assert.equal(pages.at(-1).flags & 0x04, 0x04, 'flagged end of stream');
   assert.ok(pages.length >= 3);
   for (let i = 3; i < pages.length; i++) {
      assert.ok(pages[i].granule > pages[i - 1].granule, `granule went backwards at page ${i}`);
   }

   // The rate must be stated honestly, or a decoder resamples and everything
   // plays at the wrong speed.
   const head = ogg.subarray(28, 28 + 19);
   assert.equal(head.toString('ascii', 0, 8), 'OpusHead');
   assert.equal(head.readUInt32LE(12), RATE, 'OpusHead should say 24000, not 48000');
});
