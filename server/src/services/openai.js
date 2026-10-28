import axios from 'axios';
import { claudeConfigured, claudeModel, claudeChatJson, claudeChatWithTools, claudeVisionJson } from './claude.js';
import { scrubText } from '../utils/pii.js';
import { recordAiUsage } from './aiUsage.js';

// Tokens from an OpenAI reply (chat or responses shape), into the usage log.
const logOpenAI = (model, u, kind) => { if (u) recordAiUsage({ provider: 'openai', model, inputTokens: u.prompt_tokens ?? u.input_tokens ?? 0, cachedTokens: u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? 0, outputTokens: u.completion_tokens ?? u.output_tokens ?? 0, kind }); };

// OpenAI is used for exactly one thing: turning a plain-English availability
// request into structured filters. It never decides availability itself —
// that stays a date-overlap query against real bookings, because it has
// billing and legal consequences and must not depend on a model's guess.

const API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
// Speech to text. The chat models do not take audio, so this is its own model.
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
// Text to speech, for answering a voice note in kind.
const SPEECH_MODEL = process.env.OPENAI_SPEECH_MODEL || 'gpt-4o-mini-tts';

/* ── Which AI answers ───────────────────────────────────────────────────
 * OpenAI or Claude (Anthropic), switched from Settings → Integrations
 * (AI_PROVIDER). Every chat, JSON, vision and tool call in the app goes
 * through this file, so the switch moves all of them at once. Voice notes
 * (transcription, spoken replies) are OpenAI-only and keep using its key.
 *
 * If the chosen provider has no key but the other one does, the other one
 * answers rather than everything going dark. */
export const PROVIDERS = ['openai', 'anthropic'];

export const openaiKeyPresent = () => Boolean(process.env.OPENAI_API_KEY);

export function chosenProvider() {
    return process.env.AI_PROVIDER === 'anthropic' ? 'anthropic' : 'openai';
}

export function aiProvider() {
    const chosen = chosenProvider();
    const has = { openai: openaiKeyPresent(), anthropic: claudeConfigured() };
    if (has[chosen]) return chosen;
    return has.openai ? 'openai' : has.anthropic ? 'anthropic' : chosen;
}

const isClaudeModel = (m) => /^claude-/.test(String(m || ''));

/**
 * Claude out of credit, or its key refused: nothing will answer until someone
 * tops up, so when an OpenAI key is saved the same call goes to OpenAI
 * instead of every reply, bot and summary failing. Pure.
 */
export function claudeUnusable(err) {
    return /credit balance is too low|purchase credits|billing|invalid x-api-key|authentication_error|permission_error/i.test(String(err?.message || err || ''));
}

/** Run on Claude; on an unusable-Claude error with an OpenAI key saved, return null so the caller carries on with OpenAI. */
async function claudeOr(run) {
    try {
        return { out: await run() };
    } catch (e) {
        if (!claudeUnusable(e) || !openaiKeyPresent()) throw e;
        console.warn(`[AI] Claude unusable (${String(e.message).slice(0, 120)}) — answering with OpenAI`);
        return null;
    }
}

// No Emirates ID reaches a model in full, whatever built the prompt (WP-07).
const scrubContent = (c) => (typeof c === 'string' ? scrubText(c)
    : Array.isArray(c) ? c.map((p) => (p && typeof p.text === 'string' ? { ...p, text: scrubText(p.text) } : p)) : c);
const scrubMessages = (messages) => messages.map((m) => (m && 'content' in m ? { ...m, content: scrubContent(m.content) } : m));

// OpenAI does not accept the Claude blocks a turn carries for its next round.
const forOpenAI = (messages) => messages.map(({ _claudeContent, ...m }) => m);

/** The OpenAI model, ignoring the provider switch. */
export function openaiOwnModel() {
    return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

/**
 * A feature can pick its own model (the WhatsApp assistant, an agent). That
 * choice is kept only when it belongs to the provider in use; otherwise the
 * provider's own default answers, so flipping the switch moves everything.
 */
export function resolveModel(model) {
    if (aiProvider() === 'anthropic') return isClaudeModel(model) ? model : claudeModel();
    return model && !isClaudeModel(model) ? model : openaiOwnModel();
}

/** Whether any AI can answer right now (name kept: every caller uses it). */
export function openaiConfigured() {
    return aiProvider() === 'anthropic' ? claudeConfigured() : openaiKeyPresent();
}

/** The model the active provider answers with by default. */
export function openaiModel() {
    return aiProvider() === 'anthropic' ? claudeModel() : openaiOwnModel();
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

/**
 * The GPT-6 family (and GPT-5 before it) rejects two parameters every call
 * here used to send unconditionally:
 *
 *  - `max_tokens` — "Unsupported parameter: 'max_tokens' is not supported
 *    with this model. Use 'max_completion_tokens' instead."
 *  - a non-default `temperature` — "Unsupported value: 'temperature' does
 *    not support 0.3 with this model. Only the default (1) value is
 *    supported." — these models only ever run at temperature 1, so the
 *    parameter has to be left out entirely rather than sent as 1, in case a
 *    future model accepts the parameter but not that exact value.
 *
 * Both failures surfaced back to back the moment the WhatsApp assistant was
 * switched to gpt-6-sol. Only gpt-4o/gpt-4.1/gpt-3.5 and earlier still take
 * the old max_tokens name and a chosen temperature, so this is a lookup keyed
 * on what is actually selected, not a blanket rename that would need
 * flipping back later.
 */
const LEGACY_MODELS = /^(gpt-4|gpt-3\.5)/;
export function tokenLimitParam(model, n) {
    return LEGACY_MODELS.test(model || '') ? { max_tokens: n } : { max_completion_tokens: n };
}
export function temperatureParam(model, temperature) {
    return LEGACY_MODELS.test(model || '') ? { temperature } : {};
}

/**
 * The GPT-6 reasoning models refuse function tools outright unless told not
 * to reason first: "Function tools with reasoning_effort are not supported
 * for gpt-6-luna in /v1/chat/completions. To use function tools, use
 * /v1/responses or set reasoning_effort to 'none'." Every agent turn here
 * sends tools, so without this every call to a GPT-6 model failed with the
 * same 400 regardless of the conversation — this was found because Omar's
 * rehearsal failed on all 24 turns identically.
 */
export function reasoningEffortParam(model, hasTools) {
    // gpt-6-astra is the exception, and has no setting that works here: it
    // rejects 'none' ("does not support 'none' with this model. Supported
    // values are: 'low', 'medium', 'high', and 'xhigh'") and rejects tools
    // alongside any other value ("Function tools with reasoning_effort are
    // not supported for gpt-6-astra in /v1/chat/completions"). Its tool turns
    // go to /v1/responses instead — see usesResponsesApi.
    if (usesResponsesApi(model, hasTools)) return {};
    return hasTools && !LEGACY_MODELS.test(model || '') ? { reasoning_effort: 'none' } : {};
}

/** Models whose function-tool turns only work on /v1/responses. */
export function usesResponsesApi(model, hasTools) {
    return Boolean(hasTools) && /^gpt-6-astra/.test(model || '');
}

/**
 * Chat Completions messages -> Responses API input items. Callers keep one
 * conversation format (an assistant message carrying `tool_calls`, then
 * `role: 'tool'` results); this is the only place that knows the Responses
 * API spells the same thing as function_call / function_call_output items.
 */
export function toResponsesInput(messages) {
    const input = [];
    for (const m of messages) {
        if (m.role === 'tool') {
            input.push({ type: 'function_call_output', call_id: m.tool_call_id, output: String(m.content ?? '') });
        } else if (m.role === 'assistant') {
            if (m.content) input.push({ role: 'assistant', content: String(m.content) });
            for (const c of m.tool_calls || []) {
                input.push({ type: 'function_call', call_id: c.id, name: c.function?.name || '', arguments: c.function?.arguments || '{}' });
            }
        } else {
            input.push({ role: m.role === 'system' ? 'developer' : 'user', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '') });
        }
    }
    return input;
}

async function chatWithToolsResponses({ system, messages, tools, model, maxTokens, timeout, toolChoice }) {
    let data;
    try {
        ({ data } = await axios.post(
            `${API_BASE}/responses`,
            {
                model,
                instructions: system,
                input: toResponsesInput(messages),
                tools: tools.map((t) => ({ type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters })),
                tool_choice: toolChoice,
                max_output_tokens: maxTokens,
                reasoning: { effort: 'low' },
                store: false,
            },
            { headers: headers(), timeout },
        ));
    } catch (e) {
        const msg = e.response?.data?.error?.message;
        throw msg ? new Error(`${model}: ${msg}`) : e;
    }
    const output = data?.output || [];
    const content = output
        .filter((o) => o.type === 'message')
        .flatMap((o) => o.content || [])
        .filter((c) => c.type === 'output_text')
        .map((c) => c.text)
        .join('');
    const calls = output.filter((o) => o.type === 'function_call');
    const toolCalls = calls.map((c) => {
        let args = {};
        try { args = JSON.parse(c.arguments || '{}'); } catch { args = {}; }
        return { id: c.call_id, name: c.name || '', args };
    });
    // Handed back in Chat Completions shape so the caller can push it onto
    // its conversation unchanged.
    const message = {
        role: 'assistant',
        content: content || null,
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.call_id, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' } })) } : {}),
    };
    const u = data?.usage;
    logOpenAI(model, u, 'tools');
    const usage = u ? { prompt_tokens: u.input_tokens, completion_tokens: u.output_tokens, total_tokens: u.total_tokens } : null;
    return { content, toolCalls, message, usage };
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
export async function chatJson({ system, messages = [], temperature = 0, maxTokens = 400, timeout = 30000, model, effort }) {
    system = scrubText(system); messages = scrubMessages(messages);
    let chosenModel = resolveModel(model);
    if (aiProvider() === 'anthropic') {
        const r = await claudeOr(() => claudeChatJson({ system, messages, maxTokens, timeout, model: chosenModel, effort }));
        if (r) return r.out;
        chosenModel = openaiOwnModel();
    }
    const { data } = await axios.post(
        `${API_BASE}/chat/completions`,
        {
            // The caller's choice, then the server's, then the default. The
            // assistant picks its own on the settings page; everything else
            // here is happy with whatever the server is set to.
            model: chosenModel,
            messages: [{ role: 'system', content: system }, ...messages],
            response_format: { type: 'json_object' },
            ...temperatureParam(chosenModel, temperature),
            ...tokenLimitParam(chosenModel, maxTokens),
        },
        { headers: headers(), timeout },
    );

    logOpenAI(chosenModel, data?.usage, 'chat');
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
 * Returns `{ parsed, usage }` — `parsed` is the object, or null when the model
 * produced anything else, and `usage` is the token count so the cost per
 * document is a measured number rather than an estimate.
 *
 * A caller must treat a null `parsed` as a failure to read, never as an empty
 * document. (This block used to say the function returned the object itself,
 * which reads as working code right up to the point where every field is
 * undefined.)
 */
/**
 * One turn of a conversation in which the model may ask for tools.
 *
 * The other calls in this file force JSON and never let the model do anything
 * but answer. This one hands it a closed list of tools and returns either the
 * calls it wants made or its final text. The caller runs the tools — the model
 * never touches data itself, which is what makes "never guess" a property of
 * the code rather than a line in a prompt.
 *
 * @returns {{ content: string, toolCalls: Array<{id, name, args}>, message: object, usage }}
 */
export async function chatWithTools({ system, systemPrefix = '', messages = [], tools = [], model, effort, temperature = 0, maxTokens = 700, timeout = 45000, toolChoice = 'auto' }) {
    system = scrubText(system); systemPrefix = scrubText(systemPrefix); messages = scrubMessages(messages);
    if (!openaiConfigured()) throw new Error('No AI provider is configured');
    let chosenModel = resolveModel(model);
    if (aiProvider() === 'anthropic') {
        const r = await claudeOr(() => claudeChatWithTools({ system, systemPrefix, messages, tools, model: chosenModel, effort, maxTokens, timeout, toolChoice }));
        if (r) return r.out;
        chosenModel = openaiOwnModel();
        messages = forOpenAI(messages);
    }
    // OpenAI caches a repeated start of the prompt by itself: the fixed part goes first.
    if (systemPrefix) system = `${systemPrefix}\n\n${system}`;
    if (usesResponsesApi(chosenModel, tools.length > 0)) {
        return chatWithToolsResponses({ system, messages, tools, model: chosenModel, maxTokens, timeout, toolChoice });
    }
    let data;
    try {
        ({ data } = await axios.post(
            `${API_BASE}/chat/completions`,
            {
                model: chosenModel,
                messages: [{ role: 'system', content: system }, ...messages],
                ...(tools.length ? { tools, tool_choice: toolChoice } : {}),
                ...temperatureParam(chosenModel, temperature),
                ...tokenLimitParam(chosenModel, maxTokens),
                ...reasoningEffortParam(chosenModel, tools.length > 0),
            },
            { headers: headers(), timeout },
        ));
    } catch (e) {
        const msg = e.response?.data?.error?.message;
        throw msg ? new Error(`${chosenModel}: ${msg}`) : e;
    }
    const message = data?.choices?.[0]?.message || {};
    const toolCalls = (message.tool_calls || []).map((c) => {
        let args = {};
        try { args = JSON.parse(c.function?.arguments || '{}'); } catch { args = {}; }
        return { id: c.id, name: c.function?.name || '', args };
    });
    logOpenAI(chosenModel, data?.usage, 'tools');
    return { content: String(message.content || ''), toolCalls, message, usage: data?.usage || null };
}

export async function visionJson({ system, imageBase64, mimeType, prompt = '', maxTokens = 500, timeout = 45000, model, effort }) {
    system = scrubText(system); prompt = scrubText(prompt);
    let chosenModel = resolveModel(model);
    if (aiProvider() === 'anthropic') {
        const r = await claudeOr(() => claudeVisionJson({ system, imageBase64, mimeType, prompt, maxTokens, timeout, model: chosenModel, effort }));
        if (r) return r.out;
        chosenModel = openaiOwnModel();
    }
    const { data } = await axios.post(
        `${API_BASE}/chat/completions`,
        {
            // Whatever the assistant is set to reads its photos too: one model
            // for the conversation, so a picture and the words about it are
            // not understood by two different things.
            model: chosenModel,
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
            ...temperatureParam(chosenModel, 0),
            ...tokenLimitParam(chosenModel, maxTokens),
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
    logOpenAI(chosenModel, data?.usage, 'vision');
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

    const parsed = await chatJson({
        system,
        messages: [{ role: 'user', content: String(text || '').slice(0, 500) }],
        maxTokens: 200,
        timeout: 20000,
    });
    if (!parsed) return { configured: true, error: 'The model did not return usable JSON' };

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

/**
 * Turn a voice note into text.
 *
 * A separate model and a separate endpoint from everything else here: the chat
 * models do not take audio, so a voice note used to be handed straight to a
 * person with "the assistant cannot read this".
 *
 * Returns the transcript, or '' when it could not be read. Empty must be
 * treated as a failure to hear — never as somebody having said nothing, which
 * would have the assistant answer a question it never received.
 */
export async function transcribeAudio({ buffer, mimeType = 'audio/ogg', filename = 'voice.ogg', timeout = 45000 }) {
    if (!openaiKeyPresent()) return '';
    if (!buffer?.length) return '';

    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), filename);
    form.append('model', TRANSCRIBE_MODEL);
    // A hint, not a restriction: it still transcribes Arabic or Hindi, but
    // saying what to expect stops it mishearing English brand names.
    form.append('prompt', 'PurpleBox self storage, Al Quoz Dubai. Sizes in square feet, prices in AED.');

    const { data } = await axios.post(`${API_BASE}/audio/transcriptions`, form, {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        timeout,
    });
    return String(data?.text || '').trim();
}

/**
 * Say something out loud.
 *
 * Opus in an Ogg container, which is the one audio format WhatsApp treats as a
 * voice note rather than a file to download — the same shape the browser
 * recorder is repackaged into before sending.
 *
 * `instructions` steers the delivery — warmth, pace, how conversational it is.
 * It is the difference between a person and an announcement, and it does more
 * for how human it sounds than the choice of voice does.
 *
 * Returns the bytes, or null when it could not be produced. Null must mean
 * "send the text instead", never "send nothing".
 */
export async function synthesizeSpeech({ text, voice = 'coral', instructions = '', speed = 1, format = 'opus', timeout = 45000 }) {
    if (!openaiKeyPresent()) return null;
    const words = String(text || '').trim();
    if (!words) return null;

    try {
        const { data } = await axios.post(
            `${API_BASE}/audio/speech`,
            {
                model: SPEECH_MODEL,
                voice,
                input: words.slice(0, 4000),
                /* 'opus' is a finished voice note. 'pcm' is raw 24 kHz mono
                   16-bit, for when something is going to be mixed underneath
                   it before it is packaged — see voiceAmbience.js. */
                response_format: format === 'pcm' ? 'pcm' : 'opus',
                // The API takes 0.25 to 4; anything past about 1.4 stops
                // sounding like a person in a hurry and starts sounding wrong.
                speed: Math.min(2, Math.max(0.5, Number(speed) || 1)),
                /* How it should be said, not what. Without this the delivery is
                   flat and announcement-like — the thing people mean when they
                   say a voice sounds robotic. */
                ...(instructions ? { instructions } : {}),
            },
            { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, responseType: 'arraybuffer', timeout },
        );
        const buffer = Buffer.from(data);
        if (format === 'pcm') return buffer.length ? buffer : null;
        // A voice note that will not play is worse than a written reply.
        return buffer.toString('ascii', 0, 4) === 'OggS' ? buffer : null;
    } catch {
        return null;
    }
}
