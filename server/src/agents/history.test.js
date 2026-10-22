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
  // The video and the photo from the same side collapse into one cheap line.
  assert.deepEqual(m.map((x) => x.role), ['user', 'assistant', 'assistant', 'assistant']);
  assert.equal(m[2].content, '[our team sent a video and a photo]');
  assert.match(m[3].content, /10 to 200 sq ft/);
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

test('a run of files collapses to one counted line, and long messages are trimmed', () => {
  const m = agentHistoryMessages([
    { direction: 'inbound', type: 'image', text: '' },
    { direction: 'inbound', type: 'image', text: '' },
    { direction: 'inbound', type: 'image', text: '' },
    { direction: 'inbound', type: 'document', text: '' },
    { direction: 'outbound', type: 'text', text: 'x'.repeat(2000) },
  ], '');
  assert.equal(m.length, 2);
  assert.equal(m[0].content, '[the customer sent 3 photos and a document]');
  assert.equal(m[1].content.length, 500);
});

import { openCustomerMessages } from './runtime.js';

// The chat from the screenshot (22 Oct): the price list went out, then the
// customer wrote four messages; our only reply in between was "sure".
test('every customer message since our last real reply is open — "sure" does not answer the location', () => {
    const chat = [
        { direction: 'outbound', type: 'text', text: '• 150 sq ft: AED 2,700 • 200 sq ft: AED 3,100 Limited-Time Offer: …' },
        { direction: 'inbound', type: 'text', text: 'Hib' },
        { direction: 'inbound', type: 'text', text: 'Please share your location' },
        { direction: 'outbound', type: 'text', text: 'sure' },
        { direction: 'inbound', type: 'text', text: 'Let me know if 100 Sq ft available with you' },
        { direction: 'inbound', type: 'text', text: 'And final rent per month' },
    ];
    assert.deepEqual(openCustomerMessages(chat), ['Hib', 'Please share your location', 'Let me know if 100 Sq ft available with you', 'And final rent per month']);
});

test('a real answer closes what came before it', () => {
    const chat = [
        { direction: 'inbound', type: 'text', text: 'Where are you?' },
        { direction: 'outbound', type: 'text', text: 'We are at Warehouse 12, ABA Avenue, Al Quoz 2 — here is the map.' },
        { direction: 'inbound', type: 'text', text: 'Price for 50?' },
    ];
    assert.deepEqual(openCustomerMessages(chat), ['Price for 50?']);
    assert.deepEqual(openCustomerMessages([...chat, { direction: 'outbound', type: 'image', text: '' }]), []);
});
