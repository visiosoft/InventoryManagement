import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User, ALL_MODULES } from '../models/index.js';
import { requireAdmin, signToken } from '../middleware/auth.js';

const router = Router();

const VALID_ROLES = ['admin', 'staff', 'sales_rep', 'accounts'];
// Roles that get the sales rep's access. 'accounts' is a duplicate of
// 'sales_rep' by design — same permissions, same own-records-only scope.
const SALES_REP_ROLES = ['sales_rep', 'accounts'];
const normalizeRole = (role) => (VALID_ROLES.includes(role) ? role : 'staff');
// A rep's default toolkit: their own leads board, plus read access to the
// unit map, tenant directory, and moving schedule for sales conversations.
const SALES_REP_DEFAULT_PERMISSIONS = ['sales_board', 'units', 'customers', 'contracts', 'moving_schedule'];

/**
 * What a role always has, whatever the permission list says.
 *
 * The defaults above only apply when the list is empty, so an admin saving the
 * user form with a box unticked took the module away — and a rep who cannot
 * look up which units are free cannot do their job at all. Searching units is
 * not a privilege to grant, it is the job.
 *
 * Enforced on save so the stored record is always right, and mirrored in the
 * client so it does not wait for the next login to take effect.
 */
const ROLE_FLOOR = {
    sales_rep: ['sales_board', 'units'],
    // Accounts invoice against contracts, so they need the tenant, the unit
    // and the contract to be reachable. Mirrored in client/src/lib/auth.tsx.
    accounts: ['dashboard', 'units', 'customers', 'contracts'],
};

/** The list somebody chose, plus whatever their role cannot be without. */
function withRoleFloor(role, permissions) {
    const floor = ROLE_FLOOR[role] || [];
    return [...new Set([...(permissions || []), ...floor])];
}

// ── List all users (admin only) ───────────────────────────────────────────────
router.get('/', requireAdmin, async (_req, res) => {
  const users = await User.find().select('-passwordHash').sort({ createdAt: -1 });
  res.json(users);
});

// Minimal roster for task-assignment dropdowns — any authenticated user
// (including reps) needs this to hand a task to a teammate or admin, but
// only name/email/role, never the full admin-only user record. Tasks is a
// sales-rep/admin tool, so staff aren't offered as assignees.
router.get('/assignable', async (_req, res) => {
  // Staff are included: accounts and ops sit in this role, and tasks are
  // routed to them (e.g. "raise this invoice in Zoho Books").
  /* `$ne: false`, not `true`. A Mongoose default is applied when a document is
     created, never retroactively — so any user made before isActive existed
     carries no such field, and `isActive: true` silently drops them. Only
     somebody explicitly deactivated should be excluded, which is the idiom
     used everywhere else this question is asked. */
  const users = await User.find({ isActive: { $ne: false }, role: { $in: ['admin', 'sales_rep', 'accounts', 'staff'] } })
    .select('name email role')
    .sort({ name: 1 })
    .lean();
  res.json(users);
});

// ── Get single user ───────────────────────────────────────────────────────────
router.get('/:id', requireAdmin, async (req, res) => {
  const user = await User.findById(req.params.id).select('-passwordHash');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ── Create user (admin only) ──────────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  const { name, email, password, role, permissions } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) return res.status(409).json({ error: 'Email already in use' });
  const passwordHash = await bcrypt.hash(password, 12);
  const normalizedRole = normalizeRole(role);
  const cleanPermissions = Array.isArray(permissions) ? permissions.filter(p => ALL_MODULES.includes(p)) : [];
  const user = await User.create({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash,
    role: normalizedRole,
    // Sales reps default to their own board when no explicit permissions are given.
    permissions: withRoleFloor(
        normalizedRole,
        cleanPermissions.length === 0 && SALES_REP_ROLES.includes(normalizedRole) ? SALES_REP_DEFAULT_PERMISSIONS : cleanPermissions,
    ),
    isActive: true,
  });
  res.status(201).json({ id: user._id, name: user.name, email: user.email, role: user.role, permissions: user.permissions, isActive: user.isActive });
});

// ── Update user (admin only) ──────────────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  const { name, email, password, role, permissions, isActive } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Prevent removing the last admin
  if (user.role === 'admin' && role !== undefined && role !== 'admin') {
    const adminCount = await User.countDocuments({ role: 'admin' });
    if (adminCount <= 1) return res.status(400).json({ error: 'Cannot demote the last admin' });
  }

  if (name) user.name = name.trim();
  if (email) {
    const existing = await User.findOne({ email: email.toLowerCase(), _id: { $ne: user._id } });
    if (existing) return res.status(409).json({ error: 'Email already in use' });
    user.email = email.toLowerCase().trim();
  }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    user.passwordHash = await bcrypt.hash(password, 12);
  }
  if (role !== undefined) user.role = normalizeRole(role);
  if (Array.isArray(permissions)) user.permissions = permissions.filter(p => ALL_MODULES.includes(p));
  else if (SALES_REP_ROLES.includes(role) && user.permissions.length === 0) user.permissions = SALES_REP_DEFAULT_PERMISSIONS;
  // Whatever was chosen, the role's floor goes back on — including when the
  // role itself has just changed.
  user.permissions = withRoleFloor(user.role, user.permissions);
  if (isActive !== undefined) user.isActive = Boolean(isActive);

  await user.save();
  res.json({ id: user._id, name: user.name, email: user.email, role: user.role, permissions: user.permissions, isActive: user.isActive });
});

// ── Delete user (admin only) ──────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (req.user.id === String(user._id)) return res.status(400).json({ error: 'You cannot delete your own account' });
  if (user.role === 'admin') {
    const adminCount = await User.countDocuments({ role: 'admin' });
    if (adminCount <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' });
  }
  await user.deleteOne();
  res.json({ ok: true });
});

// ── Current user: change own password ────────────────────────────────────────
router.post('/me/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords are required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();
  res.json({ ok: true, token: signToken(user) });
});

export default router;
