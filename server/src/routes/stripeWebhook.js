import { Router } from 'express';
import { MovingInvoice, Invoice, Quote, MovingQuote, Customer, ContractRenewal } from '../models/index.js';
import { applyRenewal } from '../services/renewalApply.js';
import { constructWebhookEvent, stripeWebhookConfigured } from '../services/stripe.js';
import { applyMovingInvoicePayment } from '../services/movingInvoicePayments.js';
import { applyInvoicePayment, syncLinkedPayment } from '../services/invoicePayments.js';
import { notifyPaymentReceived } from '../services/movingNotifications.js';
import { sendMail, mailConfigured } from '../services/mail.js';

const router = Router();

// Express 4 drops async route errors on the floor (the request hangs) — wrap.
// Stripe also retries on any non-2xx, so an uncaught error here matters more
// than most routes.
const aw = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error('[StripeWebhook]', e.message);
  if (!res.headersSent) res.status(500).json({ error: e.message });
});

/** The amount actually owed, in AED — the fee line (when present) was
 *  collected from the customer to cover Stripe's cut, not extra rent or
 *  storage, and must never count toward what a record was paid down by. */
function amountOwed(session) {
  const amountFils = Number(session.metadata?.amountFils);
  if (Number.isFinite(amountFils)) return amountFils / 100;
  // Older sessions (created before the metadata key was renamed) still carry
  // this — kept so an in-flight checkout at deploy time is not left stranded.
  const legacy = Number(session.metadata?.invoiceAmountFils);
  return Number.isFinite(legacy) ? legacy / 100 : (session.amount_total ?? 0) / 100;
}

function thankYouEmail({ to, name, docNo, amount, businessName = 'PurpleBox' }) {
  if (!to || !mailConfigured()) return;
  const html = [
    `<p>Hi ${name},</p>`,
    `<p>We've received your payment of <strong>AED ${amount.toLocaleString()}</strong> for <strong>${docNo}</strong>. ✅</p>`,
    `<p>Thank you for choosing ${businessName}!</p>`,
  ].join('\n');
  const text = `Hi ${name},\n\nWe've received your payment of AED ${amount.toLocaleString()} for ${docNo}. Thank you!\n\n— ${businessName}`;
  sendMail({ to, subject: `Payment received — ${docNo} — ${businessName}`, text, html })
    .catch((e) => console.error('[StripeWebhook] thank-you email failed:', e.message));
}

router.post('/', aw(async (req, res) => {
  if (!stripeWebhookConfigured()) {
    return res.status(400).json({ error: 'Stripe webhook secret not configured' });
  }
  const signature = req.headers['stripe-signature'];
  const rawBody = req.rawBody;
  if (!rawBody) return res.status(400).json({ error: 'Missing raw request body' });

  let event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (e) {
    console.error('[StripeWebhook] signature verification failed:', e.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    const meta = session.metadata || {};
    const feePct = Number(meta.feePct) || 0;
    const amount = amountOwed(session);
    const feeNote = feePct > 0 ? ` incl. ${feePct}% card fee paid separately` : '';

    // Moving invoice — unchanged behaviour, just reading the renamed field.
    if (meta.movingInvoiceId) {
      const invoice = await MovingInvoice.findById(meta.movingInvoiceId);
      const already = invoice?.paymentHistory?.some((p) => p.notes?.includes(session.id));
      if (invoice && invoice.balanceDue > 0 && !already) {
        applyMovingInvoicePayment(invoice, {
          amount, method: 'online', receivedBy: 'Stripe',
          notes: `Paid via Stripe Checkout (${session.id})${feeNote}`,
        });
        await invoice.save();
        const customer = await Customer.findById(invoice.customer).select('fullName phone email');
        if (customer) {
          notifyPaymentReceived(customer, invoice.invoiceNo, amount);
          thankYouEmail({ to: customer.email, name: customer.fullName, docNo: `Invoice ${invoice.invoiceNo}`, amount, businessName: 'PurpleBox Moving' });
        }
      }
    }

    // Storage invoice — the same "when is this paid" rule the manual Record
    // Payment button uses, via services/invoicePayments.js.
    if (meta.storageInvoiceId) {
      const invoice = await Invoice.findById(meta.storageInvoiceId).populate('customer', 'fullName email');
      const already = invoice?.paymentHistory?.some((p) => p.notes?.includes(session.id));
      const balanceDue = invoice ? Math.max(0, Number(invoice.total || 0) - Number(invoice.paymentMade || 0)) : 0;
      if (invoice && balanceDue > 0 && !already) {
        applyInvoicePayment(invoice, {
          amount, method: 'card',
          notes: `Paid via Stripe Checkout (${session.id})${feeNote}`,
        });
        await invoice.save();
        await syncLinkedPayment(invoice);
        thankYouEmail({ to: invoice.customer?.email, name: invoice.customer?.fullName || 'there', docNo: `Invoice ${invoice.invoiceNo}`, amount });
      }
    }

    // Storage quote — paying it is treated as acceptance, on the same
    // timeline every other "quote sent/accepted" event uses. It does not
    // convert to a contract by itself: that step asks for authorized persons
    // and a payment method a webhook has no way to supply.
    if (meta.storageQuoteId) {
      const quote = await Quote.findById(meta.storageQuoteId).populate('customer', 'fullName email');
      if (quote && !quote.stripePaidAt) {
        quote.stripePaidAt = new Date();
        if (['draft', 'sent'].includes(quote.status)) quote.status = 'accepted';
        quote.timeline.push({ type: 'accepted', text: `Paid online via Stripe Checkout (${session.id})${feeNote}` });
        await quote.save();
        thankYouEmail({ to: quote.customer?.email, name: quote.customer?.fullName || 'there', docNo: `Quotation ${quote.quoteNo}`, amount });
      }
    }

    /* A tenant renewing their own contract from the expiry message.
     *
     * This is the only branch here that changes a contract rather than just
     * recording a payment, so it is also the only one that must be exactly
     * once — applyRenewal owns that, and returns early on a repeat delivery
     * rather than extending twice. Everything it does (extend, invoice, email)
     * is deliberately behind that one call, because a bank transfer confirmed
     * by a colleague has to do the identical thing. */
    if (meta.contractRenewalId) {
      const renewal = await ContractRenewal.findById(meta.contractRenewalId);
      if (renewal && renewal.status !== 'applied') {
        renewal.status = 'paid';
        renewal.stripePaidAt = new Date();
        if (!renewal.stripeCheckoutSessionId) renewal.stripeCheckoutSessionId = session.id;
        await renewal.save();

        const out = await applyRenewal(renewal._id, { paid: true });
        if (!out.ok) {
          // The money is in; only the extension failed. Left as 'paid' with a
          // note so it shows up needing a person rather than looking finished.
          console.error('[StripeWebhook] renewal not applied:', out.error);
        }
      }
    }

    // Moving quote — same idea as the storage quote above.
    if (meta.movingQuoteId) {
      const quote = await MovingQuote.findById(meta.movingQuoteId).populate('customer', 'fullName email');
      if (quote && !quote.stripePaidAt) {
        quote.stripePaidAt = new Date();
        if (['draft', 'sent'].includes(quote.status)) quote.status = 'accepted';
        await quote.save();
        thankYouEmail({ to: quote.customer?.email, name: quote.customer?.fullName || 'there', docNo: `Quotation ${quote.quoteNo}`, amount, businessName: 'PurpleBox Moving' });
      }
    }
  }

  res.json({ received: true });
}));

export default router;
