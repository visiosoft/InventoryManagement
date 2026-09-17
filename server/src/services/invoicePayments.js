import { Payment } from '../models/index.js';

/**
 * Record a payment against a storage invoice, and settle its status.
 *
 * The same three lines that `/invoices/:id/record-payment` has always done
 * by hand — pulled out here so the Stripe webhook can credit an online
 * payment through the identical rule, rather than a second copy of "when is
 * an invoice paid" quietly drifting from the first.
 */
export function applyInvoicePayment(invoice, { amount, method, date, notes }) {
  invoice.paymentHistory.push({
    date: date ? new Date(date) : new Date(),
    amount: Number(amount),
    method: method || 'cash',
    notes: notes || '',
  });
  invoice.paymentMade = Number(invoice.paymentHistory.reduce((s, p) => s + p.amount, 0).toFixed(2));
  if (invoice.paymentMade >= invoice.total && invoice.status !== 'paid') {
    invoice.status = 'paid';
  }
  return invoice;
}

/**
 * An invoice may have one or more linked entries on the older, separate
 * `Payment` schedule (e.g. rent + deposit against the same invoice). Bring
 * every one of them into line with what the invoice itself now says, so the
 * schedule and the invoice never disagree about whether something was paid.
 */
export async function syncLinkedPayment(invoice) {
  const payments = await Payment.find({ invoice: invoice._id });
  if (!payments.length) return;

  const fullyPaid = Number(invoice.paymentMade || 0) >= Number(invoice.total || 0);
  const latest = (invoice.paymentHistory || []).at(-1);

  if (invoice.status === 'paid' || fullyPaid) {
    await Payment.updateMany(
      { invoice: invoice._id },
      {
        $set: {
          status: 'paid',
          paidDate: latest?.date ? new Date(latest.date) : new Date(),
          method: latest?.method || 'other',
        },
      }
    );
    return;
  }

  // Unpaid — reset all linked records to pending/overdue based on due date.
  const now = new Date();
  for (const p of payments) {
    p.status = new Date(p.dueDate) < now ? 'overdue' : 'pending';
    p.paidDate = undefined;
    p.method = '';
    await p.save();
  }
}
