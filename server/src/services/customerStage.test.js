import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageFilter, promotion } from './customerStage.js';

test('an absent stage means tenant, because that is what it meant', () => {
   /* Every record written before the field existed was a customer as far as
      the app was concerned. Asking for `stage: 'customer'` would hide all 354
      of them, so tenants are "not a prospect" rather than "is a customer". */
   assert.deepEqual(stageFilter('customer'), { stage: { $ne: 'prospect' } });
   assert.deepEqual(stageFilter('prospect'), { stage: 'prospect' });
});

test('asking for nothing means everybody', () => {
   /* Every quote, booking and invoice screen searches this endpoint to find
      somebody to raise a document for, and a prospect is exactly who those are
      raised for. Filtering by default would hide the people the whole change
      exists to serve. */
   assert.deepEqual(stageFilter(''), {});
   assert.deepEqual(stageFilter('all'), {});
   assert.deepEqual(stageFilter(undefined), {});
});

test('a contract promotes, and records the day it happened', () => {
   const at = new Date('2026-09-04T09:00:00.000Z');
   const { filter, update } = promotion('c1', at);
   assert.equal(filter._id, 'c1');
   assert.equal(update.$set.stage, 'customer');
   assert.equal(update.$set.becameCustomerAt, at);
});

test('a second contract does not move the day they became a tenant', () => {
   // The filter excludes anybody who is already one, so the write is a no-op
   // for them rather than a re-stamp.
   assert.deepEqual(promotion('c1').filter.stage, { $ne: 'customer' });
});
