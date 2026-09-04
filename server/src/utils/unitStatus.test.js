import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heldByQuoteFilter } from './unitStatus.js';

/* The filter is the rule. Asserting it directly keeps the four conditions
   honest without a database — each one is here because dropping it puts a
   unit in the wrong state, and the comments say which. */

const UNIT = 'unit-1';
const AT = new Date('2026-09-04T10:00:00.000Z');

test('a quotation holds the unit it names', () => {
   const f = heldByQuoteFilter(UNIT, AT);
   assert.equal(f['units.unit'], UNIT);
});

test('a draft counts, because on this database every quote is one', () => {
   /* Both send actions set 'sent' and not one quote of 57 has ever carried it:
      the team downloads the PDF and sends it by hand. A rule keyed on 'sent'
      would be tidy and would hold nothing at all. */
   const f = heldByQuoteFilter(UNIT, AT);
   assert.ok(f.status.$in.includes('draft'));
   assert.ok(f.status.$in.includes('sent'));
   assert.ok(f.status.$in.includes('accepted'));
});

test('a quote that was turned down holds nothing', () => {
   const f = heldByQuoteFilter(UNIT, AT);
   assert.ok(!f.status.$in.includes('rejected'));
   assert.ok(!f.status.$in.includes('expired'));
});

test('a quote nobody can accept any more holds nothing', () => {
   /* Every quote carries an expiry date and nothing ever swept them, so one
      sent in June still reads as "sent". Without this test a unit quoted
      months ago would be reserved for good. */
   const f = heldByQuoteFilter(UNIT, AT);
   assert.deepEqual(f.expiryDate, { $gte: AT });
});

test('once it converts, the contract decides', () => {
   // Otherwise a signed unit would be reserved by its own quote rather than
   // occupied by the contract that came from it.
   const f = heldByQuoteFilter(UNIT, AT);
   assert.deepEqual(f.contract, { $in: [null, undefined] });
});

test('the moment defaults to now, so callers need not pass one', () => {
   const before = Date.now();
   const f = heldByQuoteFilter(UNIT);
   assert.ok(f.expiryDate.$gte.getTime() >= before);
});
