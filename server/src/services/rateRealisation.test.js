import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyRate, contractLeased, unitRow, totals, byFloor, unitsOf } from './rateRealisation.js';

/* `rate` is the monthly price whatever the billing period — generateSchedule
   states it outright and divides by four to get the weekly payment. Treating a
   weekly contract's rate as weekly and multiplying it up inflates that contract
   fourfold, which is the mistake this test exists to prevent. */

test('a weekly contract stores a monthly rate, and it is left alone', () => {
  assert.equal(monthlyRate({ rate: 4720, billingPeriod: 'weekly' }), 4720);
  assert.equal(monthlyRate({ rate: 4720, billingPeriod: 'monthly' }), 4720);
});

test('an unusable rate is zero rather than NaN', () => {
  for (const c of [{}, { rate: null }, { rate: 'abc' }]) assert.equal(monthlyRate(c), 0);
});

/* What a contract is worth. */

test('a stored leased price wins over the rate', () => {
  assert.equal(contractLeased({ leasedPrice: 2500, rate: 900 }), 2500);
});

// Five real contracts carry leasedPrice 0 on units asking thousands. Read
// literally each is a 100% discount, which is not what happened.
test('a zero leased price is treated as never set, not as let for nothing', () => {
  assert.equal(contractLeased({ leasedPrice: 0, rate: 4720 }), 4720);
});

test('with no stored price the rate is discounted', () => {
  assert.equal(contractLeased({ rate: 1000, firstMonthDiscountPct: 10 }), 900);
});

/* Unit rows. */

const unit = (over) => ({ _id: 'u1', unitNumber: 'F1-1', floor: 'F1', sizeSqf: 150, price: 2700, ...over });

test('a vacant unit still carries its asking price and no discount', () => {
  const r = unitRow(unit(), null);
  assert.equal(r.occupied, false);
  assert.equal(r.actual, 2700);
  assert.equal(r.leased, 0);
  // Nothing was agreed, so there is no discount to report — 100% would be a lie.
  assert.equal(r.discountPct, null);
  assert.equal(r.variance, null);
});

test('a let unit reports the gap against its asking price', () => {
  const r = unitRow(unit(), { contractNo: 'PB-1', rate: 2160, units: [unit()] });
  assert.equal(r.leased, 2160);
  assert.equal(r.variance, -540);
  assert.equal(r.discountPct, 20);
});

test('the weekly case that was being inflated', () => {
  // 4,720 a month against a unit asking 2,700: above asking, not four times it.
  const r = unitRow(unit(), { rate: 4720, billingPeriod: 'weekly', leasedPrice: 0, units: [unit()] });
  assert.equal(r.leased, 4720);
  assert.equal(r.discountPct, -74.8);
});

test('a contract over several units shares its figure by what each unit asks', () => {
  const a = unit({ _id: 'a', unitNumber: 'A', price: 1000 });
  const b = unit({ _id: 'b', unitNumber: 'B', price: 3000 });
  const c = { rate: 2000, units: [a, b] };
  // The cheap unit carries a quarter of it, not half.
  assert.equal(unitRow(a, c).leased, 500);
  assert.equal(unitRow(b, c).leased, 1500);
  assert.equal(unitRow(a, c).leased + unitRow(b, c).leased, 2000);
  assert.equal(unitRow(a, c).sharedWith, 2);
});

test('with no asking prices to weigh, a shared contract splits evenly', () => {
  const a = unit({ _id: 'a', price: null });
  const b = unit({ _id: 'b', price: null });
  assert.equal(unitRow(a, { rate: 1000, units: [a, b] }).leased, 500);
});

test('an unpriced unit reports no percentage rather than zero', () => {
  const r = unitRow(unit({ price: null }), { rate: 900, units: [unit({ price: null })] });
  assert.equal(r.priced, false);
  assert.equal(r.discountPct, null);
  assert.equal(r.leased, 900);
});

/* Totals — where the unit count was going wrong. */

test('vacant units count toward occupancy and the value left standing empty', () => {
  const t = totals([
    unitRow(unit({ _id: '1', price: 1000 }), { rate: 800, units: [unit({ price: 1000 })] }),
    unitRow(unit({ _id: '2', price: 1000 }), null),
    unitRow(unit({ _id: '3', price: 500 }), null),
  ]);
  assert.equal(t.units, 3);
  assert.equal(t.leasedUnits, 1);
  assert.equal(t.vacantUnits, 2);
  assert.equal(t.occupancyPct, 33.3);
  assert.equal(t.actualAll, 2500);     // the whole floor's asking price
  assert.equal(t.actualLet, 1000);     // only what is let
  assert.equal(t.leased, 800);
  assert.equal(t.vacantValue, 1500);
  // The discount is against what was let, not against the empty units too.
  assert.equal(t.discountPct, 20);
});

// The reported bug: 165 units leased across floors holding 156.
test('a unit is counted once however many contracts touched it', () => {
  const u = unit({ _id: 'same', unitNumber: 'F1-1' });
  const t = totals([unitRow(u, { rate: 900, units: [u] })]);
  assert.equal(t.units, 1);
  assert.equal(t.leasedUnits, 1);
});

test('an empty floor totals to zero with no percentages', () => {
  const t = totals([]);
  assert.equal(t.units, 0);
  assert.equal(t.occupancyPct, null);
  assert.equal(t.discountPct, null);
});

test('floors sort naturally and keep every unit', () => {
  const rows = [
    unitRow(unit({ _id: '1', floor: 'F10' }), null),
    unitRow(unit({ _id: '2', floor: 'F2' }), null),
    unitRow(unit({ _id: '3', floor: 'F1' }), null),
  ];
  assert.deepEqual(byFloor(rows).map((f) => f.floor), ['F1', 'F2', 'F10']);
  assert.equal(byFloor(rows).reduce((s, f) => s + f.units, 0), 3);
});

test('unitsOf tolerates both shapes', () => {
  assert.equal(unitsOf({ units: [{}, {}] }).length, 2);
  assert.equal(unitsOf({ unit: {} }).length, 1);
  assert.equal(unitsOf({}).length, 0);
});
