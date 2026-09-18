/**
 * Caps a create route to a fixed count while an organisation is on the free
 * trial plan. `req.org` is only ever set by `middleware/tenant.js`'s
 * `withTenant` in multi-tenant mode with a signed-in organisation — it is
 * `undefined` for the single-tenant deployment and for any request with no
 * organisation yet, so this is a no-op there by construction rather than by
 * a feature flag.
 */
export function enforceTrialCap(Model, max, label) {
  return async (req, res, next) => {
    if (!req.org || req.org.plan !== 'trial') return next();
    try {
      const count = await Model.countDocuments();
      if (count >= max) {
        return res.status(403).json({
          error: `Your free trial is limited to ${max} ${label}. Upgrade to add more.`,
        });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
