import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FAILURES, afterFailure, autopayAmounts, autopayIdempotencyKey, autopayReady, invoiceDueForAutopay } from './autopayRules.js';

const NOW = new Date('2026-10-12T10:00:00Z');
const inv = (o = {}) => ({ status: 'sent', total: 1000, paymentMade: 0, dueDate: '2026-10-12', cardFeeEnabled: true, cardFeePct: 3, ...o });

test('an invoice due today is charged today; one due tomorrow is not', () => {
  assert.equal(invoiceDueForAutopay(inv({ dueDate: '2026-10-12' }), NOW), true);
  assert.equal(invoiceDueForAutopay(inv({ dueDate: '2026-10-13' }), NOW), false);
  assert.equal(invoiceDueForAutopay(inv({ dueDate: '2026-10-01', status: 'overdue' }), NOW), true);
});

test('paid, draft and cancelled invoices are never charged', () => {
  assert.equal(invoiceDueForAutopay(inv({ status: 'paid' }), NOW), false);
  assert.equal(invoiceDueForAutopay(inv({ status: 'draft' }), NOW), false);
  assert.equal(invoiceDueForAutopay(inv({ status: 'cancelled' }), NOW), false);
  assert.equal(invoiceDueForAutopay(inv({ paymentMade: 1000 }), NOW), false);
});

test('only one attempt per invoice per day', () => {
  assert.equal(invoiceDueForAutopay(inv({ autopay: { lastAttemptAt: '2026-10-12T02:00:00Z', lastStatus: 'failed' } }), NOW), false);
  assert.equal(invoiceDueForAutopay(inv({ autopay: { lastAttemptAt: '2026-10-11T02:00:00Z', lastStatus: 'failed' } }), NOW), true);
});

test('a part-paid invoice is charged only what is left', () => {
  const a = autopayAmounts(inv({ paymentMade: 400 }));
  assert.equal(a.owedFils, 60_000);
  assert.equal(a.feeFils, 1_800); // 3% of AED 600
  assert.equal(a.totalFils, 61_800);
});

test('no fee when the invoice does not carry one', () => {
  const a = autopayAmounts(inv({ cardFeeEnabled: false }));
  assert.equal(a.feeFils, 0);
  assert.equal(a.totalFils, 100_000);
});

test('auto-pay needs the switch, a saved card and a Stripe customer', () => {
  const ok = { stripeCustomerId: 'cus_1', autopay: { enabled: true, paymentMethodId: 'pm_1' } };
  assert.equal(autopayReady(ok), true);
  assert.equal(autopayReady({ ...ok, autopay: { ...ok.autopay, enabled: false } }), false);
  assert.equal(autopayReady({ ...ok, autopay: { enabled: true } }), false);
  assert.equal(autopayReady({ autopay: ok.autopay }), false);
});

test('three failures in a row switch auto-pay off', () => {
  let a = { enabled: true, failureCount: 0 };
  for (let i = 1; i < MAX_FAILURES; i += 1) a = { ...a, ...afterFailure(a, 'declined', NOW) };
  assert.equal(a.enabled, true);
  a = { ...a, ...afterFailure(a, 'declined', NOW) };
  assert.equal(a.enabled, false);
  assert.equal(autopayReady({ stripeCustomerId: 'c', autopay: { ...a, paymentMethodId: 'pm' } }), false);
});

test('the idempotency key is stable within a day and changes the next', () => {
  assert.equal(autopayIdempotencyKey('abc', NOW), autopayIdempotencyKey('abc', new Date('2026-10-12T22:00:00Z')));
  assert.notEqual(autopayIdempotencyKey('abc', NOW), autopayIdempotencyKey('abc', new Date('2026-10-13T10:00:00Z')));
});
