import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { maskLast4, scrubText, redactDeep } from './pii.js';
import { AgentAction } from '../agents/models.js';
import { AutomationLog } from '../models/index.js';

// Made-up numbers in the Emirates ID shape; not real people.
const EID = '784-1990-1234567-1';
const EID_PLAIN = '784199012345671';

test('masks to the last four', () => {
   assert.equal(maskLast4(EID), '****5671');
   assert.equal(maskLast4('N1234567'), '****4567');
   assert.equal(maskLast4(''), '');
});

test('Emirates IDs in free text are masked, other numbers are not', () => {
   const out = scrubText(`ID ${EID} and ${EID_PLAIN}, phone +971501234567, amount 784.50`);
   assert.ok(!out.includes('1234567-1') && !out.includes(EID_PLAIN));
   assert.match(out, /\*\*\*\*5671 and \*\*\*\*5671/);
   assert.match(out, /\+971501234567/);
   assert.match(out, /784\.50/);
});

test('restricted fields are masked at any depth; the input is untouched', () => {
   const id = new mongoose.Types.ObjectId();
   const at = new Date('2026-10-28T10:00:00Z');
   const input = { _id: id, at, customer: { emiratesId: EID, passportNumber: 'P9876543', name: 'Test' }, authorizedPersons: [{ name: 'A', idNumber: EID_PLAIN }], note: `copy of ${EID}` };
   const out = redactDeep(input);
   assert.equal(out.customer.emiratesId, '****5671');
   assert.equal(out.customer.passportNumber, '****6543');
   assert.equal(out.authorizedPersons[0].idNumber, '****5671');
   assert.equal(out.note, 'copy of ****5671');
   assert.equal(out._id, id);
   assert.equal(out.at, at);
   assert.equal(input.customer.emiratesId, EID, 'the stored value is not changed');
   assert.ok(!JSON.stringify(out).includes('1234567'));
});

test('log scrub: a log row cannot keep an identity number', async () => {
   const action = new AgentAction({ kind: 'reply_drafted', summary: `customer sent ${EID}`, detail: { messages: [{ content: `my id is ${EID_PLAIN}` }], customer: { emiratesId: EID } } });
   await action.validate().catch(() => {});
   assert.ok(!JSON.stringify(action.toObject()).includes('1234567'), 'agent action log holds a full ID');
   const log = new AutomationLog({ channel: 'whatsapp', message: `Your ID ${EID} is on file`, error: '' });
   await log.validate().catch(() => {});
   assert.ok(!log.message.includes('1234567'), 'automation log holds a full ID');
});
