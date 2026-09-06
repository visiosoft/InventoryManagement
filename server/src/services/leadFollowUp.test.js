import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketOf } from './leadFollowUp.js';

/**
 * The dashboard chart's buckets — the one piece of this feature that has no
 * database behind it and can be pinned exactly.
 */

test('the boundary at 4 days sits with the first bucket, not the second', () => {
    assert.equal(bucketOf(3), '3-4 days');
    assert.equal(bucketOf(4), '3-4 days');
    assert.equal(bucketOf(5), '5-6 days');
});

test('the boundary at 6 days sits with the second bucket, not the third', () => {
    assert.equal(bucketOf(6), '5-6 days');
    assert.equal(bucketOf(7), '7+ days');
});

test('a long-quiet lead still lands in the top bucket, not off the chart', () => {
    assert.equal(bucketOf(45), '7+ days');
});

test('missing or invalid input reads as zero rather than throwing', () => {
    assert.equal(bucketOf(undefined), '3-4 days');
    assert.equal(bucketOf(null), '3-4 days');
    assert.equal(bucketOf('not a number'), '3-4 days');
});
