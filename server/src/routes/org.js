import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { createSubscriptionCheckout, createBillingPortalSession } from '../services/platformBilling.js';

const router = Router();

const LIMITS = { units: 50, contracts: 50 };

/** What the trial banner and the Billing settings section both need — plan,
 *  status, and live usage against the two capped resources. `req.org` is
 *  only set in multi-tenant mode (see middleware/tenant.js), so a
 *  single-tenant deployment answers `{ multiTenant: false }` and the client
 *  shows nothing. */
router.get('/status', async (req, res) => {
  if (!req.org) return res.json({ multiTenant: false });

  const { Unit, Contract } = await import('../models/index.js');
  const [units, contracts] = await Promise.all([Unit.countDocuments(), Contract.countDocuments()]);

  res.json({
    multiTenant: true,
    plan: req.org.plan,
    status: req.org.status,
    name: req.org.name,
    limits: LIMITS,
    usage: { units, contracts },
  });
});

router.post('/upgrade', requireAdmin, async (req, res) => {
  if (!req.org) return res.status(400).json({ error: 'Not available on this deployment' });
  try {
    const baseUrl = process.env.APP_URL || 'https://office.purplebox.ae';
    const out = await createSubscriptionCheckout({
      org: req.org,
      successUrl: `${baseUrl}/settings?upgraded=1`,
      cancelUrl: `${baseUrl}/settings`,
    });
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/billing-portal', requireAdmin, async (req, res) => {
  if (!req.org) return res.status(400).json({ error: 'Not available on this deployment' });
  try {
    const baseUrl = process.env.APP_URL || 'https://office.purplebox.ae';
    const out = await createBillingPortalSession({ org: req.org, returnUrl: `${baseUrl}/settings` });
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
