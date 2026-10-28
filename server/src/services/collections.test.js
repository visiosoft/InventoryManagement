import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageFor, promiseOutcome } from './collections.js';

test('stage from payments unless a person set one', () => {
   assert.equal(stageFor({ oldestOverdueDays: null }), 'current');
   assert.equal(stageFor({ oldestOverdueDays: 0, dueToday: true }), 'due');
   assert.equal(stageFor({ oldestOverdueDays: 5 }), 'reminder_1');
   assert.equal(stageFor({ oldestOverdueDays: 30 }), 'reminder_2');
   assert.equal(stageFor({ manualState: 'payment_plan', oldestOverdueDays: 30 }), 'payment_plan');
});

test('a promise is kept by payment, broken only after its day', () => {
   const p = { amount: 500, promisedDate: new Date('2026-10-28T19:59:59Z') };
   assert.equal(promiseOutcome(p, 500, new Date('2026-10-28T10:00:00Z')), 'kept');
   assert.equal(promiseOutcome(p, 200, new Date('2026-10-28T22:00:00Z')), 'open');
   assert.equal(promiseOutcome(p, 200, new Date('2026-10-29T21:00:00Z')), 'broken');
});
