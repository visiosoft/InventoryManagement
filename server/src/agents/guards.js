/**
 * The rules an agent follows in code rather than in a prompt.
 *
 * A prompt asks the model to behave; these decide whether it is allowed to
 * be asked at all. Each is a pure function or a single lookup, so each can be
 * tested without a database or a model.
 */

import { MarketingBlock } from '../models/index.js';

const WINDOW_MS = 24 * 3600_000;
// Meta closes the free-text window at 24 hours; stop a little short so a
// message approved at 23h59 does not reach Meta after it has closed.
const WINDOW_SAFETY_MS = 30 * 60_000;

/** Last nine digits — the identity used everywhere else for a phone number. */
export const phoneKey = (v) => {
    const d = String(v || '').replace(/\D/g, '');
    return d.length >= 9 ? d.slice(-9) : '';
};

/** Is the customer's 24-hour free-text window still open? */
export function windowOpen(lastInboundAt, now = new Date()) {
    if (!lastInboundAt) return false;
    return new Date(now).getTime() - new Date(lastInboundAt).getTime() < WINDOW_MS - WINDOW_SAFETY_MS;
}

/** Is this number on the do-not-message list? */
export async function isBlocked(phone) {
    const key = phoneKey(phone);
    if (!key) return false;
    return Boolean(await MarketingBlock.exists({ phoneKey: key }));
}

// Whole-message words, so "please don't stop the offer" is not an opt-out.
const OPT_OUT_WORDS = new Set([
    'stop', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'opt out',
    'توقف', 'ايقاف', 'إيقاف', 'الغاء الاشتراك', 'إلغاء الاشتراك', 'الغاء', 'إلغاء',
]);
// Phrases that are unmistakable wherever they appear.
const OPT_OUT_PHRASES = [
    /\b(do not|don'?t|dont)\s+(message|text|contact|call|whatsapp|send)\s+(me|us)\b/i,
    /\bstop\s+(messaging|texting|contacting|sending|calling)\b/i,
    /\bremove\s+(me|my number)\b/i,
    /\bunsubscribe\b/i,
    /لا\s*(تراسلني|ترسل\s*لي|تتصل\s*بي|تكلمني)/,
    /احذفني|احذف\s*رقمي/,
];

/** Has the customer asked us to stop? Deliberately strict: a false positive
 *  silences a real lead, so only plain, unambiguous requests count. */
export function isOptOut(text) {
    const t = String(text || '').trim().replace(/[.!؟?،,]+$/g, '').toLowerCase();
    if (!t) return false;
    if (OPT_OUT_WORDS.has(t)) return true;
    return OPT_OUT_PHRASES.some((re) => re.test(t));
}

const ARABIC = /[؀-ۿ]/;
/** Does the customer write in Arabic? Judged on what they sent, not the lead's name. */
export function customerWritesArabic(messages = []) {
    const mine = messages.filter((m) => m.direction === 'inbound').slice(-5);
    if (!mine.length) return false;
    const arabic = mine.filter((m) => ARABIC.test(String(m.text || m.transcript || ''))).length;
    return arabic > mine.length / 2;
}

/** Templates the customer can read: Arabic ones for an Arabic writer when any
 *  exist, otherwise English only — never an Arabic template to someone who
 *  writes English, or the reverse. */
export function templatesForLanguage(templates = [], arabic = false) {
    const isAr = (t) => /^ar/i.test(String(t.language || ''));
    const ar = templates.filter(isAr);
    const other = templates.filter((t) => !isAr(t));
    return arabic && ar.length ? ar : other.length ? other : templates;
}
