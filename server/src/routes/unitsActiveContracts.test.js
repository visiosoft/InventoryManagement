import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Contract } from '../models/index.js';
import unitsRouter from './units.js';

// GET /units/active-contracts feeds the Units page's Tenant / Check out /
// Leased columns. No database here: Contract.find is replaced with a chain
// that returns these contracts.
const u = (id, price) => ({ _id: id, price });
const contracts = [
  // one tenant, one unit, discounted: asks 330, pays 300
  { _id: 'c1', contractNo: 'PB-1', customer: { fullName: 'Layla' }, unit: u('u1', 330), units: [], endDate: '2026-10-08', rate: 330, leasedPrice: 300 },
  // a shared unit: two tenants on u2, each with their own contract
  { _id: 'c2', contractNo: 'PB-2', customer: { fullName: 'Omar' }, unit: u('u2', 975), units: [], endDate: '2026-09-01', rate: 500, leasedPrice: null, firstMonthDiscountPct: 0 },
  { _id: 'c3', contractNo: 'PB-3', customer: { fullName: 'Sara' }, unit: u('u2', 975), units: [], endDate: '2026-10-10', rate: 475, leasedPrice: null, firstMonthDiscountPct: 0 },
  // one contract over two units asking 1000 and 3000, paying 2000 in all
  { _id: 'c4', contractNo: 'PB-4', customer: { fullName: 'Acme' }, unit: u('u3', 1000), units: [u('u3', 1000), u('u4', 3000)], endDate: '2026-11-01', rate: 2000, leasedPrice: 2000 },
];

async function get() {
  const chain = { select: () => chain, populate: () => chain, sort: () => chain, lean: async () => contracts };
  Contract.find = () => chain;
  const app = express().use('/units', unitsRouter);
  const srv = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/units/active-contracts`);
    return (await r.json()).byUnit;
  } finally { srv.close(); }
}

test('each tenant carries what they actually pay for the unit', async () => {
  const by = await get();
  assert.equal(by.u1[0].leased, 300);
  assert.deepEqual(by.u2.map((c) => [c.customerName, c.leased]), [['Omar', 500], ['Sara', 475]]);
});

test('one contract over several units is shared out by what each unit asks, not repeated', async () => {
  const by = await get();
  assert.equal(by.u3[0].leased, 500);   // 2000 x 1000/4000
  assert.equal(by.u4[0].leased, 1500);  // 2000 x 3000/4000
  assert.equal(by.u3[0].leased + by.u4[0].leased, 2000);
});

test('the existing fields are unchanged', async () => {
  const by = await get();
  assert.deepEqual(
    { contractId: by.u1[0].contractId, contractNo: by.u1[0].contractNo, customerName: by.u1[0].customerName, endDate: by.u1[0].endDate },
    { contractId: 'c1', contractNo: 'PB-1', customerName: 'Layla', endDate: '2026-10-08' },
  );
});
