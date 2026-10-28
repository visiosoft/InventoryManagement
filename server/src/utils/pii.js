/**
 * Restricted identity numbers (WP-07): Emirates ID and passport numbers never
 * reach an AI model, the connector or a log in full — only the last four.
 *
 * Applied where data leaves for one of those places, never to what is stored:
 * the records keep their values, and screens that show them are unchanged.
 * Two layers, because neither alone is enough: by field name for structured
 * results (a passport number has no fixed shape), and by pattern for free
 * text (an Emirates ID typed into a note or a message).
 */

/** Field names that hold a restricted identity number. */
const RESTRICTED_KEY = /^(emiratesId|idNumber|passportNumber|passportNo|eidNumber)$/i;

// 784-YYYY-NNNNNNN-C, with or without dashes or spaces.
const EMIRATES_ID = /\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/g;

/** "784-1990-1234567-1" → "****5671". Empty stays empty. Pure. */
export function maskLast4(value) {
    const s = String(value ?? '').trim();
    if (!s) return s;
    const tail = s.replace(/[^0-9A-Za-z]/g, '').slice(-4);
    return `****${tail}`;
}

/** Every Emirates ID in a piece of text, masked. Pure. */
export function scrubText(text) {
    return typeof text === 'string' ? text.replace(EMIRATES_ID, (m) => maskLast4(m)) : text;
}

export const isRestrictedKey = (key) => RESTRICTED_KEY.test(String(key));

/**
 * A copy of any value with restricted fields masked and Emirates IDs in text
 * masked. Dates, ObjectIds and other non-plain objects pass through as they
 * are. Pure; the input is not changed.
 */
export function redactDeep(value, depth = 0) {
    if (value == null || depth > 12) return value;
    if (typeof value === 'string') return scrubText(value);
    if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
    if (typeof value !== 'object') return value;
    if (typeof value.toJSON === 'function' && !(value.constructor === Object)) {
        // A Mongoose document: redact its plain form. Dates and ObjectIds keep their own JSON.
        if (value.$__ || value._doc) return redactDeep(value.toObject ? value.toObject() : value._doc, depth + 1);
        return value;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = isRestrictedKey(k) && v != null && typeof v !== 'object' ? maskLast4(v) : redactDeep(v, depth + 1);
    }
    return out;
}
