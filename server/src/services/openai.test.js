import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenLimitParam } from './openai.js';

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
