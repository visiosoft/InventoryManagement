import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSync, methodFromZoho } from './zohoPaymentSync.js';

const zohoInvoices = [{ invoice_id: 'Z1', invoice_number: 'INV-001121', reference_number: 'PB-INV-77' }];
const crmInvoices = [{ _id: 'I77', invoiceNo: 'PB-INV-77', zohoBooksSyncId: 'Z1', contract: 'C1' }, { _id: 'I88', invoiceNo: 'INV-000500', contract: 'C2' }];
const unpaidRows = [
   { _id: 'r2', invoice: 'I77', contract: 'C1', amount: 500, dueDate: '2026-09-29' },
   { _id: 'r1', invoice: 'I77', contract: 'C1', amount: 500, dueDate: '2026-09-01' },
   { _id: 'r3', invoice: 'I88', contract: 'C2', amount: 300, dueDate: '2026-09-10' },
];

test('a Zoho payment settles whole unpaid rows of its invoice, oldest first', () => {
   const p = planSync({ zohoPayments: [{ id: 'P1', date: '2026-09-05', amount: 750, mode: 'Bank Transfer', invoiceNumbers: 'INV-001121' }], zohoInvoices, crmInvoices, unpaidRows });
   assert.equal(p.apply.length, 1);
   assert.deepEqual(p.apply[0].rowIds, ['r1']);
   assert.equal(p.apply[0].settles, 500);
   assert.equal(p.apply[0].unallocated, 250);
   assert.equal(p.apply[0].method, 'bank_transfer');
});

test('matches by invoice number when the CRM made the invoice in Zoho under its own number', () => {
   const p = planSync({ zohoPayments: [{ id: 'P2', date: '2026-09-11', amount: 300, mode: 'cash', invoiceNumbers: 'INV-000500' }], zohoInvoices: [], crmInvoices, unpaidRows });
   assert.deepEqual(p.apply[0].rowIds, ['r3']);
});

test('unmatched, too small, and already-applied payments are never guessed', () => {
   const p = planSync({
      zohoPayments: [
         { id: 'P3', date: '2026-09-12', amount: 100, invoiceNumbers: 'INV-999' },
         { id: 'P4', date: '2026-09-12', amount: 100, invoiceNumbers: 'INV-001121' },
         { id: 'P5', date: '2026-09-12', amount: 500, invoiceNumbers: 'INV-001121' },
      ],
      zohoInvoices, crmInvoices, unpaidRows, appliedIds: new Set(['P5']),
   });
   assert.equal(p.apply.length, 0);
   assert.equal(p.skipped, 1);
   assert.deepEqual(p.exceptions.map((e) => e.zohoPaymentId), ['P3', 'P4']);
});

test('two payments never settle the same row', () => {
   const p = planSync({ zohoPayments: [{ id: 'A', date: '2026-09-01', amount: 500, invoiceNumbers: 'INV-001121' }, { id: 'B', date: '2026-09-02', amount: 500, invoiceNumbers: 'INV-001121' }], zohoInvoices, crmInvoices, unpaidRows });
   assert.deepEqual(p.apply.map((a) => a.rowIds[0]), ['r1', 'r2']);
});

test('payment modes', () => {
   assert.equal(methodFromZoho('Check'), 'cheque');
   assert.equal(methodFromZoho('Credit Card'), 'card');
   assert.equal(methodFromZoho('Bank Remittance'), 'bank_transfer');
   assert.equal(methodFromZoho('Paypal'), 'other');
});

test('an invoice made by hand in Zoho is suggested from customer, amount and date — not applied', () => {
   const p = planSync({
      zohoPayments: [{ id: 'P9', date: '2026-10-28', amount: 588, mode: 'card', invoiceNumbers: 'INV-000925' }],
      zohoInvoices: [{ invoice_id: 'Z9', invoice_number: 'INV-000925', total: 588, date: '2026-10-28', customer_name: 'Mohamed Tarek Hassanien Mohamed Abdalla', email: 'mt@example.com' }],
      crmInvoices: [
         { _id: 'I9', invoiceNo: 'PB-2026-F3-94-01', total: 588, invoiceDate: '2026-10-28', customerName: 'Mohamed Tarek', customerEmail: '' },
         { _id: 'I10', invoiceNo: 'PB-2026-F1-1-01', total: 588, invoiceDate: '2026-10-27', customerName: 'Someone Else', customerEmail: '' },
      ],
      unpaidRows: [{ _id: 'r9', invoice: 'I9', amount: 588, dueDate: '2026-10-28' }],
   });
   assert.equal(p.apply.length, 0);
   assert.equal(p.suggestions.length, 1);
   assert.equal(p.suggestions[0].invoice, 'PB-2026-F3-94-01');
   assert.deepEqual(p.suggestions[0].rowIds, ['r9']);
});
