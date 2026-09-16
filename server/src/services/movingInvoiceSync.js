import { MovingInvoice, MovingQuote } from '../models/index.js';
import { movingTotals, movingBalance } from './movingTotals.js';

/* Mirrors the line-item shape MovingJobDetail.tsx's createInvoiceMut already
 * builds when an invoice is first created from a job's agreed package — kept
 * here so a later price edit produces the identical shape, not a slightly
 * different one. */
export function packageLineItems(pkg) {
  if (!pkg || !(pkg.agreedPrice > 0)) return null;
  const items = [{
    description: `Moving Service${pkg.label ? ` — ${pkg.label}` : ''}`,
    qty: 1,
    rate: pkg.agreedPrice,
    amount: pkg.agreedPrice,
  }];
  for (const ac of pkg.additionalCharges ?? []) {
    if (ac.amount > 0) items.push({ description: ac.description, qty: 1, rate: ac.amount, amount: ac.amount });
  }
  return items;
}

/**
 * Pure: given a job, its quote (or null), and its linked invoice, decide what
 * the invoice's priced fields should become.
 *
 * The job's agreed package always wins when it's set; the quote is only a
 * fallback for a job that never got one. A cancelled invoice is treated as
 * voided and is never resurrected by a price change elsewhere. Returns null
 * when there is nothing to sync.
 */
export function computeSyncedInvoiceFields({ job, quote, invoice }) {
  if (invoice.status === 'cancelled') return null;

  const items = packageLineItems(job?.clientPackage) ?? (quote?.items?.length ? quote.items : null);
  if (!items) return null;

  const totals = movingTotals({ ...invoice, items });
  const { paid, balanceDue } = movingBalance({
    total: totals.total,
    depositPaid: invoice.depositPaid,
    paymentHistory: invoice.paymentHistory,
  });
  // A draft has not gone to anybody yet, so its status is untouched — same
  // idea as chargesVat's own "a draft is priced at today's rules" note.
  const status = invoice.status === 'draft'
    ? 'draft'
    : balanceDue <= 0 ? 'paid' : paid > 0 ? 'partial' : 'sent';

  return { items, ...totals, balanceDue, status };
}

/** I/O: loads what's needed, applies the computed fields, saves. No-op if the
 * job has no linked invoice, or there's nothing to sync. */
export async function syncInvoiceFromJob(job) {
  if (!job.invoice) return null;
  const invoice = await MovingInvoice.findById(job.invoice);
  if (!invoice) return null;
  const quote = job.quote ? await MovingQuote.findById(job.quote).select('items').lean() : null;
  const fields = computeSyncedInvoiceFields({ job, quote, invoice });
  if (!fields) return null;
  Object.assign(invoice, fields);
  await invoice.save();
  return invoice;
}
