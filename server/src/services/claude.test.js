import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { toClaudeMessages, toClaudeTools, firstJsonObject } from './claude.js';
import { chatJson, chatWithTools, resolveModel, aiProvider, openaiConfigured } from './openai.js';

const saved = { ...process.env };
let sent = [];
let reply = null;
const realFetch = globalThis.fetch;

beforeEach(() => {
    sent = [];
    process.env.AI_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    delete process.env.ANTHROPIC_MODEL;
    globalThis.fetch = async (url, init) => {
        sent.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
        return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    };
});
afterEach(() => { globalThis.fetch = realFetch; process.env = { ...saved }; });

const msg = (content, stop = 'end_turn') => ({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: stop,
    usage: { input_tokens: 10, output_tokens: 5 },
});

test('the switch picks the provider, and a missing key falls back to the other', () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    assert.equal(aiProvider(), 'anthropic');
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(aiProvider(), 'openai');
    delete process.env.OPENAI_API_KEY;
    assert.equal(openaiConfigured(), false);
});

test('a feature\'s own model is kept only when it belongs to the active provider', () => {
    assert.equal(resolveModel('gpt-4.1'), 'claude-fable-5-1');
    assert.equal(resolveModel('claude-haiku-5-5'), 'claude-haiku-5-5');
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-openai';
    assert.equal(resolveModel('claude-haiku-5-5'), 'gpt-4o-mini');
    assert.equal(resolveModel('gpt-4.1'), 'gpt-4.1');
});

test('chatJson goes to Claude and reads the JSON out of the reply', async () => {
    reply = msg([{ type: 'text', text: '```json\n{"intent":"price"}\n```' }]);
    const out = await chatJson({ system: 'Classify.', messages: [{ role: 'user', content: 'how much?' }] });
    assert.deepEqual(out, { intent: 'price' });
    const { url, body, headers } = sent[0];
    assert.match(url, /\/v1\/messages/);
    assert.equal(body.model, 'claude-fable-5-1');
    assert.equal(body.thinking.type, 'adaptive');
    assert.equal(body.fallbacks, 'default');
    assert.match(headers.get('anthropic-beta') || '', /server-side-fallback-2026-07-01/);
    assert.match(headers.get('anthropic-beta') || '', /thinking-binding-controls-2026-08-01/);
    assert.equal(body.betas, undefined);
    assert.match(body.system, /JSON object only/);
});

test('a tool turn comes back in the OpenAI shape and round-trips unchanged', async () => {
    reply = msg([
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'tool_use', id: 'tu_1', name: 'units_available', input: { size: 50 } },
    ], 'tool_use');
    const tools = [{ type: 'function', function: { name: 'units_available', description: 'd', parameters: { type: 'object', properties: {} } } }];
    const res = await chatWithTools({ system: 'S', messages: [{ role: 'user', content: 'any units?' }], tools, toolChoice: 'required' });
    assert.deepEqual(res.toolCalls, [{ id: 'tu_1', name: 'units_available', args: { size: 50 } }]);
    assert.equal(res.message.tool_calls[0].function.name, 'units_available');
    assert.equal(sent[0].body.tool_choice, undefined);           // forcing is refused by current models
    assert.match(sent[0].body.system, /must call one of the tools/);

    reply = msg([{ type: 'text', text: 'Yes, 3 units.' }]);
    const convo = [{ role: 'user', content: 'any units?' }, res.message, { role: 'tool', tool_call_id: 'tu_1', content: '{"n":3}' }];
    const next = await chatWithTools({ system: 'S', messages: convo, tools });
    assert.equal(next.content, 'Yes, 3 units.');
    const m = sent[1].body.messages;
    assert.equal(m[1].content[0].type, 'thinking');               // Claude's own blocks went back as-is
    assert.deepEqual(m[2].content[0], { type: 'tool_result', tool_use_id: 'tu_1', content: '{"n":3}' });
});

test('a safety decline is an error, not an empty answer', async () => {
    reply = { ...msg([]), stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } };
    await assert.rejects(chatJson({ system: 'x', messages: [{ role: 'user', content: 'y' }] }), /declined/);
});

test('conversion helpers', () => {
    const flat = toClaudeMessages([
        { role: 'user', content: 'q' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'a', function: { name: 'f', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'a', content: 'r' },
    ], { keepTools: false });
    assert.ok(flat.every((x) => x.content.every((b) => b.type === 'text')));
    assert.equal(toClaudeTools([{ type: 'function', function: { name: 'n', parameters: { type: 'object' } } }])[0].input_schema.type, 'object');
    assert.deepEqual(firstJsonObject('Sure: {"a":1} done'), { a: 1 });
    assert.equal(firstJsonObject('no json'), null);
});

test('a conversation where we wrote last still ends with a user turn (no prefill)', () => {
    const out = toClaudeMessages([
        { role: 'user', content: 'I need thiss' },
        { role: 'assistant', content: 'Which size?' },
    ]);
    assert.equal(out[out.length - 1].role, 'user');
    assert.equal(out[out.length - 2].content[0].text, 'Which size?');
    // A normal turn is left alone.
    const normal = toClaudeMessages([{ role: 'assistant', content: 'Hi' }, { role: 'user', content: 'Price?' }]);
    assert.equal(normal.length, 3);
    assert.equal(normal[2].content[0].text, 'Price?');
});
