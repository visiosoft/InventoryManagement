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

// Creates a hosted Stripe Checkout session for the invoice's current balance
// due. Returns { id, url }. The session itself is the "payment link" — no
// separate public page of ours is needed, Stripe hosts the checkout UI.
//
// feePct (optional): when set, adds a separate "card processing fee" line so
// the customer — not PurpleBox — covers Stripe's cut. The invoice-owed
// portion is recorded in metadata.invoiceAmountFils so the webhook credits
// only that amount against the invoice, never the fee on top of it.
export async function createInvoiceCheckoutSession({ invoice, customerEmail, successUrl, cancelUrl, feePct = 0 }) {
  const client = getClient();
  const amountFils = Math.round(Number(invoice.balanceDue) * 100);
  if (!Number.isFinite(amountFils) || amountFils <= 0) {
    throw new Error('Invoice has no outstanding balance to charge');
  }
  const pct = Number(feePct) || 0;
  const feeFils = pct > 0 ? Math.round(amountFils * (pct / 100)) : 0;

  const lineItems = [{
    price_data: {
      currency: 'aed',
      unit_amount: amountFils,
      product_data: {
        name: `Invoice ${invoice.invoiceNo}`,
        description: `Moving invoice balance due — PurpleBox`,
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
      movingInvoiceId: String(invoice._id),
      invoiceNo: invoice.invoiceNo,
      invoiceAmountFils: String(amountFils),
      feeFils: String(feeFils),
      feePct: String(pct),
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return { id: session.id, url: session.url, feeAmount: feeFils / 100 };
}

export function constructWebhookEvent(rawBody, signature) {
  const client = getClient();
  return client.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}
