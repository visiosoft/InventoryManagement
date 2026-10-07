import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWebsitePricing } from './websitePricing.js';

// Figures from the October 2026 offer sheet.
const units = [
  ...Array.from({ length: 9 }, () => ({ sizeSqf: 10, price: 330, discountPct: 20, status: 'available' })),
  ...Array.from({ length: 4 }, () => ({ sizeSqf: 35, price: 770, discountPct: 5, status: 'available' })),
  { sizeSqf: 25, price: 625, discountPct: 0, status: 'available' },
  { sizeSqf: 100, price: 1600, discountPct: 0, status: 'available' },
  { sizeSqf: 100, price: 1650, discountPct: 0, status: 'available' },
  { sizeSqf: 150, price: 2700, discountPct: 0, status: 'occupied' },
  { sizeSqf: 200, price: 3000, discountPct: 0, status: 'maintenance' },
  { sizeSqf: 50, price: null, discountPct: 15, status: 'available' },
];

const row = (rows, size) => rows.find((r) => r.sizeSqf === size);

test('a discounted size gives the struck-through price, the offer price and the saving', () => {
  const r = row(buildWebsitePricing(units), 10);
  assert.deepEqual(
    { price: r.price, discountPct: r.discountPct, offerPrice: r.offerPrice, savings: r.savings, hasDiscount: r.hasDiscount, available: r.available },
    { price: 330, discountPct: 20, offerPrice: 264, savings: 66, hasDiscount: true, available: 9 },
  );
  assert.equal(row(buildWebsitePricing(units), 35).offerPrice, 731.5);
});

test('an undiscounted size has no discount and the same offer price', () => {
  const r = row(buildWebsitePricing(units), 25);
  assert.equal(r.hasDiscount, false);
  assert.equal(r.offerPrice, 625);
  assert.equal(r.savings, 0);
});

test('units of one size priced differently give a from-price and an upper price', () => {
  const r = row(buildWebsitePricing(units), 100);
  assert.equal(r.price, 1600);
  assert.equal(r.priceTo, 1650);
  assert.equal(r.hasPriceRange, true);
});

test('a fully let size still shows its price, with nothing available', () => {
  const r = row(buildWebsitePricing(units), 150);
  assert.equal(r.price, 2700);
  assert.equal(r.available, 0);
});

test('units in maintenance and units with no price are left out', () => {
  const sizes = buildWebsitePricing(units).map((r) => r.sizeSqf);
  assert.ok(!sizes.includes(200));
  assert.ok(!sizes.includes(50));
  assert.deepEqual(sizes, [10, 25, 35, 100, 150]);
});

test('sizes can be filtered, and come back smallest first', () => {
  assert.deepEqual(buildWebsitePricing(units, { sizes: [100, 10] }).map((r) => r.sizeSqf), [10, 100]);
});

test('a discount is clamped to 0-100', () => {
  const r = buildWebsitePricing([{ sizeSqf: 10, price: 100, discountPct: 150, status: 'available' }])[0];
  assert.equal(r.discountPct, 100);
  assert.equal(r.offerPrice, 0);
});
