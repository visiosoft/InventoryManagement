/**
 * Putting a room behind the voice.
 *
 * Speech from a model arrives in a vacuum — no air, no hum, no distance — and
 * that silence is a good part of why it reads as synthetic. Mixing a quiet bed
 * underneath it is the cheapest thing that makes it sound recorded rather than
 * generated.
 *
 * Two beds, and they are not the same idea:
 *
 *   'room'   — air conditioning, a distant hum, the sound of a warehouse
 *              office with nobody in it. It says "this was recorded
 *              somewhere" and claims nothing else.
 *   'office' — the same, with an indistinct murmur of talking behind it, as
 *              though somebody else is on a call across the room.
 *   'callcentre'
 *            — actual voices, several of them, overlapped and set back in the
 *              room. The two above are synthesised and sound like it; people
 *              do not sound like filtered noise. See callCentreBed.js.
 *
 * The first two are synthesised here — nothing to licence, and the murmur is
 * filtered noise shaped like speech rhythm, so no words are ever intelligible.
 * The third is real speech, built once by callCentreBed.js and set far enough
 * back that no sentence carries as a statement: a bed that suggests a busy
 * office is one thing, one putting words in the business's mouth is another.
 *
 * No ffmpeg. The API host has never needed a system binary to send a voice
 * note (see audioRemux.js) and this does not change that: the mix happens in
 * PCM, the encode is a pure-JS Opus encoder, and the Ogg muxer is the one
 * already written for the browser recorder.
 */

import OpusScript from 'opusscript';
import { oggFromOpusPackets } from './audioRemux.js';
import { callCentreBed } from './callCentreBed.js';

/* OpenAI returns raw PCM at 24 kHz, mono, signed 16-bit little-endian. Opus
   handles 24 kHz natively, so nothing is resampled. */
const RATE = 24000;
const FRAME_SAMPLES = RATE / 50;   // 20 ms, the frame size Opus is happiest at

/** A gentle one-pole low-pass. Noise straight from Math.random is a hiss; a
 *  room is mostly what is left after the top has been taken off it. */
function lowPass(samples, cutoff) {
    const a = Math.min(1, Math.max(0, cutoff));
    let last = 0;
    for (let i = 0; i < samples.length; i++) {
        last += a * (samples[i] - last);
        samples[i] = last;
    }
    return samples;
}

/**
 * The bed, as floats in roughly -1..1 before gain.
 *
 * `withVoices` adds the murmur: noise gated by a slow, irregular envelope so
 * it rises and falls the way talking does, then filtered hard enough that it
 * carries rhythm and no content.
 */
function buildBed(length, withVoices) {
    const bed = new Float64Array(length);

    // Air: filtered noise, the broad hush of a room.
    const air = new Float64Array(length);
    for (let i = 0; i < length; i++) air[i] = Math.random() * 2 - 1;
    lowPass(air, 0.02);

    // Hum: the fundamental of the building, plus its first harmonic.
    for (let i = 0; i < length; i++) {
        const t = i / RATE;
        const hum = Math.sin(2 * Math.PI * 50 * t) * 0.35 + Math.sin(2 * Math.PI * 100 * t) * 0.12;
        bed[i] = air[i] * 6 + hum * 0.5;
    }

    if (withVoices) {
        const murmur = new Float64Array(length);
        for (let i = 0; i < length; i++) murmur[i] = Math.random() * 2 - 1;
        // Band-limited to the range speech sits in, so it reads as talking
        // rather than as static.
        lowPass(murmur, 0.08);

        /* Syllables. A slow wobble under a faster one gives the uneven
           on-and-off of somebody speaking in sentences, with gaps. */
        for (let i = 0; i < length; i++) {
            const t = i / RATE;
            const phrase = Math.sin(2 * Math.PI * 0.13 * t) * 0.5 + 0.5;   // sentences
            const syllable = Math.sin(2 * Math.PI * 3.1 * t) * 0.5 + 0.5;  // syllables
            const gate = Math.max(0, phrase * 0.85 - 0.15) * syllable;
            bed[i] += murmur[i] * gate * 9;
        }
    }

    return bed;
}

/**
 * Mix a bed under speech and hand back an Ogg/Opus voice note.
 *
 * @param pcm      raw 24 kHz mono signed 16-bit LE, as OpenAI returns it
 * @param kind     'room' | 'office' | 'callcentre'
 * @param level    0..1, how loud the bed sits under the voice
 * @returns Buffer, or null if it could not be built — the caller then sends
 *          the plain voice, because a reply with no room tone is fine and a
 *          reply that failed to send is not.
 */
export async function mixAmbience({ pcm, kind = 'room', level = 0.12 }) {
    try {
        if (!pcm?.length || kind === 'none') return null;

        const samples = Math.floor(pcm.length / 2);
        if (samples < FRAME_SAMPLES) return null;

        // A moment of room before and after the voice: speech that starts on
        // the first sample and stops dead on the last is the giveaway.
        const pad = Math.floor(RATE * 0.35);
        const total = samples + pad * 2;

        /* Real voices, where they are asked for. The bed is thirty seconds
           long and a different slice of it is used each time, so two replies
           in a row never carry the same background. */
        let bed;
        if (kind === 'callcentre') {
            const recorded = await callCentreBed();
            if (!recorded) return null;
            bed = new Float64Array(total);
            const start = Math.floor(Math.random() * recorded.length);
            for (let i = 0; i < total; i++) bed[i] = recorded[(start + i) % recorded.length];
        } else {
            bed = buildBed(total, kind === 'office');
        }
        const gain = Math.min(0.4, Math.max(0, level));
        const out = new Int16Array(total);

        for (let i = 0; i < total; i++) {
            const voice = i >= pad && i < pad + samples ? pcm.readInt16LE((i - pad) * 2) : 0;
            /* The bed fades in and out over the padding, so it does not
               appear and vanish with a click. */
            const fade = i < pad ? i / pad : i >= pad + samples ? Math.max(0, (total - i) / pad) : 1;
            const mixed = voice + bed[i] * gain * 32767 * Math.min(1, fade + 0.35);
            out[i] = Math.max(-32768, Math.min(32767, Math.round(mixed)));
        }

        const encoder = new OpusScript(RATE, 1, OpusScript.Application.AUDIO);
        const packets = [];
        for (let offset = 0; offset + FRAME_SAMPLES <= out.length; offset += FRAME_SAMPLES) {
            const frame = Buffer.from(out.buffer, out.byteOffset + offset * 2, FRAME_SAMPLES * 2);
            packets.push(Buffer.from(encoder.encode(frame, FRAME_SAMPLES)));
        }
        encoder.delete?.();
        if (!packets.length) return null;

        return oggFromOpusPackets({ packets, channels: 1, sampleRate: RATE });
    } catch (e) {
        console.error('[VoiceAmbience] could not mix a bed:', e.message);
        return null;
    }
}
