import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyRate, contractLeased, unitRow, totals, byFloor, unitsOf, monthlySeries, pickPerUnit } from './rateRealisation.js';

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

/* The trend. It has to be real numbers — an illustrative chart of invented
   financials is worse than no chart. */

const U = (id, price, createdAt) => ({ _id: id, unitNumber: id, floor: 'F1', price, createdAt });
const K = (units, over = {}) => ({
  contractNo: 'C', status: 'active', rate: 800, units,
  startDate: '2026-01-01', endDate: '2026-12-31', ...over,
});
const NOW = new Date('2026-08-15T00:00:00Z');

test('a unit added this month is not counted in earlier months', () => {
  const old = U('old', 1000, '2020-01-01');
  const fresh = U('new', 1000, '2026-08-10');
  const s = monthlySeries([old, fresh], [], { months: 3, now: NOW });

  assert.deepEqual(s.map((m) => m.monthISO), ['2026-06', '2026-07', '2026-08']);
  assert.deepEqual(s.map((m) => m.units), [1, 1, 2]);
  assert.deepEqual(s.map((m) => m.actual), [1000, 1000, 2000]);
});

test('a contract only counts in the months it actually ran', () => {
  const u = U('u', 1000, '2020-01-01');
  const c = K([u], { rate: 800, startDate: '2026-07-05', endDate: '2026-07-25' });
  const s = monthlySeries([u], [c], { months: 3, now: NOW });

  assert.deepEqual(s.map((m) => m.leased), [0, 800, 0]);
  assert.deepEqual(s.map((m) => m.leasedUnits), [0, 1, 0]);
});

test('a unit with no creation date is assumed to have always existed', () => {
  // Rather than vanishing from the trend entirely, which is the worse failure.
  const s = monthlySeries([U('u', 500, undefined)], [], { months: 2, now: NOW });
  assert.deepEqual(s.map((m) => m.actual), [500, 500]);
});

test('the series runs oldest to newest and ends on the current month', () => {
  const s = monthlySeries([U('u', 100, '2020-01-01')], [], { months: 12, now: NOW });
  assert.equal(s.length, 12);
  assert.equal(s[0].monthISO, '2025-09');
  assert.equal(s.at(-1).monthISO, '2026-08');
  assert.deepEqual(s.at(-1).label, 'Aug');
});

test('one contract over two units is counted once per unit, not twice', () => {
  const a = U('a', 1000, '2020-01-01');
  const b = U('b', 1000, '2020-01-01');
  const s = monthlySeries([a, b], [K([a, b], { rate: 1200 })], { months: 1, now: NOW });
  assert.equal(s[0].leasedUnits, 2);
  assert.equal(s[0].leased, 1200);
});

test('an active contract wins over an ended one that overlapped', () => {
  const u = U('u', 1000, '2020-01-01');
  const ended = K([u], { status: 'ended', rate: 500, contractNo: 'OLD' });
  const active = K([u], { status: 'active', rate: 900, contractNo: 'NEW' });
  const held = pickPerUnit([ended, active]);
  assert.equal(held.get('u').contractNo, 'NEW');
  assert.equal(pickPerUnit([active, ended]).get('u').contractNo, 'NEW');
});

test('no units gives a flat series of zeros rather than nothing', () => {
  const s = monthlySeries([], [], { months: 3, now: NOW });
  assert.equal(s.length, 3);
  assert.deepEqual(s.map((m) => m.actual), [0, 0, 0]);
});

test('months before any unit existed are dropped, not drawn as zero', () => {
  // The unit list only goes back to mid-2026; empty bars before that would
  // read as a collapse in revenue rather than as an absence of records.
  const u = U('u', 1000, '2026-07-10');
  const s = monthlySeries([u], [], { months: 12, now: NOW });
  assert.deepEqual(s.map((m) => m.monthISO), ['2026-07', '2026-08']);
});

test('a genuine gap in the middle is kept', () => {
  // Only leading absence is trimmed — a real quiet month still shows.
  const s = monthlySeries([U('u', 1000, '2020-01-01')], [], { months: 3, now: NOW });
  assert.equal(s.length, 3);
});
