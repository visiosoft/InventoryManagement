import { Router } from 'express';
import { MovingInvoice, Customer } from '../models/index.js';
import { constructWebhookEvent, stripeWebhookConfigured } from '../services/stripe.js';
import { applyMovingInvoicePayment } from '../services/movingInvoicePayments.js';
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
    const invoiceId = session.metadata?.movingInvoiceId;
    if (invoiceId) {
      const invoice = await MovingInvoice.findById(invoiceId);
      // Idempotent: Stripe may deliver the same event more than once
      const already = invoice?.paymentHistory?.some((p) => p.notes?.includes(session.id));
      if (invoice && invoice.balanceDue > 0 && !already) {
        // Credit only the invoice-owed portion — a card-fee line item (when
        // present) was collected from the customer to cover Stripe's cut,
        // not extra rent, and must not count toward the balance.
        const invoiceAmountFils = Number(session.metadata?.invoiceAmountFils);
        const amount = Number.isFinite(invoiceAmountFils) ? invoiceAmountFils / 100 : (session.amount_total ?? 0) / 100;
        const feePct = Number(session.metadata?.feePct) || 0;
        applyMovingInvoicePayment(invoice, {
          amount,
          method: 'online',
          notes: `Paid via Stripe Checkout (${session.id})${feePct > 0 ? ` incl. ${feePct}% card fee paid separately` : ''}`,
          receivedBy: 'Stripe',
        });
        await invoice.save();
        const customer = await Customer.findById(invoice.customer).select('fullName phone email');
        if (customer) {
          notifyPaymentReceived(customer, invoice.invoiceNo, amount);
          if (customer.email && mailConfigured()) {
            const html = [
              `<p>Hi ${customer.fullName},</p>`,
              `<p>We've received your payment of <strong>AED ${amount.toLocaleString()}</strong> for invoice <strong>${invoice.invoiceNo}</strong>. ✅</p>`,
              `<p>Thank you for choosing PurpleBox Moving!</p>`,
            ].join('\n');
            const text = `Hi ${customer.fullName},\n\nWe've received your payment of AED ${amount.toLocaleString()} for invoice ${invoice.invoiceNo}. Thank you!\n\n— PurpleBox Moving`;
            try {
              await sendMail({ to: customer.email, subject: `Payment received — Invoice ${invoice.invoiceNo} — PurpleBox Moving`, text, html });
            } catch (e) { console.error('[StripeWebhook] thank-you email failed:', e.message); }
          }
        }
      }
    }
  }

  res.json({ received: true });
}));

export default router;
