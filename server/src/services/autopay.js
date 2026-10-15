import { Customer, Invoice } from '../models/index.js';
import { chargeSavedCard, stripeConfigured } from './stripe.js';
import { patchNested, settleInvoiceFromIntent } from './cardPayments.js';
import { afterFailure, autopayAmounts, autopayIdempotencyKey, autopayReady, invoiceDueForAutopay, MAX_FAILURES } from './autopayRules.js';
import { mailConfigured, sendMail } from './mail.js';

/**
 * Charges saved cards for invoices that have fallen due. See autopayRules.js for who and when.
 *
 * Switched on deliberately: index.js only schedules this when AUTOPAY_ENABLED=true. With AUTOPAY_DRY_RUN=true it only
 * reports what it would charge. Each invoice is claimed before Stripe is called, and the Stripe call carries an
 * idempotency key, so two overlapping runs (or a restart mid-run) cannot charge anybody twice.
 */

const startOfDayUtc = (now) => new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);

function failureEmail(customer, invoice, reason, disabled) {
  if (!customer.email || !mailConfigured()) return;
  const card = customer.autopay?.last4 ? `your card ending ${customer.autopay.last4}` : 'your saved card';
  const text = [
    `Hi ${customer.fullName || 'there'},`,
    '',
    `We could not take payment for invoice ${invoice.invoiceNo} from ${card}. (${reason})`,
    disabled ? 'Auto-pay has been switched off after repeated failures.' : 'We will try again tomorrow.',
    'You can pay or update your card any time in the PurpleBox app.',
    '',
    '— PurpleBox',
  ].join('\n');
  sendMail({ to: customer.email, subject: `Payment failed — ${invoice.invoiceNo} — PurpleBox`, text, html: text.replace(/\n/g, '<br>'), context: { kind: 'payment', label: 'Auto-pay failed' } })
    .catch((e) => console.error('[autopay] failure email failed:', e.message));
}

async function recordFailure(customer, invoice, reason, now) {
  patchNested(invoice, 'autopay', { lastAttemptAt: now, lastStatus: 'failed', lastError: String(reason).slice(0, 200) });
  await invoice.save();
  const change = afterFailure({ enabled: customer.autopay?.enabled, failureCount: customer.autopay?.failureCount }, reason, now);
  patchNested(customer, 'autopay', change);
  await customer.save();
  failureEmail(customer, invoice, reason, change.enabled === false);
}

export async function runAutopay({ now = new Date(), dryRun = false } = {}) {
  const out = { customers: 0, attempted: 0, succeeded: 0, failed: 0, skipped: 0, dryRun };
  if (!stripeConfigured()) return { ...out, note: 'Stripe is not configured' };

  const customers = await Customer.find({ 'autopay.enabled': true, 'autopay.paymentMethodId': { $ne: '' }, stripeCustomerId: { $ne: '' } });
  for (const customer of customers) {
    if (!autopayReady(customer)) { out.skipped += 1; continue; }
    out.customers += 1;
    const invoices = await Invoice.find({ customer: customer._id, status: { $in: ['sent', 'partial', 'overdue'] } });
    for (const invoice of invoices) {
      if (!invoiceDueForAutopay(invoice, now)) continue;
      const amounts = autopayAmounts(invoice);
      if (amounts.totalFils <= 0) continue;
      out.attempted += 1;
      if (dryRun) {
        console.log(`[Autopay] (dry run) would charge AED ${amounts.totalFils / 100} for ${invoice.invoiceNo} to ${customer.fullName}`);
        continue;
      }

      // Claim the invoice for today before touching Stripe.
      const claimed = await Invoice.findOneAndUpdate(
        { _id: invoice._id, $or: [{ 'autopay.lastAttemptAt': null }, { 'autopay.lastAttemptAt': { $lt: startOfDayUtc(now) } }] },
        { $set: { 'autopay.lastAttemptAt': now, 'autopay.lastStatus': 'processing' } },
        { new: true },
      );
      if (!claimed) { out.attempted -= 1; continue; }

      try {
        const intent = await chargeSavedCard({
          stripeCustomerId: customer.stripeCustomerId,
          paymentMethodId: customer.autopay.paymentMethodId,
          amountFils: amounts.totalFils,
          description: `Invoice ${invoice.invoiceNo} — automatic payment`,
          idempotencyKey: autopayIdempotencyKey(invoice._id, now),
          metadata: {
            storageInvoiceId: String(invoice._id), invoiceNo: invoice.invoiceNo, purpleboxCustomerId: String(customer._id), autopay: '1',
            amountFils: String(amounts.owedFils), feeFils: String(amounts.feeFils), feePct: String(amounts.feePct),
          },
        });
        if (intent.status === 'succeeded') {
          await settleInvoiceFromIntent(intent);
          out.succeeded += 1;
        } else {
          await recordFailure(customer, claimed, `The bank asked for extra confirmation (${intent.status})`, now);
          out.failed += 1;
        }
      } catch (err) {
        // Stripe throws on a decline; the message is safe to show ("Your card was declined.").
        await recordFailure(customer, claimed, err.message || 'Card declined', now);
        out.failed += 1;
      }
    }
  }
  return out;
}

export { MAX_FAILURES };
