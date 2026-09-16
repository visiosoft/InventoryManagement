import test from 'node:test';
import assert from 'node:assert/strict';
import { packageLineItems, computeSyncedInvoiceFields } from './movingInvoiceSync.js';

test('packageLineItems is null with no agreed price', () => {
   assert.equal(packageLineItems(null), null);
   assert.equal(packageLineItems({ agreedPrice: 0 }), null);
});

test('packageLineItems builds the same shape createInvoiceMut does', () => {
   const items = packageLineItems({
      agreedPrice: 670,
      label: 'Studio',
      additionalCharges: [{ description: 'Packing', amount: 50 }, { description: 'Zero charge', amount: 0 }],
   });
   assert.deepEqual(items, [
      { description: 'Moving Service — Studio', qty: 1, rate: 670, amount: 670 },
      { description: 'Packing', qty: 1, rate: 50, amount: 50 },
   ]);
});

test('packageLineItems drops the label dash when there is no label', () => {
   const items = packageLineItems({ agreedPrice: 670 });
   assert.equal(items[0].description, 'Moving Service');
});

test('a job price change recomputes total/balance and flips a paid invoice to partial', () => {
   const job = { clientPackage: { agreedPrice: 800, label: 'Studio' } };
   const invoice = { status: 'paid', vatEnabled: true, vatRate: 5, discount: 0, depositPaid: 0, paymentHistory: [{ amount: 703.5 }] };
   const fields = computeSyncedInvoiceFields({ job, quote: null, invoice });
   assert.equal(fields.total, 840);
   assert.equal(fields.balanceDue, 136.5);
   assert.equal(fields.status, 'partial');
   assert.equal(fields.items[0].description, 'Moving Service — Studio');
});

test('falls back to the quote when the job has no agreed price', () => {
   const job = {};
   const quote = { items: [{ amount: 500 }] };
   const invoice = { status: 'sent', vatEnabled: true, vatRate: 5, discount: 0, depositPaid: 0, paymentHistory: [] };
   const fields = computeSyncedInvoiceFields({ job, quote, invoice });
   assert.equal(fields.total, 525);
   assert.equal(fields.balanceDue, 525);
   assert.equal(fields.status, 'sent');
});

test('the job\'s agreed price wins over the quote when both are set', () => {
   const job = { clientPackage: { agreedPrice: 670 } };
   const quote = { items: [{ amount: 9999 }] };
   const invoice = { status: 'draft', vatEnabled: true, vatRate: 5, discount: 0, depositPaid: 0, paymentHistory: [] };
   const fields = computeSyncedInvoiceFields({ job, quote, invoice });
   assert.equal(fields.items.length, 1);
   assert.equal(fields.items[0].amount, 670);
});

test('a cancelled invoice is never resurrected by a price change', () => {
   const job = { clientPackage: { agreedPrice: 800 } };
   const invoice = { status: 'cancelled', vatEnabled: true, paymentHistory: [] };
   assert.equal(computeSyncedInvoiceFields({ job, quote: null, invoice }), null);
});

test('nothing to sync (no package, no quote) leaves the invoice untouched', () => {
   const job = {};
   const invoice = { status: 'sent', paymentHistory: [] };
   assert.equal(computeSyncedInvoiceFields({ job, quote: null, invoice }), null);
});

test('a draft invoice\'s status never changes even when the new balance is owed', () => {
   const job = { clientPackage: { agreedPrice: 670 } };
   const invoice = { status: 'draft', vatEnabled: undefined, depositPaid: 0, paymentHistory: [] };
   const fields = computeSyncedInvoiceFields({ job, quote: null, invoice });
   assert.equal(fields.status, 'draft');
   assert.ok(fields.balanceDue > 0);
});
