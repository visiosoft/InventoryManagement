import { Router } from 'express';
import { provisionOrganisation } from '../tenancy/provision.js';
import { connectionFor } from '../tenancy/connections.js';
import { runInTenant } from '../tenancy/context.js';
import { signToken } from '../middleware/auth.js';

const router = Router();

/** The fields `provisionOrganisation` can't already check by itself — pulled
 *  out so it's testable without a database. */
export function validateSignup({ businessName, password }) {
  if (!businessName || !String(businessName).trim()) return 'A business name is required';
  if (!password || String(password).length < 6) return 'Password must be at least 6 characters';
  return null;
}

/**
 * Self-service: a visitor becomes a trial customer, no owner involved.
 *
 * Provisioning is the same idempotent call the owner console uses
 * (`provisionOrganisation`), so a signup and an owner-created customer end up
 * identical — this just makes the call reachable without `requireOwner`.
 * `demo` is left false, so the new organisation lands on `status: 'trial'`
 * and `plan: 'trial'` (the schema's own defaults), which is what
 * `middleware/planLimits.js` caps.
 *
 * No email verification or CAPTCHA here — a deliberate gap for this first
 * version, not an oversight.
 */
router.post('/', async (req, res) => {
  const { businessName, adminName, email, password } = req.body || {};
  const validationError = validateSignup({ businessName, password });
  if (validationError) return res.status(400).json({ error: validationError });

  let out;
  try {
    out = await provisionOrganisation({
      name: businessName,
      ownerEmail: email,
      adminName,
      password,
    });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const { organisation: org } = out;
  const { User } = await import('../models/index.js');
  const user = await runInTenant(
    { connection: connectionFor(org.dbName), org },
    () => User.findOne({ email: String(email).toLowerCase().trim() })
  );

  res.status(201).json({
    token: signToken(user, org),
    user: { id: user._id, name: user.name, email: user.email, role: user.role, permissions: user.permissions ?? [], isActive: user.isActive ?? true },
    organisation: { id: String(org._id), name: org.name, slug: org.slug },
  });
});

export default router;
