import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triggeredRule, DEFAULT_RULES } from './approvals.js';

const on = DEFAULT_RULES.map((r, i) => ({ ...r, _id: String(i), active: true }));
const booked = { status: 'active', rate: 700, leasedPrice: 700, totalQuotation: 700, firstMonthDiscountPct: 0, endDate: new Date('2026-12-01') };

test('rules are off by default: nothing is held', () => {
   assert.equal(triggeredRule(DEFAULT_RULES.map((r) => ({ ...r, active: false })), booked, { rate: 500 }), null);
});

test('active rules catch discounts, rate changes and big check-out moves', () => {
   assert.equal(triggeredRule(on, booked, { firstMonthDiscountPct: 15 }).action, 'discount_pct');
   assert.equal(triggeredRule(on, booked, { firstMonthDiscountPct: 10 }), null);
   assert.equal(triggeredRule(on, booked, { rate: 650 }).action, 'rate_change');
   assert.equal(triggeredRule(on, booked, { rate: 700 }), null, 'saving the same value is no change');
   assert.equal(triggeredRule(on, booked, { endDate: new Date('2026-12-10') }), null);
   assert.equal(triggeredRule(on, booked, { endDate: new Date('2027-01-01') }).action, 'checkout_change');
});

test('a draft contract edits its price freely', () => {
   assert.equal(triggeredRule(on, { ...booked, status: 'draft' }, { rate: 100 }), null);
});
