import { Router } from 'express';
import { Customer } from '../models/index.js';
import { requireCustomer } from './customerAuth.js';
import {
  createSetupCheckoutSession, detachPaymentMethod, ensureStripeCustomer, stripeConfigured, stripeEmbeddedConfigured, stripePublishableKey,
} from '../services/stripe.js';
import { AUTOPAY_CONSENT_TEXT, AUTOPAY_CONSENT_VERSION, MAX_FAILURES } from '../services/autopayRules.js';
import { patchNested } from '../services/cardPayments.js';

/**
 * The customer's saved card and whether it is charged automatically for invoices as they fall due.
 *
 * A card is only ever saved through Stripe's own form; this server never sees a card number. Auto-pay is a separate,
 * explicit switch that records the customer's consent (when, which wording). See services/autopay.js for the charging.
 */
const router = Router();
router.use(requireCustomer);

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
};
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

async function me(req) {
  const customer = await Customer.findById(req.customer.customerId);
  if (!customer) throw bad('Customer not found', 404);
  return customer;
}

function stateOf(customer) {
  const a = customer.autopay || {};
  return {
    available: stripeConfigured(),
    card: a.paymentMethodId ? { brand: a.brand, last4: a.last4, expMonth: a.expMonth, expYear: a.expYear } : null,
    enabled: !!a.enabled && !!a.paymentMethodId,
    consentText: AUTOPAY_CONSENT_TEXT,
    consentAt: a.consentAt || null,
    failureCount: a.failureCount || 0,
    stopped: !a.enabled && (a.failureCount || 0) >= MAX_FAILURES,
    lastFailureReason: a.lastFailureReason || '',
  };
}

router.get('/', wrap(async (req, res) => { res.json(stateOf(await me(req))); }));

// Start saving a card. `enable: true` also turns auto-pay on once the card is saved (the customer ticked the consent box).
router.post('/setup', wrap(async (req, res) => {
  if (!stripeConfigured()) throw bad('Saving a card is not available right now', 503);
  const customer = await me(req);
  const stripeCustomerId = await ensureStripeCustomer(customer);
  const embedded = req.body?.embedded === true && stripeEmbeddedConfigured();
  const clientOrigin = process.env.CLIENT_ORIGIN || 'https://office.purplebox.ae';
  const session = await createSetupCheckoutSession({
    stripeCustomerId, embedded,
    metadata: { purpleboxCustomerId: String(customer._id), autopayConsent: req.body?.enable === true ? '1' : '0' },
    successUrl: `${clientOrigin}/pay/success?card=saved`, cancelUrl: `${clientOrigin}/pay/success?card=cancelled`,
  });
  res.json(embedded ? { clientSecret: session.clientSecret, publishableKey: stripePublishableKey() } : { url: session.url });
}));

// Turn auto-pay on or off. On needs a saved card, and records the consent.
router.patch('/', wrap(async (req, res) => {
  const customer = await me(req);
  const enable = req.body?.enabled === true;
  if (enable) {
    if (!customer.autopay?.paymentMethodId) throw bad('Save a card first');
    if (req.body?.consent !== true) throw bad('Please confirm you agree to automatic payments');
    patchNested(customer, 'autopay', { enabled: true, consentAt: new Date(), consentVersion: AUTOPAY_CONSENT_VERSION, consentSource: 'app', failureCount: 0, lastFailureReason: '' });
  } else {
    patchNested(customer, 'autopay', { enabled: false });
  }
  await customer.save();
  res.json(stateOf(customer));
}));

// Remove the saved card (this also switches auto-pay off).
router.delete('/card', wrap(async (req, res) => {
  const customer = await me(req);
  const pm = customer.autopay?.paymentMethodId;
  patchNested(customer, 'autopay', { enabled: false, paymentMethodId: '', brand: '', last4: '', expMonth: null, expYear: null });
  await customer.save();
  if (pm) await detachPaymentMethod(pm);
  res.json(stateOf(customer));
}));

export default router;
