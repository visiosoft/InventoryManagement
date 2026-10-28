import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixFrom, sizeFor } from './inventoryMix.js';
import { scoreContract } from './churnRisk.js';

const date = new Date('2026-10-28T10:00:00Z');

test('requests round up to the next size we have', () => {
   assert.equal(sizeFor(30, [10, 25, 35, 50]), 35);
   assert.equal(sizeFor(500, [10, 25]), 25);
   assert.equal(sizeFor(0, [10]), null);
});

test('stock-out caused by maintenance, oversupply, and totals that match occupancy', () => {
   const units = [
      ...[1, 2].map((i) => ({ _id: `a${i}`, sizeSqf: 25, status: 'maintenance' })),
      { _id: 'a3', sizeSqf: 25, status: 'occupied' },
      ...[1, 2, 3, 4].map((i) => ({ _id: `b${i}`, sizeSqf: 50, status: 'available', createdAt: '2026-10-01' })),
   ];
   const contracts = [{ status: 'active', startDate: '2026-09-01', endDate: '2026-12-01', unit: 'a3' }];
   const leads = [{ storageSizeValue: 20 }, { storageSizeValue: 25 }, { storageSizeValue: 50 }];
   const m = mixFrom({ units, contracts, leads, date });
   const s25 = m.rows.find((r) => r.size === 25);
   const s50 = m.rows.find((r) => r.size === 50);
   assert.deepEqual(s25.flags, ['stockout_maintenance']);
   assert.equal(s25.demand, 2);
   assert.equal(s50.available, 4);
   assert.equal(s50.avgDaysVacant, 27);
   assert.equal(m.totals.occupied, 1);
});

test('churn points follow the rules', () => {
   const now = new Date('2026-10-28T10:00:00Z');
   const c = { renewalIntent: 'not_renewing', startDate: '2026-10-01', endDate: '2026-11-01', renewalHistory: [{ reason: 'extension_short' }, { reason: 'extension_long' }] };
   const r = scoreContract(c, { latePayments90: 2, now });
   assert.equal(r.score, 40 + 20 + 10 + 10);
   assert.equal(scoreContract({ renewalIntent: 'undecided', startDate: '2025-01-01', endDate: '2026-11-02' }, { now }).score, 25);
});
