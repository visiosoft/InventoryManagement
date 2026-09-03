/**
 * A background of real voices, built once and kept.
 *
 * The synthesised beds sounded like what they were — filtered noise, "fake
 * blur". People do not sound like noise, so this bed is made of actual speech:
 * several different voices, each saying something ordinary, overlapped and set
 * back in the room the way a colleague on another call actually sounds.
 *
 * Built once and cached to disk. Generating four voice clips per reply would
 * add seconds and cost to every answer for something that is meant to sit
 * unnoticed underneath; one thirty-second bed, reused at a different offset
 * each time, is indistinguishable and effectively free.
 *
 * The voices are deliberately set far enough back, and overlapped enough, that
 * no sentence carries as a statement. Real speech is what makes it sound like
 * a room; a room is all it should claim.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { synthesizeSpeech } from './openai.js';

const RATE = 24000;                       // what the speech endpoint returns
const BED_SECONDS = 30;
const CACHE_DIR = path.join(process.cwd(), 'uploads', 'voice-ambience');
const CACHE_FILE = path.join(CACHE_DIR, `callcentre-${RATE}-${BED_SECONDS}s.pcm`);

/* Ordinary halves of ordinary calls. Nothing about prices, nothing anybody
   could act on, nothing that reads as a commitment if a word does surface. */
const CHATTER = [
    { voice: 'ash', line: 'Yes, of course. Let me take a look at that for you and I will come straight back.' },
    { voice: 'sage', line: 'No problem at all. Could I take your name, and I will check the notes on the account.' },
    { voice: 'ballad', line: 'That is fine. I will make a note of it and somebody will follow that up this afternoon.' },
    { voice: 'verse', line: 'Sorry, could you say that again? The line is not very clear from my end.' },
];

/** One-pole low-pass. Distance takes the top off a voice; without this the
 *  bed sounds like people standing next to the microphone. */
function lowPass(samples, cutoff) {
    let last = 0;
    for (let i = 0; i < samples.length; i++) {
        last += cutoff * (samples[i] - last);
        samples[i] = last;
    }
    return samples;
}

/**
 * Build the bed. Slow — four calls to the speech endpoint — so it happens once
 * and the result is written to disk.
 *
 * @returns Float64Array of the bed, or null if it could not be made.
 */
async function buildBed() {
    const clips = [];
    for (const { voice, line } of CHATTER) {
        const pcm = await synthesizeSpeech({
            text: line,
            voice,
            // Spoken as somebody on a call sounds, not as an announcement.
            instructions: 'Speak quietly and naturally, mid-conversation on a telephone call. Relaxed, unhurried, slightly distracted.',
            speed: 1,
            format: 'pcm',
        });
        if (pcm?.length) clips.push(pcm);
    }
    if (!clips.length) return null;

    const total = RATE * BED_SECONDS;
    const bed = new Float64Array(total);

    /* Laid down at staggered offsets and repeated, so voices overlap and no
       one clip is ever heard alone from beginning to end. */
    clips.forEach((pcm, index) => {
        const samples = Math.floor(pcm.length / 2);
        const voice = new Float64Array(samples);
        for (let i = 0; i < samples; i++) voice[i] = pcm.readInt16LE(i * 2) / 32768;
        lowPass(voice, 0.06);   // across the room, not into the microphone

        // Each voice starts at its own point and comes round again with a gap,
        // the way a room of people talking never lines up.
        const gap = Math.floor(RATE * (2.5 + index * 1.7));
        let at = Math.floor(RATE * (index * 3.1));
        while (at < total) {
            for (let i = 0; i < samples && at + i < total; i++) {
                bed[at + i] += voice[i] * 0.5;
            }
            at += samples + gap;
        }
    });

    // Air underneath, so the gaps between voices are a room rather than a cut.
    const air = new Float64Array(total);
    for (let i = 0; i < total; i++) air[i] = Math.random() * 2 - 1;
    lowPass(air, 0.02);
    for (let i = 0; i < total; i++) {
        const t = i / RATE;
        bed[i] += air[i] * 3 + Math.sin(2 * Math.PI * 50 * t) * 0.15;
    }

    return bed;
}

let cached = null;

/**
 * The bed, from memory, disk, or freshly built.
 *
 * Returns null rather than throwing: a reply without a background is fine, and
 * one that failed to send because a bed could not be built is not.
 */
export async function callCentreBed() {
    if (cached) return cached;

    try {
        if (existsSync(CACHE_FILE)) {
            /* Kept as 16-bit samples, which is what audio is. Doubles made the
               file four times the size for precision no ear could use. */
            const raw = readFileSync(CACHE_FILE);
            const bed = new Float64Array(raw.length / 2);
            for (let i = 0; i < bed.length; i++) bed[i] = raw.readInt16LE(i * 2) / 32768;
            cached = bed;
            return cached;
        }
    } catch { /* a bad cache file is rebuilt below rather than fatal */ }

    const bed = await buildBed().catch(() => null);
    if (!bed) return null;

    try {
        mkdirSync(CACHE_DIR, { recursive: true });
        const raw = Buffer.alloc(bed.length * 2);
        for (let i = 0; i < bed.length; i++) {
            raw.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(bed[i] * 32768))), i * 2);
        }
        writeFileSync(CACHE_FILE, raw);
    } catch (e) {
        // Not being able to keep it only costs time on the next reply.
        console.error('[CallCentreBed] could not cache the bed:', e.message);
    }

    cached = bed;
    return cached;
}

/** Where the bed is stored, for the settings page to report on. */
export const bedCachePath = CACHE_FILE;
export const bedSeconds = BED_SECONDS;
export const bedRate = RATE;
