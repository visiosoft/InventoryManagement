import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyToMessages } from './aiBot.js';

// The bug this fixes: a voice note or photo the assistant already answered
// carries its words in `transcript`, not `text` — the history query used to
// filter on `type: 'text'` only, so any turn built around media silently
// dropped out of context on every later reply. "Reads based on the last
// message only" is exactly what that looks like from the WhatsApp side.

const inbound = (content) => ({ direction: 'inbound', text: content, transcript: '' });
const outbound = (content) => ({ direction: 'outbound', text: content, transcript: '' });
const inboundVoice = (transcript) => ({ direction: 'inbound', text: '', transcript });

test('a plain text conversation becomes alternating user/assistant turns', () => {
  const messages = historyToMessages([
    inbound('How much is a 50 sqft unit?'),
    outbound('AED 450 per month.'),
  ], 'Do you have anything smaller?');

  assert.deepEqual(messages, [
    { role: 'user', content: 'How much is a 50 sqft unit?' },
    { role: 'assistant', content: 'AED 450 per month.' },
    { role: 'user', content: 'Do you have anything smaller?' },
  ]);
});

test('a voice note earlier in the conversation is not lost — its transcript counts as content', () => {
  const messages = historyToMessages([
    inboundVoice('I need a unit for furniture, about 2 bedrooms worth.'),
    outbound('A 100 sqft unit would suit that — AED 650 per month.'),
  ], 'Is it available from next week?');

  assert.deepEqual(messages, [
    { role: 'user', content: 'I need a unit for furniture, about 2 bedrooms worth.' },
    { role: 'assistant', content: 'A 100 sqft unit would suit that — AED 650 per month.' },
    { role: 'user', content: 'Is it available from next week?' },
  ]);
});

test('a message with neither text nor a transcript contributes nothing, rather than an empty turn', () => {
  const messages = historyToMessages([
    inbound('Hi'),
    { direction: 'inbound', text: '', transcript: '' }, // e.g. a document, never read
  ], 'Still there?');

  assert.deepEqual(messages, [
    { role: 'user', content: 'Hi' },
    { role: 'user', content: 'Still there?' },
  ]);
});

test('the question being answered is appended once, even if the webhook already stored it', () => {
  const messages = historyToMessages([
    inbound('Hello'),
    inbound('Do you have anything smaller?'),
  ], 'Do you have anything smaller?');

  assert.equal(messages.length, 2, 'the duplicate is not appended a second time');
  assert.equal(messages[messages.length - 1].content, 'Do you have anything smaller?');
});

test('an empty inbound text appends nothing extra', () => {
  const messages = historyToMessages([inbound('Hello')], '');
  assert.deepEqual(messages, [{ role: 'user', content: 'Hello' }]);
});
