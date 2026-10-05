import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPaymentDueDigest, DUE_SOON_DAYS } from './paymentDueDigest.js';

const NOW = new Date('2026-09-04T06:00:00.000Z');

const dueRow = (overrides = {}) => ({
  dueDate: new Date('2026-09-11T00:00:00.000Z'),
  contract: {
    contractNo: 'C-2026-0042',
    customer: { fullName: 'Ahmed Khan' },
    unit: { unitNumber: 'F2-37' },
    rate: 1200,
  },
  ...overrides,
});

test('the fallback wording is used when no template has been saved yet', () => {
  const digest = buildPaymentDueDigest({ due: [dueRow()], template: null, now: NOW });
  assert.match(digest.subject, /Payments due in 7 days — 1 tenant\(s\)/);
  assert.match(digest.text, /due in 7 days, on/);
});

test('a saved template\'s subject and intro are used, with @count/@days/@date filled in', () => {
  const template = {
    subject: '@count payment(s) coming up',
    emailBody: 'Heads up — @count due in @days days.',
  };
  const digest = buildPaymentDueDigest({ due: [dueRow(), dueRow()], template, now: NOW });
  assert.equal(digest.subject, '2 payment(s) coming up');
  assert.match(digest.text, /Heads up — 2 due in 7 days\./);
});

test('every tenant on the list appears, with their unit, contract and amount', () => {
  const digest = buildPaymentDueDigest({
    due: [dueRow(), dueRow({ contract: { contractNo: 'C-2026-0099', customer: { fullName: 'Sara Ali' }, unit: { unitNumber: 'G1-02' }, rate: 1200 } })],
    template: null, now: NOW,
  });
  assert.match(digest.text, /Ahmed Khan — Unit F2-37 — C-2026-0042 — AED 1,200.00 — due 11 Sept? 2026/);
  assert.match(digest.text, /Sara Ali — Unit G1-02 — C-2026-0099/);
});

test('a tenant on multiple units is listed with all of them, not just the first', () => {
  const digest = buildPaymentDueDigest({
    due: [dueRow({ contract: { contractNo: 'C-1', customer: { fullName: 'Multi Unit' }, units: [{ unitNumber: 'A1' }, { unitNumber: 'A2' }], rate: 1200 } })],
    template: null, now: NOW,
  });
  assert.match(digest.text, /Unit A1, A2/);
});

test('a tenant name with markup in it cannot break the email', () => {
  const digest = buildPaymentDueDigest({
    due: [dueRow({ contract: { contractNo: 'C-1', customer: { fullName: '<script>alert(1)</script>' }, unit: { unitNumber: 'A1' }, rate: 1200 } })],
    template: null, now: NOW,
  });
  assert.ok(!digest.html.includes('<script>'), 'it is escaped');
  assert.match(digest.html, /&lt;script&gt;/);
});

test('the amount shown is the contract\'s full rate — no cycle after the first ever carries a discount', () => {
  const digest = buildPaymentDueDigest({
    due: [dueRow({ contract: { contractNo: 'C-1', customer: { fullName: 'Full Rate' }, unit: { unitNumber: 'A1' }, rate: 900, firstMonthDiscountPct: 15 } })],
    template: null, now: NOW,
  });
  assert.match(digest.text, /AED 900\.00/);
});

test('the lead time is 7 days, matching accounts asking for a week\'s notice', () => {
  assert.equal(DUE_SOON_DAYS, 7);
});
