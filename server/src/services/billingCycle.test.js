import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPaymentDueDate } from './billingCycle.js';

// The bug this fixes: "Next payment due" used to be the soonest unpaid local
// Payment record, which nothing keeps current for an ongoing contract billed
// through Zoho — it could sit on a contract's original start date a year
// into the lease. This is a pure calendar calculation instead: PurpleBox
// collects rent every 4 weeks from the contract's start date, full stop.

const days = (n) => n * 86_400_000;

test('a contract that started today is still in its prepaid first cycle — next due is 28 days out', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const due = nextPaymentDueDate({ startDate: now, endDate: null, now });
  assert.equal(due.toISOString(), new Date(now.getTime() + days(28)).toISOString());
});

test('a contract 30 days into its term has already crossed the 28-day boundary — next due jumps to day 56', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const now = new Date(start.getTime() + days(30));
  const due = nextPaymentDueDate({ startDate: start, endDate: null, now });
  assert.equal(due.toISOString(), new Date(start.getTime() + days(56)).toISOString());
});

test('exactly on a 28-day boundary, next due is that same day — due today, not pushed to the next cycle', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const now = new Date(start.getTime() + days(28));
  const due = nextPaymentDueDate({ startDate: start, endDate: null, now });
  assert.equal(due.toISOString(), now.toISOString());
});

test('a second boundary, further out, behaves the same way as the first', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const now = new Date(start.getTime() + days(56));
  const due = nextPaymentDueDate({ startDate: start, endDate: null, now });
  assert.equal(due.toISOString(), now.toISOString());
});

test('a contract in its last partial cycle, past the point another full cycle would fit, has no next due', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  // Two days past the day-28 boundary, the next candidate due date is day 56
  // — but the contract ends on day 35, well before that, so there is no room
  // for another cycle to be billed before the lease is over.
  const end = new Date(start.getTime() + days(35));
  const now = new Date(start.getTime() + days(30));
  assert.equal(nextPaymentDueDate({ startDate: start, endDate: end, now }), null);
});

test('a contract with room for exactly one more cycle before it ends still returns that date', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const end = new Date(start.getTime() + days(28)); // ends exactly on the boundary
  const now = new Date(start.getTime() + days(1));
  const due = nextPaymentDueDate({ startDate: start, endDate: end, now });
  assert.equal(due.toISOString(), end.toISOString());
});

test('the date only ever advances by exactly 28 days at a time across consecutive days, never skipping or repeating', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const seen = new Set();
  for (let d = 0; d < 90; d++) {
    const now = new Date(start.getTime() + days(d));
    const due = nextPaymentDueDate({ startDate: start, endDate: null, now });
    seen.add(due.toISOString());
    // The due date can never be in the past relative to "now".
    assert.ok(due.getTime() >= now.getTime(), `day ${d}: due date must not be before now`);
    // It can never be more than one full cycle beyond "now" either — that
    // would mean it skipped a boundary it should have landed on first.
    assert.ok(due.getTime() - now.getTime() <= days(28), `day ${d}: due date jumped further than one cycle ahead`);
  }
  // Over a 90-day window (d = 0..89) the boundaries reached are 28, 56, 84
  // and 112 (the last few days, 85..89, are already past day 84 and into the
  // next cycle) — four distinct values, each 28 days apart from the last.
  assert.equal(seen.size, 4);
});
