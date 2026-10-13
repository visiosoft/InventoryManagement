import { Customer, Invoice } from '../models/index.js';
import { applyInvoicePayment, syncLinkedPayment } from './invoicePayments.js';
import { paymentMethodOfSession, paymentMethodSummary, detachPaymentMethod } from './stripe.js';
import { AUTOPAY_CONSENT_VERSION, afterSuccess } from './autopayRules.js';
import { mailConfigured, sendMail } from './mail.js';
import { recordZohoPayment, zohoBooksConfigured } from './zohoBooks.js';

/**
 * What to do with money and cards once Stripe has told us about them. Used by the webhook and by the auto-pay job, so a
 * payment is credited by one rule whichever way it arrived, and a repeat delivery changes nothing.
 */

/**
 * Put an online payment into Zoho Books too, so the customer's app (which reads Zoho) shows the invoice as paid.
 * Off unless ZOHO_RECORD_ONLINE_PAYMENTS=true, because staff may already record these by hand and Zoho would then
 * hold the payment twice. Never throws: the payment is already credited here and a Zoho hiccup must not undo that.
 */
export async function recordOnlinePaymentInZoho(invoice, amount) {
  if (process.env.ZOHO_RECORD_ONLINE_PAYMENTS !== 'true' || !zohoBooksConfigured() || !invoice.zohoBooksSyncId) return false;
  try {
    await recordZohoPayment(invoice.zohoBooksSyncId, amount, new Date(), 'creditcard');
    return true;
  } catch (e) {
    console.error(`[cardPayments] could not record ${invoice.invoiceNo} payment in Zoho Books:`, e.message);
    return false;
  }
}

/** Set several fields under a nested path (e.g. 'autopay') without replacing the rest of that object. */
export function patchNested(doc, prefix, patch) {
  for (const [k, v] of Object.entries(patch)) doc.set(`${prefix}.${k}`, v);
}

function thankYou({ to, name, invoiceNo, amount, autopay }) {
  if (!to || !mailConfigured()) return;
  const how = autopay ? 'charged automatically to your saved card' : 'received';
  const text = `Hi ${name},\n\nYour payment of AED ${amount.toLocaleString()} for invoice ${invoiceNo} was ${how}. Thank you!\n\n— PurpleBox`;
  sendMail({ to, subject: `Payment received — ${invoiceNo} — PurpleBox`, text, html: text.replace(/\n/g, '<br>'), context: { kind: 'payment', label: 'Payment received' } })
    .catch((e) => console.error('[cardPayments] thank-you email failed:', e.message));
}

/**
 * Credit a succeeded PaymentIntent to the storage invoice named in its metadata. Idempotent: a second call for the same
 * PaymentIntent is a no-op. Only what was owed is credited; the card fee paid on top is not rent.
 */
export async function settleInvoiceFromIntent(intent) {
  const meta = intent.metadata || {};
  if (!meta.storageInvoiceId) return { settled: false, reason: 'no invoice' };
  const invoice = await Invoice.findById(meta.storageInvoiceId).populate('customer', 'fullName email');
  if (!invoice) return { settled: false, reason: 'invoice not found' };

  const already = invoice.paymentHistory?.some((p) => p.notes?.includes(intent.id));
  const balance = Math.max(0, Number(invoice.total || 0) - Number(invoice.paymentMade || 0));
  const owed = Number.isFinite(Number(meta.amountFils)) ? Number(meta.amountFils) / 100 : (intent.amount_received ?? intent.amount ?? 0) / 100;
  const auto = meta.autopay === '1';

  if (!already && balance > 0) {
    const feePct = Number(meta.feePct) || 0;
    applyInvoicePayment(invoice, {
      amount: Math.min(owed, balance), method: 'card',
      notes: `Paid ${auto ? 'automatically by saved card' : 'in the app'} via Stripe (${intent.id})${feePct > 0 ? ` incl. ${feePct}% card fee paid separately` : ''}`,
    });
    if (auto) patchNested(invoice, 'autopay', { lastStatus: 'succeeded', paymentIntentId: intent.id, lastError: '' });
    await invoice.save();
    await syncLinkedPayment(invoice);
    await recordOnlinePaymentInZoho(invoice, Math.min(owed, balance));
    thankYou({ to: invoice.customer?.email, name: invoice.customer?.fullName || 'there', invoiceNo: invoice.invoiceNo, amount: Math.min(owed, balance), autopay: auto });
  }
  if (auto && meta.purpleboxCustomerId) {
    await Customer.updateOne({ _id: meta.purpleboxCustomerId }, { $set: Object.fromEntries(Object.entries(afterSuccess()).map(([k, v]) => [`autopay.${k}`, v])) });
  }
  return { settled: !already, invoiceNo: invoice.invoiceNo };
}

/**
 * Remember the card from a completed Checkout Session (a card-only "setup" session, or a payment made with "save my
 * card"). Turning auto-pay ON needs the customer's explicit say-so, carried in metadata.autopayConsent, and is recorded
 * with the wording version. Saving a card on its own never starts charging.
 */
export async function saveCardFromSession(session) {
  const meta = session.metadata || {};
  if (!meta.purpleboxCustomerId) return { saved: false };
  const customer = await Customer.findById(meta.purpleboxCustomerId);
  if (!customer || !customer.stripeCustomerId || (session.customer && session.customer !== customer.stripeCustomerId)) return { saved: false };

  const pmId = await paymentMethodOfSession(session);
  if (!pmId) return { saved: false };
  const card = await paymentMethodSummary(pmId);

  const previous = customer.autopay?.paymentMethodId;
  patchNested(customer, 'autopay', {
    paymentMethodId: card.id, brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear, savedAt: new Date(),
    failureCount: 0, lastFailureReason: '',
  });
  if (meta.autopayConsent === '1') {
    patchNested(customer, 'autopay', { enabled: true, consentAt: new Date(), consentVersion: AUTOPAY_CONSENT_VERSION, consentSource: 'app' });
  }
  await customer.save();
  if (previous && previous !== card.id) await detachPaymentMethod(previous);
  return { saved: true, last4: card.last4, enabled: !!customer.autopay.enabled };
}
