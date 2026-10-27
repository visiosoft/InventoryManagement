import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pricingReview } from './pricingReview.js';

test('per size and floor: occupancy, list price, what tenants pay, and demand against what is free', () => {
   const units = [
      { _id: 'a', sizeSqf: 50, floor: 'F1', price: 1080 },
      { _id: 'b', sizeSqf: 50, floor: 'F1', price: 1080 },
      { _id: 'c', sizeSqf: 50, floor: 'F2', price: 990 },
      { _id: 'd', sizeSqf: 150, floor: 'F1', price: 2700 },
      { _id: 'e', sizeSqf: 150, floor: 'F1', price: 2700, status: 'maintenance' },
   ];
   const rows = pricingReview({
      units, takenIds: new Set(['a', 'c']), leasedByUnit: new Map([['a', 1000], ['c', 950]]),
      askedSizes: [50, 50, 50, 50, 150, 0],
   });
   const f1 = rows.find((r) => r.sizeSqf === 50 && r.floor === 'F1');
   assert.deepEqual([f1.units, f1.free, f1.occupancyPct, f1.listPrice, f1.avgLeased], [2, 1, 50, 1080, 1000]);
   assert.equal(f1.enquiriesForSize, 4);
   assert.equal(f1.enquiriesPerFreeUnitOfSize, 4, '4 asked, 1 free 50 sq ft across floors');
   const big = rows.find((r) => r.sizeSqf === 150);
   assert.deepEqual([big.units, big.free, big.occupancyPct], [1, 1, 0], 'maintenance units left out');
});
