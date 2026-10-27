import test from 'node:test';
import assert from 'node:assert/strict';
import { isConversationCloser, repliesByRep, stillWaiting } from './replyActivity.js';

test('a thank-you, an okay or an emoji closes a conversation; a question does not', () => {
   for (const t of ['Okay', 'ok', 'OK.', 'Thanks!', 'thank you', 'Ok thanks', 'okay thank you', '👍', '🙏', '👍🏻👍🏻', 'العفو', 'شكرا', 'تمام', 'Noted', "You're welcome 😊"]) {
      assert.equal(isConversationCloser(t), true, t);
   }
   for (const t of ['How about the 25?', 'F3-72', 'I am already engaged with other storage', 'ok but what is the price?', 'Thanks, can I visit tomorrow?', '', 'https://tinyurl.com/x']) {
      assert.equal(isConversationCloser(t), false, t);
   }
});

test('a chat is still waiting unless the customer only closed it after a reply', () => {
   const left = stillWaiting([
      { phone: 'a', type: 'text', text: 'Okay', repliedBefore: true },
      { phone: 'b', type: 'text', text: '👍', repliedBefore: true },
      { phone: 'c', type: 'text', text: 'How about the 25?', repliedBefore: true },
      { phone: 'd', type: 'text', text: 'Thanks', repliedBefore: false }, // nobody had answered them yet
      { phone: 'e', type: 'document', text: '', repliedBefore: true },
   ]);
   assert.deepEqual(left.map((m) => m.phone), ['c', 'd', 'e']);
});

test('replies from the WhatsApp app count, credited to the lead\'s owner', () => {
   const dayStart = new Date('2026-10-27T00:00:00+04:00');
   const r = repliesByRep({
      crm: [{ sentBy: 'mahmoud', occurredAt: '2026-10-27T09:00:00+04:00' }],
      app: [
         { lead: 'L1', occurredAt: '2026-10-27T10:00:00+04:00' },
         { lead: 'L1', occurredAt: '2026-10-27T14:25:00+04:00' },
         { lead: 'L2', occurredAt: '2026-10-26T18:00:00+04:00' }, // yesterday: last reply, not today's count
         { lead: 'L9', occurredAt: '2026-10-27T11:00:00+04:00' }, // nobody owns it: not credited
      ],
      ownerOfLead: { L1: 'randa', L2: 'randa' },
      dayStart,
   });
   assert.equal(r.randa.today, 2);
   assert.equal(new Date(r.randa.lastReplyAt).toISOString(), '2026-10-27T10:25:00.000Z');
   assert.equal(r.mahmoud.today, 1);
   assert.equal(Object.keys(r).length, 2);
});
