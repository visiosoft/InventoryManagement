import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceLine } from './aiBot.js';

test('the agents quote the website offer: the first month at the discounted price', () => {
   assert.equal(priceLine(50, { total: 106, prices: [975, 975], discounts: [15] }), '50 sqft: AED 975 per 4 weeks — first month 15% off: AED 828.75 (106 units)');
   assert.equal(priceLine(10, { total: 21, prices: [330], discounts: [20] }), '10 sqft: AED 330 per 4 weeks — first month 20% off: AED 264 (21 units)');
   assert.equal(priceLine(100, { total: 25, prices: [1600, 1650], discounts: [] }), '100 sqft: AED 1,600–1,650 per 4 weeks (25 units)');
   assert.equal(priceLine(80, { total: 1, prices: [], discounts: [] }), '80 sqft: price on request');
});
