import { Router } from 'express';
import { Organisation } from '../tenancy/control.js';
import { forgetOrganisation } from '../middleware/tenant.js';
import { constructPlatformWebhookEvent } from '../services/platformBilling.js';

const router = Router();

// Express 4 drops async route errors on the floor (the request hangs) — wrap.
// Stripe also retries on any non-2xx, so an uncaught error here matters more
// than most routes.
const aw = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error('[PlatformBillingWebhook]', e.message);
  if (!res.headersSent) res.status(500).json({ error: e.message });
});

/** Stripe's subscription status, translated to the one thing the rest of the
 *  app checks: is this organisation capped or not. Anything short of an
 *  actually-collected payment reverts to trial rather than staying paid on
 *  trust — a lapsed card should re-impose the cap, not quietly keep the
 *  account unlimited. */
function planFor(subscriptionStatus) {
  return ['active', 'trialing'].includes(subscriptionStatus) ? 'paid' : 'trial';
}

async function applyPlan(organisationId, update) {
  if (!organisationId) return;
  await Organisation().updateOne({ _id: organisationId }, { $set: update });
  forgetOrganisation(organisationId);
}

/** Subscription events carry the Stripe customer, not our metadata — Stripe
 *  only copies checkout-session metadata onto the subscription it creates
 *  when it's set on `subscription_data` at checkout time, and matching by
 *  the customer id we already stored is simpler than relying on that. */
async function organisationIdForCustomer(stripeCustomerId) {
  if (!stripeCustomerId) return null;
  const org = await Organisation().findOne({ stripeCustomerId }).select('_id').lean();
  return org?._id ?? null;
}

router.post('/', aw(async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const rawBody = req.rawBody;
  if (!rawBody) return res.status(400).json({ error: 'Missing raw request body' });

  let event;
  try {
    event = constructPlatformWebhookEvent(rawBody, signature);
  } catch (e) {
    console.error('[PlatformBillingWebhook] signature verification failed:', e.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.mode === 'subscription') {
      await applyPlan(session.metadata?.organisationId, {
        plan: 'paid',
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
      });
    }
  }

  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    await applyPlan(await organisationIdForCustomer(sub.customer), { plan: planFor(sub.status) });
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    await applyPlan(await organisationIdForCustomer(sub.customer), { plan: 'trial' });
  }

  res.json({ received: true });
}));

export default router;
