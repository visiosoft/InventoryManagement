import test from 'node:test';
import assert from 'node:assert/strict';
import { Lead, WhatsAppMessage, Task, User } from '../models/index.js';
import { AgentAction } from '../agents/models.js';
import { leadFollowUpFile, followUpAdherence } from './followUps.js';

const D = 864e5;
const chain = (rows) => { const c = { populate: () => c, sort: () => c, limit: () => c, select: () => c, lean: async () => rows }; return c; };

test('lead follow-up file: overdue plan, what the rep did, the conversation and whose turn it is', async () => {
  const lead = { _id: 'l1', fullName: 'Ali', phone: '0501234567', phoneNormalized: '971501234567', status: 'follow_up_scheduled', owner: { name: 'Sara' }, followUpAt: new Date(Date.now() - 3 * D), attempts: [{ no: 1, at: new Date(Date.now() - 5 * D), channel: 'call', outcome: 'no_answer', note: 'rang twice' }], timeline: [], leadDateTime: new Date() };
  Lead.findOne = () => chain(lead);
  WhatsAppMessage.find = () => chain([{ direction: 'inbound', occurredAt: new Date(), text: 'can you send the price?', type: 'text' }, { direction: 'outbound', occurredAt: new Date(Date.now() - 4 * D), text: 'Hello Ali', type: 'text', sentByAi: false }]);
  Task.find = () => chain([]);
  AgentAction.find = () => chain([{ kind: 'reply_drafted', summary: 'draft', at: new Date() }]);
  const f = await leadFollowUpFile({ phone: '0501234567' });
  assert.match(f.followUpPlan.dueStatus, /OVERDUE by 3/);
  assert.equal(f.whatTheRepDid[0].outcome, 'no_answer');
  assert.equal(f.conversation[f.conversation.length - 1].who, 'CUSTOMER');
  assert.match(f.whoseTurn, /we owe them a reply/);
  assert.equal(f.proposalsWaitingForApproval.length, 1);
});

test('adherence: on time, late and missed follow-ups are told apart per rep', async () => {
  const due = (days) => new Date(Date.now() - days * D);
  Lead.find = () => chain([
    { _id: 'a', owner: 'u1', phoneNormalized: 'a', followUpAt: due(5), attempts: [], fullName: 'A', status: 'contacted' },
    { _id: 'b', owner: 'u1', phoneNormalized: 'b', followUpAt: due(5), attempts: [], fullName: 'B', status: 'contacted' },
    { _id: 'c', owner: 'u1', phoneNormalized: 'c', followUpAt: due(5), attempts: [], fullName: 'C', status: 'contacted' },
  ]);
  User.find = () => chain([{ _id: 'u1', name: 'Sara' }]);
  WhatsAppMessage.find = () => chain([{ phoneNormalized: 'a', occurredAt: due(5 - 0.2) }, { phoneNormalized: 'b', occurredAt: due(5 - 3) }]);
  const r = await followUpAdherence({ days: 14 });
  assert.deepEqual([r.totals.onTime, r.totals.late, r.totals.missed], [1, 1, 1]);
  assert.equal(r.missedFollowUps[0].name, 'C');
});
