import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppMessage, Lead, User } from '../models/index.js';
import { whatsappReplyTimeReport, whatsappVolumeReport } from './whatsappAnalysis.js';

const T0 = Date.now() - 3 * 864e5;
const m = (phone, direction, minutes, extra = {}) => ({ phoneNormalized: phone, direction, occurredAt: new Date(T0 + minutes * 60000), sentByAi: false, text: 'x', ...extra });
const chain = (rows) => { const c = { select: () => c, sort: () => c, limit: () => c, lean: async () => rows }; return c; };

function stub(rows) {
  WhatsAppMessage.find = () => chain(rows);
  Lead.find = () => chain([{ phoneNormalized: 'a', owner: 'u1' }, { phoneNormalized: 'b', owner: 'u1' }]);
  User.find = () => chain([{ _id: 'u1', name: 'Sara' }]);
}

test('reply time: gap from the customer\'s first message to our next reply; a burst counts once; AI replies are separate', async () => {
  stub([
    m('a', 'inbound', 0), m('a', 'inbound', 1), m('a', 'outbound', 30),            // 30 min, by a person
    m('a', 'inbound', 600), m('a', 'outbound', 603, { sentByAi: true }),            // 3 min, by AI
    m('b', 'inbound', 0), m('b', 'outbound', 120),                                  // 2 h
    m('c', 'inbound', 0),                                                            // never answered
  ]);
  const r = await whatsappReplyTimeReport({ days: 30 });
  assert.equal(r.allReplies.answeredTurns, 3);
  assert.equal(r.repliedByAPerson.answeredTurns, 2);
  assert.equal(r.repliedByAI.answeredTurns, 1);
  assert.equal(r.repliedByAPerson.medianMinutes, 75);
  assert.equal(r.unansweredTurns.overTwentyFourHours, 1);
  assert.equal(r.perRep[0].rep, 'Sara');
});

test('volume: counts conversations, messages each way and never-replied starts', async () => {
  stub([m('a', 'inbound', 0), m('a', 'outbound', 5), m('c', 'inbound', 0)]);
  const v = await whatsappVolumeReport({ days: 30 });
  assert.equal(v.conversations, 2);
  assert.equal(v.messagesFromCustomers, 2);
  assert.equal(v.messagesWeSent, 1);
  assert.equal(v.newConversationsNeverReplied, 1);
});
