import test from 'node:test';
import assert from 'node:assert/strict';
import { movingTotals, movingBalance, MOVING_VAT_RATE } from './movingTotals.js';

test('VAT is 5% and is on by default', () => {
   const t = movingTotals({ items: [{ amount: 1000 }] });
   assert.equal(MOVING_VAT_RATE, 5);
   assert.equal(t.vatRate, 5);
   assert.equal(t.vatAmount, 50);
   assert.equal(t.total, 1050);
});

test('a quote with no vatEnabled field still carries VAT', () => {
   // Every document stored before this shipped looks like this. Absent must
   // mean on, or reopening an old quote would quietly drop the tax.
   const t = movingTotals({ items: [{ amount: 500 }, { amount: 250 }], discount: 0 });
   assert.equal(t.vatAmount, 37.5);
   assert.equal(t.total, 787.5);
});

test('the discount comes off before VAT, not after', () => {
   const t = movingTotals({ items: [{ amount: 2000 }], discount: 10 });
   assert.equal(t.subTotal, 2000);
   assert.equal(t.discountAmount, 200);
   assert.equal(t.net, 1800);
   // 5% of 1800, not of 2000 — taxing the pre-discount figure would bill tax
   // on money the customer was never asked for.
   assert.equal(t.vatAmount, 90);
   assert.equal(t.total, 1890);
});

test('VAT can be turned off deliberately', () => {
   const t = movingTotals({ items: [{ amount: 1000 }], vatEnabled: false });
   assert.equal(t.vatRate, 0);
   assert.equal(t.vatAmount, 0);
   assert.equal(t.total, 1000);
});

test('everything is rounded to fils, so the printed sum adds up', () => {
   const t = movingTotals({ items: [{ amount: 333.33 }, { amount: 333.33 }, { amount: 333.34 }], discount: 7 });
   assert.equal(t.subTotal, 1000);
   assert.equal(t.discountAmount, 70);
   assert.equal(t.net, 930);
   assert.equal(t.vatAmount, 46.5);
   assert.equal(t.total, 976.5);
   assert.equal(Number((t.net + t.vatAmount).toFixed(2)), t.total);
});

test('a full discount leaves nothing to tax', () => {
   const t = movingTotals({ items: [{ amount: 800 }], discount: 100 });
   assert.equal(t.net, 0);
   assert.equal(t.vatAmount, 0);
   assert.equal(t.total, 0);
});

test('rubbish in the discount cannot produce a negative bill', () => {
   assert.equal(movingTotals({ items: [{ amount: 100 }], discount: -50 }).total, 105);
   assert.equal(movingTotals({ items: [{ amount: 100 }], discount: 999 }).total, 0);
   assert.equal(movingTotals({ items: [{ amount: 100 }], discount: 'abc' }).total, 105);
});

test('missing or malformed items are counted as nothing, not as NaN', () => {
   const t = movingTotals({ items: [{ amount: 100 }, {}, { amount: null }, { amount: 'x' }] });
   assert.equal(t.subTotal, 100);
   assert.equal(t.total, 105);
   assert.equal(movingTotals().total, 0);
});

test('the balance counts the deposit and every payment against the same total', () => {
   const { total } = movingTotals({ items: [{ amount: 1000 }] });   // 1050
   const b = movingBalance({ total, depositPaid: 200, paymentHistory: [{ amount: 300 }, { amount: 50.5 }] });
   assert.equal(b.paid, 550.5);
   assert.equal(b.balanceDue, 499.5);
});

test('overpaying leaves a balance of zero, never a negative', () => {
   const b = movingBalance({ total: 100, depositPaid: 150 });
   assert.equal(b.balanceDue, 0);
});

/* The browser keeps a copy of this rule so a page can show the sum before
 * anything is saved. Two copies of an arithmetic rule is exactly how a page
 * and a PDF come to disagree, so this fails the moment they diverge. */
test('the client mirror computes the same figures', async () => {
   const fs = await import('node:fs');
   const path = new URL('../../../client/src/lib/movingTotals.ts', import.meta.url);
   const ts = fs.readFileSync(path, 'utf8');

   // The lines that decide money, normalised for the type annotations only.
   const wanted = [
      'const pct = Math.min(100, Math.max(0, Number(discount) || 0))',
      'const discountAmount = round2((subTotal * pct) / 100)',
      'const net = round2(subTotal - discountAmount)',
      'const rate = vatEnabled === false ? 0 : Number(vatRate ?? MOVING_VAT_RATE) || 0',
      'const vatAmount = round2((Math.max(0, net) * rate) / 100)',
      'total: round2(net + vatAmount)',
   ];
   for (const line of wanted) {
      assert.ok(ts.includes(line), `client/src/lib/movingTotals.ts has drifted — missing: ${line}`);
   }
   assert.ok(ts.includes('export const MOVING_VAT_RATE = 5'), 'the client mirror disagrees about the rate');
});
