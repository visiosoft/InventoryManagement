import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function signToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email, name: user.name, role: user.role, permissions: user.permissions ?? [] },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
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
