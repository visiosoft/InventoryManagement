import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heldByQuoteFilter, issuedQuoteFilter, QUOTE_ISSUED_STEP, QUOTE_HOLD_DAYS } from './unitStatus.js';

/* The filter is the rule. Asserting it directly keeps the four conditions
   honest without a database — each one is here because dropping it puts a
   unit in the wrong state, and the comments say which. */

const UNIT = 'unit-1';
const AT = new Date('2026-09-04T10:00:00.000Z');

test('a quotation holds the unit it names', () => {
   const f = heldByQuoteFilter(UNIT, AT);
   assert.equal(f['units.unit'], UNIT);
});

test('a draft counts, but only once it is actually a quotation', () => {
   /* Both send actions set 'sent' and not one quote of 57 has ever carried it:
      the team downloads the PDF and sends it by hand, so every real quotation
      sits in 'draft'. But the wizard writes the row at the start, so a booking
      somebody opened and walked away from looks the same to a query that only
      reads status — F2-64 was held by a quote abandoned on the Units step. */
   const f = heldByQuoteFilter(UNIT, AT);
   const [sentOrAccepted, issuedDraft] = f.$or;
   assert.deepEqual(sentOrAccepted.status, { $in: ['sent', 'accepted'] });
   assert.equal(issuedDraft.status, 'draft');
   assert.deepEqual(issuedDraft.flowStep, { $gte: QUOTE_ISSUED_STEP });
});

test('a quote that was turned down holds nothing', () => {
   const f = heldByQuoteFilter(UNIT, AT);
   const statuses = f.$or.flatMap((c) => c.status?.$in ?? [c.status]);
   assert.ok(!statuses.includes('rejected'));
   assert.ok(!statuses.includes('expired'));
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

test('a hold lasts two days and then lets go by itself', () => {
   /* The expiry date is no use for this: quotes carry a month, so a unit
      quoted to somebody who never replied would sit out of the inventory for
      four weeks. Two days covers a weekend and costs nothing after that. */
   assert.equal(QUOTE_HOLD_DAYS, 2);
   const f = heldByQuoteFilter(UNIT, AT);
   const since = f.updatedAt.$gte;
   assert.equal(Math.round((AT - since) / 864e5), 2);
});

test('the hold is read off the same field the card shows', () => {
   // The card says "quoted 4 days ago" from updatedAt. If the hold were
   // measured from anything else the label and the rule could disagree.
   const f = heldByQuoteFilter(UNIT, AT);
   assert.ok(f.updatedAt, 'the hold window is on updatedAt');
});

/* The hold rule was split so the recovery agents could ask "was this really
   issued?" without inheriting the two clauses that exist to let a unit go.
   Splitting it must not have changed what holds a unit — that would quietly
   put occupied units back on sale. */
test('pulling issuedQuoteFilter out left the hold rule identical', () => {
   const f = heldByQuoteFilter(UNIT, AT);
   assert.deepEqual(f.$or, [
      { status: { $in: ['sent', 'accepted'] } },
      { status: 'draft', flowStep: { $gte: QUOTE_ISSUED_STEP } },
   ]);
   assert.deepEqual(f.contract, { $in: [null, undefined] });
   assert.deepEqual(f.expiryDate, { $gte: AT });
   assert.equal(f['units.unit'], UNIT);
   assert.deepEqual(f.updatedAt, { $gte: new Date(AT.getTime() - QUOTE_HOLD_DAYS * 864e5) });
});

test('issued on its own carries no window, so an old quotation still counts', () => {
   const f = issuedQuoteFilter();
   // The whole point: a missed-lead sweep wants quotations from months ago.
   assert.deepEqual(Object.keys(f), ['$or']);
   assert.equal(f.expiryDate, undefined);
   assert.equal(f.updatedAt, undefined);
});
