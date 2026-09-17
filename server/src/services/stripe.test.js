import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFeeFils } from './stripe.js';

/**
 * The card fee, in fils. Pure and rounded the way Stripe wants amounts, so
 * the number shown on screen before a payment link is sent is exactly the
 * number the checkout session will carry — never a rounding-drift apart.
 */

test('no fee when the switch is off, however large the charge', () => {
    assert.equal(computeFeeFils(100_000, 0), 0);
});

test('no fee on a zero or negative amount, whatever the percentage', () => {
    assert.equal(computeFeeFils(0, 3), 0);
    assert.equal(computeFeeFils(-500, 3), 0);
});

test('3% of AED 1,000 (100,000 fils) is AED 30 (3,000 fils)', () => {
    assert.equal(computeFeeFils(100_000, 3), 3_000);
});

test('rounds to the nearest fil rather than leaving a fraction Stripe will reject', () => {
    // AED 676.50 at 3% = 20.295 -> rounds to 20.30 (2030 fils), not 2029.5
    assert.equal(computeFeeFils(67_650, 3), 2_030);
});

test('a fractional percentage works the same as a whole one', () => {
    assert.equal(computeFeeFils(100_000, 2.5), 2_500);
});
