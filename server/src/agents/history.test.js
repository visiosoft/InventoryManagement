import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentHistoryMessages } from './runtime.js';

// The chat from the inbox screenshot: the customer asked "How much?", and our
// team then greeted them, sent a video and a photo, and listed the sizes.
const chat = [
  { direction: 'inbound', type: 'text', text: 'How much?' },
  { direction: 'outbound', type: 'text', text: 'Good Afternoon. This is Emad from the Purplebox. May I ask what are u planning to store?' },
  { direction: 'outbound', type: 'video', text: '' },
  { direction: 'outbound', type: 'image', text: '' },
  { direction: 'outbound', type: 'text', text: 'We have different sizes based on ur requirement from 10 to 200 sq ft' },
];

test('media our team sent is in the history instead of vanishing', () => {
  const m = agentHistoryMessages(chat, '');
  assert.deepEqual(m.map((x) => x.role), ['user', 'assistant', 'assistant', 'assistant', 'assistant']);
  assert.equal(m[2].content, '[our team sent a video]');
  assert.equal(m[3].content, '[our team sent a photo]');
  assert.match(m[4].content, /10 to 200 sq ft/);
});

test('a refresh does not repeat the last customer message after our replies', () => {
  const m = agentHistoryMessages(chat, '');
  assert.equal(m.filter((x) => x.content === 'How much?').length, 1);
  assert.equal(m[m.length - 1].role, 'assistant');
});

test('a normal inbound turn still ends on the message being answered', () => {
  const m = agentHistoryMessages([{ direction: 'outbound', type: 'text', text: 'Hi!' }], 'How much?');
  assert.equal(m[m.length - 1].content, 'How much?');
  assert.equal(m[m.length - 1].role, 'user');
});

test('customer media and captions are labelled, and a captioned file keeps its words', () => {
  const m = agentHistoryMessages([
    { direction: 'inbound', type: 'image', text: '' },
    { direction: 'inbound', type: 'document', text: 'my EID' },
    { direction: 'inbound', type: 'audio', transcript: 'I need a small unit' },
  ], '');
  assert.equal(m[0].content, '[the customer sent a photo]');
  assert.equal(m[1].content, '[the customer sent a document] my EID');
  assert.equal(m[2].content, '[the customer sent a voice note] I need a small unit');
});
