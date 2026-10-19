import Stripe from 'stripe';

// Stripe Checkout integration for invoice payment links. Credentials live in
// .env (set via Settings → Payments, which writes them with updateEnvFile),
// same pattern as Gmail/Zoho — never stored in the database.

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripeWebhookConfigured() {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

/* The publishable key, needed by any page that renders Stripe's own card form
 * rather than redirecting to Stripe. Unlike the secret key this one is meant to
 * be public — it identifies the account and can do nothing on its own — so it
 * is the only Stripe credential this server will hand to a browser. */
export function stripePublishableKey() {
  return String(process.env.STRIPE_PUBLISHABLE_KEY || '');
}

export function stripeEmbeddedConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY);
}

let cachedClient = null;
let cachedKey = null;

function getClient() {
  if (!stripeConfigured()) throw new Error('Stripe is not connected — add a secret key in Settings → Payments');
  // Re-instantiate if the key was changed via Settings without a server restart
  if (!cachedClient || cachedKey !== process.env.STRIPE_SECRET_KEY) {
    cachedClient = new Stripe(process.env.STRIPE_SECRET_KEY);
    cachedKey = process.env.STRIPE_SECRET_KEY;
  }
  return cachedClient;
}

// A quick read-only call to confirm a secret key is valid before saving it.
export async function verifyStripeKey(secretKey) {
  const client = new Stripe(secretKey);
  await client.balance.retrieve();
}

/**
 * The card-processing fee in fils, for a charge of this size at this
 * percentage. Pure and rounded the way Stripe wants amounts — whole fils —
 * so the fee shown on screen before sending is exactly the fee the checkout
 * session will carry, never a rounding-drift apart.
 */
export function computeFeeFils(amountFils, feePct) {
  const pct = Number(feePct) || 0;
  if (!(amountFils > 0) || pct <= 0) return 0;
  return Math.round(amountFils * (pct / 100));
}

/**
 * Creates a hosted Stripe Checkout session for an arbitrary amount. Returns
 * { id, url, feeAmount }. The session itself is the "payment link" — no
 * separate public page of ours is needed, Stripe hosts the checkout UI.
 *
 * feePct (optional): when greater than zero, adds a separate "card
 * processing fee" line so the customer — not PurpleBox — covers Stripe's
 * cut. The thing actually owed is recorded in metadata.amountFils (fils, the
 * fee excluded) so a webhook can credit only that portion, never the fee on
 * top of it. `metadata` is merged in on top — callers add whichever id
 * (invoice, quote, storage or moving) the webhook needs to find the record.
 *
 * embedded (optional): renders Stripe's card form inside one of our own pages
 * instead of sending the payer to Stripe's. Used by the tenant renewal page,
 * where bouncing somebody out to a different domain mid-decision loses them.
 * Stripe rejects success_url/cancel_url in this mode and takes a single
 * return_url instead, so the two shapes cannot simply be merged — and the
 * caller gets back a clientSecret rather than a url, since there is nowhere to
 * send them. Without a returnUrl the form never redirects; the page hosting it
 * hears of completion from Stripe.js instead (the customer app does this).
 */
export async function createCheckoutSession({ amountAed, description, productName, metadata = {}, customerEmail, successUrl, cancelUrl, feePct = 0, embedded = false, returnUrl, expiresInMinutes, stripeCustomerId, saveCard = false }) {
  const client = getClient();
  const amountFils = Math.round(Number(amountAed) * 100);
  if (!Number.isFinite(amountFils) || amountFils <= 0) {
    throw new Error('Nothing outstanding to charge');
  }
  const pct = Number(feePct) || 0;
  const feeFils = computeFeeFils(amountFils, pct);

  const lineItems = [{
    price_data: {
      currency: 'aed',
      unit_amount: amountFils,
      product_data: {
        name: productName,
        description: description || undefined,
      },
    },
    quantity: 1,
  }];
  if (feeFils > 0) {
    lineItems.push({
      price_data: {
        currency: 'aed',
        unit_amount: feeFils,
        product_data: { name: `Card processing fee (${pct}%)` },
      },
      quantity: 1,
    });
  }

  const session = await client.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    // A saved-card payment is made as a Stripe customer, so the card can be used again later. Stripe shows the
    // customer its own wording that the card will be kept for future payments. (customer and customer_email are exclusive.)
    ...(stripeCustomerId ? { customer: stripeCustomerId } : { customer_email: customerEmail || undefined }),
    ...(stripeCustomerId && saveCard ? { payment_intent_data: { setup_future_usage: 'off_session' } } : {}),
    line_items: lineItems,
    metadata: {
      ...metadata,
      amountFils: String(amountFils),
      feeFils: String(feeFils),
      feePct: String(pct),
    },
    // Stripe's floor is 30 minutes; a booking hold must outlive the session.
    ...(expiresInMinutes ? { expires_at: Math.floor(Date.now() / 1000) + Math.max(30, expiresInMinutes) * 60 } : {}),
    ...(embedded
      ? { ui_mode: 'embedded', ...(returnUrl ? { return_url: returnUrl } : { redirect_on_completion: 'never' }) }
      : { success_url: successUrl, cancel_url: cancelUrl }),
  });
  return {
    id: session.id,
    url: session.url,
    clientSecret: session.client_secret || '',
    feeAmount: feeFils / 100,
  };
}

// Thin wrapper kept for the one existing caller (moving invoices) so its
// metadata key (movingInvoiceId) and copy stay exactly as they were.
export async function createInvoiceCheckoutSession({ invoice, customerEmail, successUrl, cancelUrl, feePct = 0 }) {
  const session = await createCheckoutSession({
    amountAed: invoice.balanceDue,
    productName: `Invoice ${invoice.invoiceNo}`,
    description: 'Moving invoice balance due — PurpleBox',
    metadata: { movingInvoiceId: String(invoice._id), invoiceNo: invoice.invoiceNo },
    customerEmail, successUrl, cancelUrl, feePct,
  });
  return session;
}

/**
 * Closes a session nobody should pay any more, so starting a new one can't
 * leave two payable at once. Returns the session's status afterwards
 * ('expired', or 'complete' if it was paid first); null if it can't be read.
 */
export async function expireCheckoutSession(id) {
  const client = getClient();
  try {
    const session = await client.checkout.sessions.retrieve(id);
    if (session.status !== 'open') return session.status;
    await client.checkout.sessions.expire(id);
    return 'expired';
  } catch (err) {
    console.error('[stripe] could not expire session', id, err.message);
    return null;
  }
}

/**
 * Closes a PaymentIntent nobody should pay any more — the payment-sheet twin of
 * expireCheckoutSession. Returns its status afterwards ('canceled', or
 * 'succeeded' / 'processing' if the money got there first); null if unreadable.
 */
export async function cancelPaymentIntent(id) {
  const client = getClient();
  try {
    const intent = await client.paymentIntents.retrieve(id);
    if (['succeeded', 'processing', 'canceled'].includes(intent.status)) return intent.status;
    await client.paymentIntents.cancel(id);
    return 'canceled';
  } catch (err) {
    console.error('[stripe] could not cancel payment intent', id, err.message);
    return null;
  }
}

/**
 * Gives back everything a payment took, card fee included. Takes the
 * PaymentIntent, or the Checkout Session it came through. Throws when Stripe
 * says no — the caller decides what that means for the thing being undone.
 */
export async function refundPayment({ paymentIntentId, checkoutSessionId } = {}) {
  const client = getClient();
  let intentId = paymentIntentId || null;
  if (!intentId && checkoutSessionId) {
    const session = await client.checkout.sessions.retrieve(checkoutSessionId);
    intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
  }
  if (!intentId) throw new Error('No card payment to refund');
  // Keyed on the payment, so a retried cancel can never refund twice.
  const refund = await client.refunds.create({ payment_intent: intentId }, { idempotencyKey: `refund-${intentId}` });
  return { id: refund.id, status: refund.status, amount: (refund.amount || 0) / 100 };
}

/** Read a Checkout Session back from Stripe — the authoritative answer to "was it paid?". */
export async function retrieveCheckoutSession(id) {
  return getClient().checkout.sessions.retrieve(id);
}

export function constructWebhookEvent(rawBody, signature) {
  const client = getClient();
  return client.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

// ── Saved cards and automatic payments ──────────────────────────────────────

/** The Stripe customer for one of ours, creating it the first time. `customer` is a Mongoose Customer document. */
export async function ensureStripeCustomer(customer) {
  if (customer.stripeCustomerId) return customer.stripeCustomerId;
  const created = await getClient().customers.create({
    name: customer.fullName || undefined,
    email: customer.email || undefined,
    phone: customer.phone || undefined,
    metadata: { purpleboxCustomerId: String(customer._id) },
  });
  customer.stripeCustomerId = created.id;
  await customer.save();
  return created.id;
}

/**
 * A Checkout Session that only saves a card (no charge). Same embedded/hosted choice as createCheckoutSession.
 * metadata.purpleboxCustomerId + metadata.saveCardFor tell the webhook what to do with the card it gets back.
 */
export async function createSetupCheckoutSession({ stripeCustomerId, metadata = {}, embedded = false, successUrl, cancelUrl, returnUrl }) {
  const session = await getClient().checkout.sessions.create({
    mode: 'setup',
    currency: 'aed',
    payment_method_types: ['card'],
    customer: stripeCustomerId,
    metadata,
    ...(embedded
      ? { ui_mode: 'embedded', ...(returnUrl ? { return_url: returnUrl } : { redirect_on_completion: 'never' }) }
      : { success_url: successUrl, cancel_url: cancelUrl }),
  });
  return { id: session.id, url: session.url, clientSecret: session.client_secret || '' };
}

/**
 * The native payment sheet (cards, Apple Pay, Google Pay) is opt-in: STRIPE_PAYMENT_SHEET=true. Until it is set, the app's
 * request for the sheet is answered "not available" and the app uses Stripe's embedded card form instead, which already works.
 * Apple Pay also needs an Apple merchant ID in the app build; Google Pay needs Stripe's Google Pay set up. See the docs.
 */
export function stripeSheetEnabled() {
  return stripeEmbeddedConfigured() && process.env.STRIPE_PAYMENT_SHEET === 'true';
}

/**
 * A PaymentIntent for the app's native payment sheet, plus a CustomerSession so the sheet can offer the customer's saved
 * cards (a CustomerSession needs no API-version matching with the phone, unlike the older ephemeral key).
 * Saving a card is decided by our own tick-box (`saveCard`), so the sheet's own "save" switch is left off.
 * Paying is confirmed by the payment_intent.succeeded webhook, never by the app saying so.
 */
export async function createSheetPayment({ amountAed, feePct = 0, stripeCustomerId, saveCard = false, description, metadata = {} }) {
  const client = getClient();
  const amountFils = Math.round(Number(amountAed) * 100);
  if (!Number.isFinite(amountFils) || amountFils <= 0) throw new Error('Nothing outstanding to charge');
  const feeFils = computeFeeFils(amountFils, feePct);
  const intent = await client.paymentIntents.create({
    amount: amountFils + feeFils,
    currency: 'aed',
    customer: stripeCustomerId,
    // Cards plus the wallets that ride on them (Apple Pay, Google Pay).
    automatic_payment_methods: { enabled: true },
    ...(saveCard ? { setup_future_usage: 'off_session' } : {}),
    description,
    metadata: { ...metadata, amountFils: String(amountFils), feeFils: String(feeFils), feePct: String(Number(feePct) || 0) },
  });
  const session = await client.customerSessions.create({
    customer: stripeCustomerId,
    components: { mobile_payment_element: { enabled: true, features: { payment_method_redisplay: 'enabled', payment_method_save: 'disabled' } } },
  });
  return { clientSecret: intent.client_secret, id: intent.id, customerSessionClientSecret: session.client_secret, feeAmount: feeFils / 100 };
}

/** Read a PaymentIntent back from Stripe, the authoritative answer to "was it paid?". */
export async function retrievePaymentIntent(id) {
  return getClient().paymentIntents.retrieve(id);
}

/** Charge a saved card without the customer present. Throws a Stripe error on decline or when authentication is needed. */
export async function chargeSavedCard({ stripeCustomerId, paymentMethodId, amountFils, description, metadata = {}, idempotencyKey }) {
  return getClient().paymentIntents.create({
    amount: amountFils,
    currency: 'aed',
    customer: stripeCustomerId,
    payment_method: paymentMethodId,
    off_session: true,
    confirm: true,
    description,
    metadata,
  }, idempotencyKey ? { idempotencyKey } : undefined);
}

/** Brand / last four / expiry of a payment method, for showing "Visa •• 4242". Never returns the number. */
export async function paymentMethodSummary(paymentMethodId) {
  const pm = await getClient().paymentMethods.retrieve(paymentMethodId);
  return { id: pm.id, brand: pm.card?.brand || '', last4: pm.card?.last4 || '', expMonth: pm.card?.exp_month ?? null, expYear: pm.card?.exp_year ?? null };
}

export async function detachPaymentMethod(paymentMethodId) {
  try { await getClient().paymentMethods.detach(paymentMethodId); } catch (e) { console.error('[stripe] could not detach', paymentMethodId, e.message); }
}

/** The payment method a completed Checkout Session or PaymentIntent used, or null. */
export async function paymentMethodOfSession(session) {
  const client = getClient();
  if (session.mode === 'setup' && session.setup_intent) {
    const si = typeof session.setup_intent === 'string' ? await client.setupIntents.retrieve(session.setup_intent) : session.setup_intent;
    return si.payment_method || null;
  }
  if (session.payment_intent) {
    const pi = typeof session.payment_intent === 'string' ? await client.paymentIntents.retrieve(session.payment_intent) : session.payment_intent;
    return pi.payment_method || null;
  }
  return null;
}
