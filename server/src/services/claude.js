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

export const DEFAULT_CLAUDE_MODEL = 'claude-fable-5-1';
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

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
    /* …and the last one too. A chat where our side wrote last (a Refresh
       after "Which size?") ended on an assistant turn, which current Claude
       models reject as prefill: "The conversation must end with a user
       message." The instructions in the system prompt say what to write. */
    if (out[out.length - 1].role === 'assistant') {
        out.push({ role: 'user', content: [{ type: 'text', text: '(Our side sent the last message above. Do what the instructions ask next.)' }] });
    }
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

async function create({ model, system, messages, tools, maxTokens, timeout, effort }) {
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
            // A feature's own effort (an agent, the assistant) wins over the server's.
            output_config: { effort: CLAUDE_EFFORTS.includes(effort) ? effort : claudeEffort() },
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
export async function claudeChatJson({ system, messages = [], maxTokens = 400, timeout = 30000, model, effort }) {
    const res = await create({
        model,
        effort,
        system: `${system}\n\n${JSON_RULE}`,
        messages: toClaudeMessages(messages.length ? messages : [{ role: 'user', content: 'Answer now.' }], { keepTools: false }),
        maxTokens,
        timeout,
    });
    return firstJsonObject(textOf(res.content));
}

/** visionJson contract: { parsed, usage }. */
export async function claudeVisionJson({ system, imageBase64, mimeType, prompt = '', maxTokens = 500, timeout = 45000, model, effort }) {
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
export async function claudeChatWithTools({ system, messages = [], tools = [], model, effort, maxTokens = 700, timeout = 45000, toolChoice = 'auto' }) {
    const claudeTools = toClaudeTools(tools);
    // Forcing a tool call is not accepted by current models; asking works.
    const sys = toolChoice === 'required' && claudeTools.length
        ? `${system}\n\nIn this reply you must call one of the tools before answering.`
        : system;
    const res = await create({
        model,
        effort,
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

/* ── The web ──────────────────────────────────────────────────────────────── */

const WEB_MODEL = 'claude-opus-5-5';

/**
 * One question answered from the web, with its sources. Anthropic's own
 * search tool runs the searches; this returns a short summary and the pages
 * it came from. Only used when the person asking has switched the web on.
 */
export async function claudeWebSearch(query, { maxUses = 10, timeout = 180000 } = {}) {
    const q = String(query || '').trim().slice(0, 600);
    if (!q) return { error: 'Nothing to search for' };
    const messages = [{ role: 'user', content: `Search the web and answer, with the figures and names you found (prices with their currency and the unit size, dates, offers). When a search result names a company or a price page, open that page and read the price there rather than guessing from the snippet. Say plainly what could not be found.\n\nQuestion: ${q}` }];
    // Searches find the pages; fetches read them — a price is usually only on the page itself.
    const tools = [
        { type: 'web_search_20260209', name: 'web_search', max_uses: maxUses },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: maxUses },
    ];
    const content = [];
    let res;
    // A long search pauses mid-turn; carry on from where it stopped, keeping
    // everything found along the way rather than only the last part.
    for (let i = 0; i < 6; i += 1) {
        try {
            res = await client().messages.create({
                model: WEB_MODEL,
                max_tokens: 16000,
                system: 'You research the web for a self-storage company in Dubai. Be factual and short. Today is ' + new Date().toISOString().slice(0, 10) + '.',
                messages,
                tools,
                output_config: { effort: 'medium' },
            }, { timeout });
        } catch (e) {
            if (e instanceof Anthropic.APIError) return { error: `Web search failed: ${e.message}` };
            throw e;
        }
        content.push(...res.content);
        if (res.stop_reason !== 'pause_turn') break;
        messages.push({ role: 'assistant', content: res.content });
    }
    if (res.stop_reason === 'refusal') return { error: 'The web search was declined' };
    const sources = [];
    const seen = new Set();
    const add = (url, title) => { if (url && !seen.has(url)) { seen.add(url); sources.push({ title: String(title || url).slice(0, 120), url }); } };
    for (const b of content) {
        if (b.type === 'web_fetch_tool_result' && b.content?.url) add(b.content.url, b.content.content?.title || b.content.url);
        if (b.type !== 'web_search_tool_result' || !Array.isArray(b.content)) continue;
        for (const r of b.content) if (r?.type === 'web_search_result') add(r.url, r.title);
    }
    return { answer: textOf(content), sources: sources.slice(0, 12) };
}
