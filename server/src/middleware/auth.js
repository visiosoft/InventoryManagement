import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Customer and crew tokens share this secret; they must not unlock staff routes.
    if (payload.type === 'customer' || payload.type === 'crew') {
      return res.status(403).json({ error: 'Staff access required' });
    }
    /* An admin "viewing as" someone gets a token that can look but not touch:
     * whatever they open, nothing is sent, saved or marked as seen under the
     * other person's name. Enforced here so every route under requireAuth is
     * covered, including ones added later. */
    if (payload.viewAs && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return res.status(403).json({ error: `View-only: you are viewing as ${payload.name}. Exit to make changes.` });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * 'accounts_admin' is stored as its own role so it can be listed and picked,
 * but everything that checks access sees an admin: the session carries
 * role 'admin' plus an `accountsAdmin` marker the client uses to land them on
 * the accounts dashboard.
 */
export const effectiveRole = (role) => (role === 'accounts_admin' ? 'admin' : role);

export function signToken(user, extra = {}, expiresIn = '7d') {
  return jwt.sign(
    { ...extra, id: user._id, email: user.email, name: user.name, role: effectiveRole(user.role), accountsAdmin: user.role === 'accounts_admin', permissions: user.role === 'accounts_admin' ? [] : (user.permissions ?? []) },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

/**
 * Campaign Studio: admins, plus anyone an admin ticked "Campaign Studio" for in
 * Settings → Users. Read from the database rather than the token, so a grant
 * (or its removal) takes effect without the person logging out and in.
 */
export async function requireCampaignAccess(req, res, next) {
  try {
    if (req.user?.role === 'admin') return next();
    const { User } = await import('../models/index.js');
    const u = await User.findById(req.user?.id).select('permissions isActive').lean();
    if (u?.isActive !== false && u?.permissions?.includes('campaign_studio')) return next();
    return res.status(403).json({ error: 'Campaign Studio has not been turned on for you' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

/**
 * Look, but do not touch.
 *
 * Accounts need to read a contract and a tenant to invoice against them, and
 * that is all — they are not the people who agree terms or correct somebody's
 * details. Enforced here rather than by hiding buttons: a hidden button is a
 * suggestion, and the request still works if anybody sends it.
 *
 * Applied at the mount, so it covers every route under it — including ones
 * added later, which is the failure mode of guarding handlers one at a time.
 */
export function readOnlyFor(...roles) {
  const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
  return (req, res, next) => {
    if (SAFE.has(req.method) || !roles.includes(req.user?.role)) return next();
    return res.status(403).json({ error: 'Your role can view this but not change it' });
  };
}
