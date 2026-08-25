import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyRate, actualPrice, leasedPrice, realisationRow, totals, byFloor, unitsOf } from './rateRealisation.js';

/* The billing period is the whole bug. A weekly rate read as a monthly one
   makes a normal contract look like a 75% discount, which is what the pricing
   screen has been showing. */

test('a weekly rate becomes four weeks of it', () => {
  assert.equal(monthlyRate({ rate: 300, billingPeriod: 'weekly' }), 1200);
});

test('a monthly rate is left alone, and a missing period is treated as monthly', () => {
  assert.equal(monthlyRate({ rate: 1200, billingPeriod: 'monthly' }), 1200);
  // Guessing weekly on a record that simply lacks the field would quadruple it.
  assert.equal(monthlyRate({ rate: 1200 }), 1200);
});

test('an unusable rate is zero rather than NaN', () => {
  for (const c of [{}, { rate: null }, { rate: 'abc' }]) assert.equal(monthlyRate(c), 0);
});

/* The asking price. */

test('a contract covering several units is asked against all of them', () => {
  const c = { units: [{ unitNumber: 'F1-1', price: 500 }, { unitNumber: 'F1-2', price: 700 }] };
  assert.equal(actualPrice(c), 1200);
  assert.equal(unitsOf(c).length, 2);
});

test('the older single-unit shape still works', () => {
  assert.equal(actualPrice({ unit: { unitNumber: 'F2-9', price: 450 } }), 450);
});

/* The leased price: one rule, used by the page and the report alike. */

test('a stored leased price wins outright', () => {
  assert.equal(leasedPrice({ leasedPrice: 2500, rate: 900, units: [{ price: 2800 }] }), 2500);
});

// null means "derive it"; 0 is somebody deciding the unit is let for nothing.
test('a deliberate zero is kept, not treated as unset', () => {
  assert.equal(leasedPrice({ leasedPrice: 0, rate: 900, units: [{ price: 2800 }] }), 0);
});

test('otherwise the asking price is discounted, as the contract page does it', () => {
  assert.equal(leasedPrice({ firstMonthDiscountPct: 10, units: [{ price: 2800 }] }), 2520);
});

// The reported case: F1-18 asked 2,800 and shown as leased 583.60.
test('a weekly contract on an unpriced unit is converted before comparison', () => {
  const weekly = { rate: 583.6, billingPeriod: 'weekly', units: [{ unitNumber: 'F1-18', price: null }] };
  assert.equal(leasedPrice(weekly), 2334.4);
  // Read as monthly it would have been 583.60 — a 79% discount that never was.
  assert.notEqual(leasedPrice(weekly), 583.6);
});

test('a discount shows as a positive percentage and a negative variance', () => {
  const row = realisationRow({ leasedPrice: 900, units: [{ unitNumber: 'A', price: 1200 }] });
  assert.equal(row.variance, -300);
  assert.equal(row.discountPct, 25);
});

test('letting above the asking price shows as a negative discount', () => {
  const row = realisationRow({ leasedPrice: 1500, units: [{ unitNumber: 'A', price: 1200 }] });
  assert.equal(row.variance, 300);
  assert.equal(row.discountPct, -25);
});

test('an unpriced unit reports no percentage rather than zero', () => {
  const row = realisationRow({ leasedPrice: 900, units: [{ unitNumber: 'A', price: null }] });
  assert.equal(row.priced, false);
  assert.equal(row.discountPct, null);
  assert.equal(row.variance, null);
  assert.equal(row.leased, 900);
});

/* Roll-ups. */

const row = (over) => realisationRow({ units: [{ unitNumber: 'U', price: 1000, floor: 'F1' }], leasedPrice: 1000, ...over });

test('a total is the sum, and the percentage covers only priced units', () => {
  const t = totals([
    row({ leasedPrice: 500 }),                                              // 50% off, priced
    row({ leasedPrice: 900, units: [{ unitNumber: 'B', price: null }] }),   // unpriced
  ]);
  assert.equal(t.contracts, 2);
  assert.equal(t.actual, 1000);
  assert.equal(t.leased, 1400);        // every leased figure counts as money
  assert.equal(t.leasedOnPriced, 500); // only the comparable one drives the %
  assert.equal(t.discountPct, 50);
  assert.equal(t.unpriced, 1);
});

test('nothing at all totals to zero with no percentage', () => {
  const t = totals([]);
  assert.equal(t.contracts, 0);
  assert.equal(t.actual, 0);
  assert.equal(t.discountPct, null);
});

test('floors are grouped and ordered, and unplaced units named rather than dropped', () => {
  const groups = byFloor([
    row({ units: [{ unitNumber: 'B', price: 1000, floor: 'F2' }] }),
    row({ units: [{ unitNumber: 'A', price: 1000, floor: 'F1' }] }),
    row({ units: [{ unitNumber: 'C', price: 1000, floor: '' }] }),
  ]);
  assert.deepEqual(groups.map((g) => g.floor), ['F1', 'F2', 'No floor']);
  assert.equal(groups.reduce((s, g) => s + g.contracts, 0), 3);
});
