import test from 'node:test';
import assert from 'node:assert/strict';
import { applyInvoicePayment } from './invoicePayments.js';

/**
 * The rule the Record Payment button and the Stripe webhook now share: how a
 * payment moves an invoice from owed to paid. Pulled out of the route so
 * there is exactly one place this can be wrong, not two quietly drifting
 * apart.
 */

function invoice(over = {}) {
    return { total: 1000, paymentMade: 0, paymentHistory: [], status: 'sent', ...over };
}

test('a payment is added to history and paymentMade is the running total', () => {
    const inv = invoice();
    applyInvoicePayment(inv, { amount: 400, method: 'card', notes: 'first' });
    assert.equal(inv.paymentHistory.length, 1);
    assert.equal(inv.paymentMade, 400);
    assert.equal(inv.status, 'sent');
});

test('reaching the total marks the invoice paid', () => {
    const inv = invoice({ paymentMade: 700, paymentHistory: [{ amount: 700 }] });
    applyInvoicePayment(inv, { amount: 300, method: 'card' });
    assert.equal(inv.paymentMade, 1000);
    assert.equal(inv.status, 'paid');
});

test('overpaying still marks it paid, not something stranger', () => {
    const inv = invoice();
    applyInvoicePayment(inv, { amount: 1200, method: 'card' });
    assert.equal(inv.status, 'paid');
});

test('this helper does the arithmetic only — refusing a cancelled invoice is the route\'s job, not this function\'s', () => {
    // Both call sites (the Record Payment route and the webhook) already
    // refuse a cancelled invoice before ever reaching here, so the helper
    // itself carries no such guard — same as it never did before this was
    // pulled out of the route.
    const inv = invoice({ status: 'cancelled', paymentMade: 900, paymentHistory: [{ amount: 900 }] });
    applyInvoicePayment(inv, { amount: 100, method: 'card' });
    assert.equal(inv.status, 'paid');
});

test('an already-paid invoice is not re-flipped by a fresh call, and stays paid', () => {
    const inv = invoice({ paymentMade: 1000, status: 'paid', paymentHistory: [{ amount: 1000 }] });
    applyInvoicePayment(inv, { amount: 0.01, method: 'card' });
    assert.equal(inv.status, 'paid');
});

test('paymentMade is always recomputed from history, never trusted as it stood — a stale or wrong stored figure self-heals on the next payment', () => {
    // deliberately inconsistent: paymentMade claims 900 but history says 500
    const inv = invoice({ paymentMade: 900, paymentHistory: [{ amount: 500 }] });
    applyInvoicePayment(inv, { amount: 100, method: 'card' });
    assert.equal(inv.paymentMade, 600); // 500 + 100, the stale 900 is discarded
});

test('the paymentMade figure comes from summing history, not from addition alone — no drift from a rounding edge', () => {
    const inv = invoice();
    applyInvoicePayment(inv, { amount: 333.33, method: 'card' });
    applyInvoicePayment(inv, { amount: 333.33, method: 'card' });
    applyInvoicePayment(inv, { amount: 333.34, method: 'card' });
    assert.equal(inv.paymentMade, 1000);
    assert.equal(inv.status, 'paid');
});
