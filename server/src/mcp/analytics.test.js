import test from 'node:test';
import assert from 'node:assert/strict';
import { Contract, Unit, Lead, Quote, Payment, Invoice } from '../models/index.js';
import { forecast, occupancyAndRevenueTrend } from './analytics.js';

const D = 864e5;
const at = (days) => new Date(Date.now() + days * D);
const chain = (rows) => ({ select: () => ({ lean: async () => rows }) });
const c = (i, extra) => ({ _id: String(i), customer: `cust${i}`, unit: `u${i}`, units: [], status: 'active', rate: 1000, startDate: at(-100), endDate: at(60), renewalIntent: 'undecided', ...extra });

function stub(contracts) {
  Unit.countDocuments = async () => 10;
  Contract.find = () => chain(contracts);
  Lead.countDocuments = async () => 4;
  Quote.aggregate = async () => [];
  Payment.aggregate = async () => [];
  Invoice.aggregate = async () => [];
}

test('forecast: a tenant who says they are leaving drops out, one renewing stays', async () => {
  stub([c(1, { endDate: at(10), renewalIntent: 'not_renewing' }), c(2, { endDate: at(10), renewalIntent: 'renewing' }), c(3)]);
  const f = await forecast({ weeks: 4 });
  assert.equal(f.now.occupiedUnits, 3);
  const last = f.weeks[3];
  // week 4 is after both end dates: 3 stays, 2 mostly stays, 1 mostly leaves → about 2 occupied
  assert.ok(last.occupiedUnits.base >= 2 && last.occupiedUnits.base <= 3, `base ${last.occupiedUnits.base}`);
  assert.ok(last.occupiedUnits.low <= last.occupiedUnits.base && last.occupiedUnits.base <= last.occupiedUnits.high);
  assert.equal(f.contractsEndingInWindow.saidNotRenewing, 1);
  assert.match(f.assumptions.renewalRateUsed, /default|real/);
});

test('trend: occupancy at month end comes from contract dates', async () => {
  stub([c(1, { startDate: at(-400), endDate: at(100) }), c(2, { startDate: at(-20), endDate: at(100) })]);
  const t = await occupancyAndRevenueTrend({ months: 3 });
  assert.equal(t.months.length, 3);
  assert.equal(t.months[0].occupiedUnits, 1);
  assert.equal(t.months[2].occupiedUnits, 2);
});

test('data health warns when payments stopped being recorded and when rows look duplicated', async () => {
  const { dataHealth } = await import('./analytics.js');
  Invoice.aggregate = async () => [{ _id: null, at: new Date(Date.now() - 40 * D) }];
  Payment.findOne = () => ({ sort: () => ({ select: () => ({ lean: async () => ({ paidDate: new Date(Date.now() - 50 * D) }) }) }) });
  let n = 0;
  Payment.aggregate = async () => (++n === 1 ? [{ _id: null, extraRows: 3, extraAed: 900 }] : [{ _id: null, n: 10, aed: 5000 }]);
  const w = await dataHealth();
  assert.match(w[0], /No payment has been recorded in the CRM since/);
  assert.ok(w.some((x) => /3 pending payment rows look duplicated.*AED 900/.test(x)));
  assert.ok(w.some((x) => /10 unpaid rows.*120 days/.test(x)));
});

test('forecast does not count a contract\'s primary unit twice', async () => {
  stub([c(1, { units: ['u1'] }), c(2, { units: ['u2'] })]);
  const f = await forecast({ weeks: 1 });
  assert.equal(f.now.occupiedUnits, 2);
  assert.equal(f.weeks[0].occupiedUnits.base, 2 + Math.round(0));
});
