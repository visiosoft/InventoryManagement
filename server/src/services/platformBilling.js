import Stripe from 'stripe';
import { Organisation } from '../tenancy/control.js';

/**
 * The platform's own Stripe account — a tenant paying US for their SaaS
 * subscription. Deliberately separate from `services/stripe.js`, which is a
 * tenant's own account for THEIR customers paying invoices: sharing one
 * account and one webhook secret between "our revenue" and "a tenant's rent
 * collection" would mean a tenant's Stripe dashboard shows the platform's
 * subscription charges, and vice versa.
 */

export function platformBillingConfigured() {
  return Boolean(process.env.PLATFORM_STRIPE_SECRET_KEY && process.env.PLATFORM_STRIPE_PRICE_ID);
}

let cachedClient = null;
let cachedKey = null;

function getClient() {
  if (!process.env.PLATFORM_STRIPE_SECRET_KEY) {
    throw new Error('Platform billing is not configured — set PLATFORM_STRIPE_SECRET_KEY');
  }
  if (!cachedClient || cachedKey !== process.env.PLATFORM_STRIPE_SECRET_KEY) {
    cachedClient = new Stripe(process.env.PLATFORM_STRIPE_SECRET_KEY);
    cachedKey = process.env.PLATFORM_STRIPE_SECRET_KEY;
  }
  return cachedClient;
}

/** Reuses the org's Stripe Customer if it already has one from a previous
 *  checkout attempt, so a retried signup doesn't create a duplicate. */
async function customerFor(client, org) {
  if (org.stripeCustomerId) return org.stripeCustomerId;
  const customer = await client.customers.create({
    email: org.ownerEmail,
    name: org.name,
    metadata: { organisationId: String(org._id) },
  });
  await Organisation().updateOne({ _id: org._id }, { $set: { stripeCustomerId: customer.id } });
  return customer.id;
}

export async function createSubscriptionCheckout({ org, successUrl, cancelUrl }) {
  if (!process.env.PLATFORM_STRIPE_PRICE_ID) {
    throw new Error('Platform billing is not configured — set PLATFORM_STRIPE_PRICE_ID');
  }
  const client = getClient();
  const customer = await customerFor(client, org);
  const session = await client.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: process.env.PLATFORM_STRIPE_PRICE_ID, quantity: 1 }],
    metadata: { organisationId: String(org._id) },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return { url: session.url };
}

/** A paid tenant manages or cancels through Stripe's own hosted portal,
 *  rather than custom subscription-management UI here. */
export async function createBillingPortalSession({ org, returnUrl }) {
  if (!org.stripeCustomerId) throw new Error('This account has no billing history yet');
  const client = getClient();
  const session = await client.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}

export function constructPlatformWebhookEvent(rawBody, signature) {
  const client = getClient();
  return client.webhooks.constructEvent(rawBody, signature, process.env.PLATFORM_STRIPE_WEBHOOK_SECRET);
}
