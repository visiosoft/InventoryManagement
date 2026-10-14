import test from 'node:test';
import assert from 'node:assert/strict';
import { judgePayment, openingInvoices } from './contractPayment.js';

const inv = (no, date, extra = {}) => ({ invoiceNo: no, invoiceDate: date, status: 'sent', zohoBooksSyncId: `z-${no}`, ...extra });

test('opening invoices are the first one and anything raised within 3 days of it', () => {
  const list = [inv('A', '2026-09-01'), inv('B', '2026-09-02'), inv('C', '2026-10-01'), inv('X', '2026-09-01', { status: 'cancelled' })];
  assert.deepEqual(openingInvoices(list).map((i) => i.invoiceNo), ['A', 'B']);
});
test('no invoice means not verified', () => {
  assert.equal(judgePayment({ opening: [], zohoConfigured: true }).verified, false);
});
test('Zoho paid verifies; unpaid, unmatched or unsynced does not', () => {
  const opening = [inv('A', '2026-09-01')];
  const paid = new Map([['z-A', { status: 'paid' }]]);
  assert.equal(judgePayment({ opening, zohoConfigured: true, zohoMatched: true, zohoById: paid }).verified, true);
  assert.equal(judgePayment({ opening, zohoConfigured: true, zohoMatched: true, zohoById: new Map([['z-A', { status: 'sent' }]]) }).verified, false);
  assert.equal(judgePayment({ opening, zohoConfigured: true, zohoMatched: false, zohoById: new Map() }).verified, false);
  assert.equal(judgePayment({ opening: [inv('A', '2026-09-01', { zohoBooksSyncId: null })], zohoConfigured: true, zohoMatched: true, zohoById: paid }).verified, false);
});
test('every opening invoice must be paid', () => {
  const opening = [inv('A', '2026-09-01'), inv('B', '2026-09-02')];
  const half = new Map([['z-A', { status: 'paid' }], ['z-B', { status: 'sent' }]]);
  assert.equal(judgePayment({ opening, zohoConfigured: true, zohoMatched: true, zohoById: half }).verified, false);
});
test('without Zoho it falls back to our own invoice status', () => {
  assert.equal(judgePayment({ opening: [inv('A', '2026-09-01', { status: 'paid' })], zohoConfigured: false }).verified, true);
});
