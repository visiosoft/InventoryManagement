import Anthropic from '@anthropic-ai/sdk';

/**
 * Claude, as a drop-in for the OpenAI calls in services/openai.js.
 *
 * Nothing outside that file calls this directly. Callers keep speaking the
 * one conversation format they always have (OpenAI chat messages: an
 * assistant message carrying `tool_calls`, then `role: 'tool'` results) and
 * get the same return shapes back; this file is the only place that knows
 * Claude spells those as tool_use / tool_result content blocks.
 *
 * Voice (transcription, spoken replies) has no Claude equivalent and stays
 * on OpenAI whichever provider is selected.
 */

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
export const CLAUDE_EFFORTS = ['low', 'medium', 'high'];

// Models that support server-side refusal fallbacks (Haiku has none).
const FALLBACK_MODELS = /^claude-(opus-5-5|sonnet-5-5|opus-5$|fable-5)/;
const BETA_FALLBACK = 'server-side-fallback-2026-07-01';
// A thinking block replayed after the conversation prefix changed (the system
// prompt or tool list differs, e.g. a final tool-less summing-up turn) is
// dropped rather than failing the request.
const BETA_BINDING = 'thinking-binding-controls-2026-08-01';

export function claudeConfigured() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function claudeModel() {
    return process.env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL;
}

/** How hard Claude thinks before answering. These are short, latency-sensitive calls. */
export function claudeEffort() {
    const e = String(process.env.ANTHROPIC_EFFORT || '').toLowerCase();
    return CLAUDE_EFFORTS.includes(e) ? e : 'low';
}

export function claudeKeyHint() {
    const k = process.env.ANTHROPIC_API_KEY || '';
    return k ? `${k.slice(0, 10)}…${k.slice(-4)}` : '';
}

let cached = { key: '', client: null };
function client() {
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) throw new Error('Claude is not configured');
    // Rebuilt when the key is rotated from the settings page.
    if (cached.key !== key) cached = { key, client: new Anthropic({ apiKey: key, maxRetries: 2 }) };
    return cached.client;
}

/** Cheap credential check — reads the model, which costs nothing. */
export async function verifyClaudeKey(apiKey, model) {
    const c = new Anthropic({ apiKey, maxRetries: 0, timeout: 15000 });
    try {
        await c.models.retrieve(model || claudeModel());
    } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new Error('Anthropic rejected that key');
        if (e instanceof Anthropic.NotFoundError) throw new Error(`The key is valid but has no access to "${model}"`);
        throw e;
    }
}

/* ── format conversion ─────────────────────────────────────────────────── */

const asText = (c) => (typeof c === 'string' ? c : c == null ? '' : JSON.stringify(c));

/**
 * OpenAI chat messages -> Claude messages. `keepTools` false flattens earlier
 * tool calls into plain text, for a turn sent without tools (the API refuses
 * tool blocks when no tools are declared).
 */
export function toClaudeMessages(messages, { keepTools = true } = {}) {
    const out = [];
    const push = (role, blocks) => {
        if (!blocks.length) return;
        const last = out[out.length - 1];
        // Claude wants turns to alternate; tool results for one assistant turn
        // must all sit in the single user message that follows it.
        if (last && last.role === role) last.content.push(...blocks);
        else out.push({ role, content: [...blocks] });
    };
    for (const m of messages || []) {
        if (m.role === 'tool') {
            push('user', [keepTools
                ? { type: 'tool_result', tool_use_id: m.tool_call_id, content: asText(m.content) }
                : { type: 'text', text: `[tool result] ${asText(m.content)}` }]);
        } else if (m.role === 'assistant') {
            // The exact blocks Claude produced (thinking included) go back
            // unchanged, as the API requires within a tool loop.
            if (keepTools && Array.isArray(m._claudeContent)) { push('assistant', m._claudeContent); continue; }
            const blocks = [];
            if (m.content) blocks.push({ type: 'text', text: asText(m.content) });
            for (const c of m.tool_calls || []) {
                let input = {};
                try { input = JSON.parse(c.function?.arguments || '{}'); } catch { input = {}; }
                blocks.push(keepTools
                    ? { type: 'tool_use', id: c.id, name: c.function?.name || '', input }
                    : { type: 'text', text: `[called ${c.function?.name || 'tool'} with ${c.function?.arguments || '{}'}]` });
            }
            push('assistant', blocks);
        } else if (m.role === 'system') {
            // Mid-conversation instructions are rare here; fold them in as user text.
            push('user', [{ type: 'text', text: asText(m.content) }]);
        } else if (Array.isArray(m.content)) {
            push('user', m.content.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : p)));
        } else {
            push('user', [{ type: 'text', text: asText(m.content) || ' ' }]);
        }
    }
    // The first message must come from the user.
    if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: [{ type: 'text', text: '(conversation so far)' }] });
    if (!out.length) out.push({ role: 'user', content: [{ type: 'text', text: 'Begin.' }] });
    return out;
}

/** OpenAI function tools -> Claude tools. */
export function toClaudeTools(tools) {
    return (tools || []).map((t) => ({
        name: t.function?.name || t.name,
        description: t.function?.description || t.description || '',
        input_schema: t.function?.parameters || t.parameters || { type: 'object', properties: {} },
    }));
}

const usageOf = (u) => (u ? {
    prompt_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    completion_tokens: u.output_tokens || 0,
    total_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0),
    provider: 'anthropic',
} : null);

const textOf = (content) => (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');

/** The first JSON object in a reply — Claude has no schema-less JSON mode. */
export function firstJsonObject(raw) {
    const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const tryParse = (t) => { try { const p = JSON.parse(t); return p && typeof p === 'object' && !Array.isArray(p) ? p : null; } catch { return null; } };
    const whole = tryParse(s);
    if (whole) return whole;
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    return start >= 0 && end > start ? tryParse(s.slice(start, end + 1)) : null;
}

/* ── the call ──────────────────────────────────────────────────────────── */

async function create({ model, system, messages, tools, maxTokens, timeout }) {
    const chosen = model || claudeModel();
    const betas = [BETA_BINDING];
    const fallbacks = FALLBACK_MODELS.test(chosen);
    if (fallbacks) betas.push(BETA_FALLBACK);
    let res;
    try {
        res = await client().beta.messages.create({
            model: chosen,
            // Thinking counts against this, so it is never the caller's small
            // "answer length" number; Claude stops when it is done.
            max_tokens: Math.max(maxTokens || 0, 16000),
            system,
            messages,
            ...(tools?.length ? { tools } : {}),
            thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
            output_config: { effort: claudeEffort() },
            // A safety decline is retried on Anthropic's recommended model
            // instead of coming back empty.
            ...(fallbacks ? { fallbacks: 'default' } : {}),
            betas,
        }, { timeout: Math.max(timeout || 0, 120000) });
    } catch (e) {
        if (e instanceof Anthropic.APIError) throw new Error(`${chosen}: ${e.message}`);
        throw e;
    }
    if (res.stop_reason === 'refusal') {
        throw new Error(`${chosen} declined to answer${res.stop_details?.category ? ` (${res.stop_details.category})` : ''}`);
    }
    return res;
}

const JSON_RULE = 'Reply with one JSON object only: no prose, no code fences.';

/** chatJson contract: the parsed object, or null when the reply was not JSON. */
export async function claudeChatJson({ system, messages = [], maxTokens = 400, timeout = 30000, model }) {
    const res = await create({
        model,
        system: `${system}\n\n${JSON_RULE}`,
        messages: toClaudeMessages(messages.length ? messages : [{ role: 'user', content: 'Answer now.' }], { keepTools: false }),
        maxTokens,
        timeout,
    });
    return firstJsonObject(textOf(res.content));
}

/** visionJson contract: { parsed, usage }. */
export async function claudeVisionJson({ system, imageBase64, mimeType, prompt = '', maxTokens = 500, timeout = 45000, model }) {
    const isPdf = /pdf/i.test(mimeType || '');
    const media = isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } }
        : { type: 'image', source: { type: 'base64', media_type: /^image\/(jpeg|png|gif|webp)$/.test(mimeType) ? mimeType : 'image/jpeg', data: imageBase64 } };
    const res = await create({
        model,
        system: `${system}\n\n${JSON_RULE}`,
        messages: [{ role: 'user', content: [media, { type: 'text', text: prompt || 'Read this.' }] }],
        maxTokens,
        timeout,
    });
    return { parsed: firstJsonObject(textOf(res.content)), usage: usageOf(res.usage) };
}

/** chatWithTools contract: { content, toolCalls, message, usage }. */
export async function claudeChatWithTools({ system, messages = [], tools = [], model, maxTokens = 700, timeout = 45000, toolChoice = 'auto' }) {
    const claudeTools = toClaudeTools(tools);
    // Forcing a tool call is not accepted by current models; asking works.
    const sys = toolChoice === 'required' && claudeTools.length
        ? `${system}\n\nIn this reply you must call one of the tools before answering.`
        : system;
    const res = await create({
        model,
        system: sys,
        messages: toClaudeMessages(messages, { keepTools: claudeTools.length > 0 }),
        tools: claudeTools,
        maxTokens,
        timeout,
    });
    const content = textOf(res.content);
    const uses = res.content.filter((b) => b.type === 'tool_use');
    const toolCalls = uses.map((b) => ({ id: b.id, name: b.name, args: b.input && typeof b.input === 'object' ? b.input : {} }));
    // Handed back in OpenAI shape so callers push it onto their conversation
    // unchanged; the original blocks ride along for the next turn.
    const message = {
        role: 'assistant',
        content: content || null,
        ...(uses.length ? { tool_calls: uses.map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } })) } : {}),
        _claudeContent: res.content,
    };
    return { content, toolCalls, message, usage: usageOf(res.usage) };
}
