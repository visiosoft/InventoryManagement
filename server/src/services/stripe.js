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
 */
export async function createCheckoutSession({ amountAed, description, productName, metadata = {}, customerEmail, successUrl, cancelUrl, feePct = 0 }) {
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
    customer_email: customerEmail || undefined,
    line_items: lineItems,
    metadata: {
      ...metadata,
      amountFils: String(amountFils),
      feeFils: String(feeFils),
      feePct: String(pct),
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return { id: session.id, url: session.url, feeAmount: feeFils / 100 };
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

export function constructWebhookEvent(rawBody, signature) {
  const client = getClient();
  return client.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}
