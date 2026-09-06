import test from 'node:test';
import assert from 'node:assert/strict';
import {
    daysBetween,
    weeksBetween,
    weeklyRateFrom,
    renewalMonthlyRate,
    priceRenewal,
    renewalChoices,
    validateNewEndDate,
} from './renewalPricing.js';

/**
 * The renewal price a tenant is shown, charged, and later invoiced.
 *
 * These three have to be the same number. The tests below are mostly about the
 * ways they could quietly stop being the same one: a part week rounding down, a
 * unit with no price summing to zero, a date that produces a zero-amount
 * charge, VAT landing on the card fee.
 */

test('a part week is charged as a whole week — no per-day maths', () => {
    const from = '2026-10-01';
    assert.equal(weeksBetween(from, '2026-10-08'), 1);   // exactly 7 days
    assert.equal(weeksBetween(from, '2026-10-09'), 2);   // 8 days → 2 weeks
    assert.equal(weeksBetween(from, '2026-10-14'), 2);   // 13 days is still 2
    assert.equal(weeksBetween(from, '2026-10-15'), 2);   // 14 days → exactly 2
    assert.equal(weeksBetween(from, '2026-10-16'), 3);   // one day over
});

test('a week is a quarter of the monthly rate, never a seventh of anything', () => {
    assert.equal(weeklyRateFrom(1500), 375);
    assert.equal(weeklyRateFrom(1000), 250);
    // 330/4 = 82.5 — the smallest unit's real price, must not lose the half
    assert.equal(weeklyRateFrom(330), 82.5);
});

test('a period ending before it starts is zero weeks, not a negative charge', () => {
    assert.equal(weeksBetween('2026-10-08', '2026-10-01'), 0);
    assert.equal(weeksBetween('2026-10-01', '2026-10-01'), 0);
});

test('time of day cannot buy or lose a week', () => {
    // The contract end date carries a timestamp; the picker sends a bare date.
    const withTime = new Date('2026-10-01T22:30:00.000Z');
    assert.equal(weeksBetween(withTime, '2026-10-08'), 1);
    assert.equal(daysBetween(withTime, '2026-10-08'), 7);
});

test('the renewal is priced at the current list price, not the old contract rate', () => {
    const contract = { rate: 1200 };
    const units = [{ price: 1500 }];
    const out = renewalMonthlyRate(contract, units);
    assert.equal(out.monthlyRate, 1500);
    assert.equal(out.source, 'list');
    // The old rate is still reported, so the page can show what they used to pay
    assert.equal(out.contractRate, 1200);
});

test('several units on one contract are summed', () => {
    const out = renewalMonthlyRate({ rate: 2000 }, [{ price: 1500 }, { price: 900 }]);
    assert.equal(out.monthlyRate, 2400);
    assert.equal(out.source, 'list');
});

test('a unit with no price falls back to the contract rate rather than pricing it at zero', () => {
    // Unit.price defaults to null, so this is the ordinary state of an
    // un-priced unit — not a corrupt record.
    const out = renewalMonthlyRate({ rate: 1200 }, [{ price: 1500 }, { price: null }]);
    assert.equal(out.monthlyRate, 1200, 'must not quote 1,500 for two units');
    assert.equal(out.source, 'contract');
});

test('a contract with no units at all still prices from its own rate', () => {
    const out = renewalMonthlyRate({ rate: 800 }, []);
    assert.equal(out.monthlyRate, 800);
    assert.equal(out.source, 'contract');
});

test('VAT is charged on the rent, and the total is rent plus VAT', () => {
    const p = priceRenewal({ monthlyRate: 1500, from: '2026-10-01', to: '2026-10-29' });
    assert.equal(p.weeks, 4);
    assert.equal(p.weeklyRate, 375);
    assert.equal(p.subTotal, 1500);
    assert.equal(p.vatAmount, 75);
    assert.equal(p.total, 1575);
});

test('the card fee sits outside the total, so bank transfer is not quoted the card price', () => {
    const p = priceRenewal({ monthlyRate: 1500, from: '2026-10-01', to: '2026-10-29', cardFeePct: 3 });
    assert.equal(p.total, 1575, 'what is owed does not depend on how it is paid');
    assert.equal(p.cardFeeAmount, 47.25);
    assert.equal(p.totalWithCardFee, 1622.25);
});

test('the card fee is taken on the VAT-inclusive total, since that is what Stripe moves', () => {
    const p = priceRenewal({ monthlyRate: 1000, from: '2026-10-01', to: '2026-10-29', cardFeePct: 3 });
    assert.equal(p.subTotal, 1000);
    assert.equal(p.total, 1050);
    // 3% of 1050, not 3% of 1000 — Stripe's cut is on the amount it processes
    assert.equal(p.cardFeeAmount, 31.5);
});

test('no discount is ever applied — a renewal is always past the first four weeks', () => {
    // The same 4 weeks as a first month, but at full rate: the discount rule
    // belongs to the start of a contract and must not reappear here.
    const p = priceRenewal({ monthlyRate: 1500, from: '2026-10-01', to: '2026-10-29' });
    assert.equal(p.subTotal, 1500, 'not 1,350 — no first-month discount on a renewal');
});

test('presets are priced from the current end date and land on whole weeks', () => {
    const choices = renewalChoices({ monthlyRate: 1500, from: '2026-10-01' });
    assert.equal(choices.length, 4);
    const [four, twelve] = choices;
    assert.equal(four.weeks, 4);
    assert.equal(four.endDate, '2026-10-29');
    assert.equal(four.total, 1575);
    assert.equal(twelve.weeks, 12);
    assert.equal(twelve.subTotal, 4500);
});

test('a date inside the current term is refused rather than charged as zero', () => {
    // This is the one that would reach Stripe as a zero-amount session and fail
    // with an error the tenant can do nothing about.
    const out = validateNewEndDate({ currentEndDate: '2026-10-01', newEndDate: '2026-09-20' });
    assert.equal(out.ok, false);
    assert.match(out.error, /at least a week/i);
});

test('the current end date itself is not a renewal', () => {
    const out = validateNewEndDate({ currentEndDate: '2026-10-01', newEndDate: '2026-10-01' });
    assert.equal(out.ok, false);
});

test('a mistyped year is refused instead of invoicing nine years of storage', () => {
    const out = validateNewEndDate({ currentEndDate: '2026-10-01', newEndDate: '2035-10-01' });
    assert.equal(out.ok, false);
    assert.match(out.error, /contact us/i);
});

test('an ordinary renewal passes and reports its weeks', () => {
    const out = validateNewEndDate({ currentEndDate: '2026-10-01', newEndDate: '2027-04-01' });
    assert.equal(out.ok, true);
    assert.equal(out.weeks, 26);
});

test('a contract with no end date cannot be renewed from', () => {
    const out = validateNewEndDate({ currentEndDate: null, newEndDate: '2027-04-01' });
    assert.equal(out.ok, false);
    assert.match(out.error, /no end date/i);
});

test('rubbish in the date field is refused, not treated as today', () => {
    const out = validateNewEndDate({ currentEndDate: '2026-10-01', newEndDate: 'next tuesday' });
    assert.equal(out.ok, false);
    assert.match(out.error, /valid date/i);
});
