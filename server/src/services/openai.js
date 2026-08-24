import axios from 'axios';

// OpenAI is used for exactly one thing: turning a plain-English availability
// request into structured filters. It never decides availability itself —
// that stays a date-overlap query against real bookings, because it has
// billing and legal consequences and must not depend on a model's guess.

const API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

export function openaiConfigured() {
    return Boolean(process.env.OPENAI_API_KEY);
}

export function openaiModel() {
    return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

/** Masked for display — the key itself is never returned to the client. */
export function openaiKeyHint() {
    const k = process.env.OPENAI_API_KEY || '';
    return k ? `${k.slice(0, 7)}…${k.slice(-4)}` : '';
}

function headers() {
    return {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
    };
}

/** Cheap credential check — lists models, which costs nothing. */
export async function verifyOpenAIKey(apiKey, model) {
    const { data } = await axios.get(`${API_BASE}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15000,
    });
    const ids = (data?.data || []).map((m) => m.id);
    // A key can be valid but lack access to a given model, which would only
    // surface later as a confusing failure. Check now.
    if (model && ids.length && !ids.includes(model)) {
        throw new Error(`The key is valid but has no access to "${model}"`);
    }
    return { models: ids };
}

/**
 * A chat completion constrained to JSON, which is how everything here talks to
 * the model — prose answers are impossible to validate, and every caller needs
 * to check the model's output before acting on it.
 *
 * Returns the parsed object, or `null` when the model produced something that
 * is not JSON. Callers must treat null as a failure to answer, never as an
 * empty answer.
 */
export async function chatJson({ system, messages = [], temperature = 0, maxTokens = 400, timeout = 30000 }) {
    const { data } = await axios.post(
        `${API_BASE}/chat/completions`,
        {
            model: openaiModel(),
            messages: [{ role: 'system', content: system }, ...messages],
            response_format: { type: 'json_object' },
            temperature,
            max_tokens: maxTokens,
        },
        { headers: headers(), timeout },
    );

    const raw = data?.choices?.[0]?.message?.content || '';
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * The same JSON-only contract as chatJson, for a call that carries an image.
 *
 * The image goes as a data URL rather than a link: uploads here live behind
 * auth or in a private Drive folder, and making a customer's Emirates ID
 * publicly fetchable so a model could read it would be a far worse problem
 * than the typing it saves.
 *
 * Returns the parsed object, or null when the model produced anything else.
 * Callers must treat null as a failure to read, never as an empty document.
 */
export async function visionJson({ system, imageBase64, mimeType, prompt = '', maxTokens = 500, timeout = 45000 }) {
    const { data } = await axios.post(
        `${API_BASE}/chat/completions`,
        {
            model: openaiModel(),
            messages: [
                { role: 'system', content: system },
                {
                    role: 'user',
                    content: [
                        ...(prompt ? [{ type: 'text', text: prompt }] : []),
                        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' } },
                    ],
                },
            ],
            response_format: { type: 'json_object' },
            temperature: 0,
            max_tokens: maxTokens,
        },
        { headers: headers(), timeout },
    );

    const raw = data?.choices?.[0]?.message?.content || '';
    let parsed = null;
    try {
        const p = JSON.parse(raw);
        parsed = p && typeof p === 'object' && !Array.isArray(p) ? p : null;
    } catch {
        parsed = null;
    }
    // Usage comes back with the response; the caller logs it so the cost per
    // document is a measured number rather than an estimate.
    return { parsed, usage: data?.usage ?? null };
}

/**
 * Parse a phrase into availability filters.
 *
 * `context` supplies the real floors and sizes so the model maps "small" or
 * "upstairs" onto values this facility actually has, and `today` anchors
 * relative dates like "next weekend" without the model guessing the date.
 */
export async function parseAvailabilityQuery(text, context = {}) {
    if (!openaiConfigured()) return { configured: false };

    const { floors = [], sizes = [], today = new Date().toISOString().slice(0, 10) } = context;

    const system = [
        'You convert a storage-facility availability request into JSON filters.',
        'Reply with JSON only, no prose.',
        'Shape: {"from":"YYYY-MM-DD"|null,"to":"YYYY-MM-DD"|null,"floor":string|null,"sizeSqf":number|null,"unreadable":string|null}',
        `Today is ${today}. Resolve all relative dates against it.`,
        floors.length ? `Valid floors: ${floors.join(', ')}. Use one of these exactly, or null.` : '',
        sizes.length ? `Valid sizes in sqft: ${sizes.join(', ')}. Map "small"/"large" onto the smallest/largest of these. Use one of these exactly, or null.` : '',
        'If a duration is given without an end ("for 3 months"), set `to` accordingly.',
        'If a field is not mentioned, use null. Never invent a date that was not implied.',
        'Put anything you could not interpret in `unreadable`.',
    ].filter(Boolean).join('\n');

    const { data } = await axios.post(
        `${API_BASE}/chat/completions`,
        {
            model: openaiModel(),
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: String(text || '').slice(0, 500) },
            ],
            response_format: { type: 'json_object' },
            temperature: 0,
            max_tokens: 200,
        },
        { headers: headers(), timeout: 20000 },
    );

    const raw = data?.choices?.[0]?.message?.content || '{}';
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { configured: true, error: 'The model did not return usable JSON' };
    }

    // Never trust the model's values straight through — a floor or size it
    // invented would silently filter the results to nothing.
    const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
    const floor = floors.includes(parsed.floor) ? parsed.floor : null;
    const sizeSqf = sizes.includes(Number(parsed.sizeSqf)) ? Number(parsed.sizeSqf) : null;
    let from = isDate(parsed.from) ? parsed.from : null;
    let to = isDate(parsed.to) ? parsed.to : null;
    if (from && to && to <= from) to = null;

    return {
        configured: true,
        model: openaiModel(),
        filters: { from, to, floor, sizeSqf },
        // Say so when the model named a floor/size this facility does not have,
        // rather than quietly dropping it.
        unreadable: [
            typeof parsed.unreadable === 'string' && parsed.unreadable ? parsed.unreadable : '',
            parsed.floor && !floor ? `no floor "${parsed.floor}" here` : '',
            parsed.sizeSqf && !sizeSqf ? `no ${parsed.sizeSqf} sqft size here` : '',
        ].filter(Boolean).join('; ') || null,
    };
}
