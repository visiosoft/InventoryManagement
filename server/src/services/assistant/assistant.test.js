import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figuresGrounded } from './index.js';

/* The check that turns "never guess" from a prompt into a property. */

const results = [{ tool: 'units_available', result: { count: 7, units: [{ unitNumber: 'F2-64', monthlyPrice: 1647 }] } }];

test('a figure the tools returned is allowed, however it is formatted', () => {
   assert.equal(figuresGrounded('There are 7 free. F2-64 is AED 1,647 a month.', results).ok, true);
});

test('a figure the tools did not return is caught', () => {
   const out = figuresGrounded('About 1,600 a month, so roughly 19,000 a year.', results);
   assert.equal(out.ok, false);
   assert.deepEqual(out.loose, ['1,600', '19,000']);
});

test('single digits are not treated as facts — they are ordinals and list markers', () => {
   assert.equal(figuresGrounded('1. F2-64\n2. nothing else', results).ok, true);
});

test('an answer with no numbers is always grounded', () => {
   assert.equal(figuresGrounded("I can't see that in the system.", []).ok, true);
});
