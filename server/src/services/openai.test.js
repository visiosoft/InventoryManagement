import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenLimitParam, temperatureParam, reasoningEffortParam, usesResponsesApi, toResponsesInput } from './openai.js';

// The exact failure this fixes: "Unsupported parameter: 'max_tokens' is not
// supported with this model. Use 'max_completion_tokens' instead" — hit when
// the WhatsApp assistant was switched to gpt-6-sol.

test('gpt-4o and gpt-4.1 still take the old max_tokens name', () => {
  assert.deepEqual(tokenLimitParam('gpt-4o-mini', 400), { max_tokens: 400 });
  assert.deepEqual(tokenLimitParam('gpt-4o', 400), { max_tokens: 400 });
  assert.deepEqual(tokenLimitParam('gpt-4.1', 400), { max_tokens: 400 });
  assert.deepEqual(tokenLimitParam('gpt-4.1-mini', 400), { max_tokens: 400 });
  assert.deepEqual(tokenLimitParam('gpt-3.5-turbo', 400), { max_tokens: 400 });
});

test('gpt-6 models take max_completion_tokens instead', () => {
  assert.deepEqual(tokenLimitParam('gpt-6-sol', 400), { max_completion_tokens: 400 });
  assert.deepEqual(tokenLimitParam('gpt-6-luna', 400), { max_completion_tokens: 400 });
  assert.deepEqual(tokenLimitParam('gpt-6-astra', 400), { max_completion_tokens: 400 });
});

test('an unrecognised or missing model defaults to the new name, not the deprecated one', () => {
  assert.deepEqual(tokenLimitParam('', 400), { max_completion_tokens: 400 });
  assert.deepEqual(tokenLimitParam(undefined, 400), { max_completion_tokens: 400 });
  assert.deepEqual(tokenLimitParam('some-future-model', 400), { max_completion_tokens: 400 });
});

// The second half of the same failure mode: "Unsupported value: 'temperature'
// does not support 0.3 with this model. Only the default (1) value is
// supported" — hit right after the max_tokens fix, still on gpt-6-sol.

test('gpt-4o and gpt-4.1 still take a chosen temperature', () => {
  assert.deepEqual(temperatureParam('gpt-4o-mini', 0.3), { temperature: 0.3 });
  assert.deepEqual(temperatureParam('gpt-4o', 0), { temperature: 0 });
  assert.deepEqual(temperatureParam('gpt-4.1', 0.7), { temperature: 0.7 });
  assert.deepEqual(temperatureParam('gpt-3.5-turbo', 0.3), { temperature: 0.3 });
});

test('gpt-6 models get no temperature at all, not even 1 — the API must supply its own default', () => {
  assert.deepEqual(temperatureParam('gpt-6-sol', 0.3), {});
  assert.deepEqual(temperatureParam('gpt-6-luna', 0), {});
  assert.deepEqual(temperatureParam('gpt-6-astra', 1), {});
});

test('an unrecognised or missing model also omits temperature, matching the safer default', () => {
  assert.deepEqual(temperatureParam('', 0.3), {});
  assert.deepEqual(temperatureParam(undefined, 0.3), {});
  assert.deepEqual(temperatureParam('some-future-model', 0.3), {});
});

test('gpt-6-astra tool turns go to the Responses API, and send no reasoning_effort on chat completions', () => {
  assert.equal(usesResponsesApi('gpt-6-astra', true), true);
  assert.equal(usesResponsesApi('gpt-6-astra', false), false);
  assert.equal(usesResponsesApi('gpt-6-luna', true), false);
  assert.deepEqual(reasoningEffortParam('gpt-6-astra', true), {});
});

test('other gpt-6 models still need none with tools, and legacy or tool-less calls send nothing', () => {
  assert.deepEqual(reasoningEffortParam('gpt-6-luna', true), { reasoning_effort: 'none' });
  assert.deepEqual(reasoningEffortParam('gpt-6-sol', true), { reasoning_effort: 'none' });
  assert.deepEqual(reasoningEffortParam('gpt-6-astra', false), {});
  assert.deepEqual(reasoningEffortParam('gpt-4.1', true), {});
});

test('a chat-style tool conversation becomes Responses input items', () => {
  const input = toResponsesInput([
    { role: 'user', content: 'price for 35?' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'check_availability', arguments: '{"sizeSqf":35}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '{"free":2}' },
  ]);
  assert.deepEqual(input, [
    { role: 'user', content: 'price for 35?' },
    { type: 'function_call', call_id: 'c1', name: 'check_availability', arguments: '{"sizeSqf":35}' },
    { type: 'function_call_output', call_id: 'c1', output: '{"free":2}' },
  ]);
});
