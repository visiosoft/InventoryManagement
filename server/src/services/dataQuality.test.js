import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conditionsFrom } from './dataQuality.js';

const base = { duplicateGroupCount: 0, maintenanceWithoutTicket: 0, contractsPastEnd: 0, unitStatusMismatches: 0 };
const wed = new Date('2026-10-28T10:00:00Z');

test('today’s data: payments stale and duplicates are listed', () => {
   const c = conditionsFrom({ ...base, now: wed, lastPaymentAt: new Date('2026-08-17'), duplicateGroupCount: 519 });
   assert.deepEqual(c.map((x) => x.key), ['payments_stale', 'duplicate_payments']);
   assert.equal(c[0].count, 72);
});

test('clearing duplicates removes that condition; fresh payments raise nothing', () => {
   assert.deepEqual(conditionsFrom({ ...base, now: wed, lastPaymentAt: new Date('2026-10-28T06:00:00Z') }), []);
});

test('a weekend alone does not make payments stale', () => {
   const sat = new Date('2026-10-31T10:00:00Z');
   assert.deepEqual(conditionsFrom({ ...base, now: sat, lastPaymentAt: new Date('2026-10-29T06:00:00Z') }), []);
});
