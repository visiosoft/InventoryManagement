import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneSuffixes } from './dealCredit.js';

/* creditFor and markLeadWon talk to the database, so what is asserted here is
   the part that decides anything without one: which numbers are considered the
   same person. The credit rule itself is checked against production in
   scripts/backfill-deal-credit.mjs --dry, which prints every decision before
   anything is written. */

test('a number is matched on its last nine digits, however it is written', () => {
   const forms = {
      phone: '+971 55 464 4265',
      phones: ['0554644265', '971-55-464-4265', '971554644265'],
   };
   const out = phoneSuffixes(forms);
   assert.equal(new Set(out).size, 1, `expected one number, got ${JSON.stringify(out)}`);
   assert.equal(out[0], '554644265');
});

test('the last nine digits are what a stored number ends with', () => {
   // This is the join: the suffix must match the tail of 971554644265.
   const [suffix] = phoneSuffixes({ phone: '055 464 4265' });
   assert.ok('971554644265'.endsWith(suffix));
});

test('numbers too short to identify anybody are ignored', () => {
   // An extension or a partial would otherwise match half the database.
   assert.deepEqual(phoneSuffixes({ phone: '4265', phones: ['12345678'] }), []);
});

test('a customer with no number at all yields nothing to match on', () => {
   assert.deepEqual(phoneSuffixes({}), []);
   assert.deepEqual(phoneSuffixes(null), []);
   assert.deepEqual(phoneSuffixes({ phone: '', phones: [] }), []);
});

test('every number held for somebody is offered, not just the first', () => {
   const out = phoneSuffixes({ phone: '971501014489', phones: ['971554644265'] });
   assert.equal(out.length, 2);
   assert.ok(out.includes('501014489'));
   assert.ok(out.includes('554644265'));
});
