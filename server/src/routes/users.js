import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User, ALL_MODULES } from '../models/index.js';
import { requireAdmin, signToken } from '../middleware/auth.js';

const router = Router();

// ── List all users (admin only) ───────────────────────────────────────────────
router.get('/', requireAdmin, async (_req, res) => {
  const users = await User.find().select('-passwordHash').sort({ createdAt: -1 });
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
  const user = await User.create({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash,
    role: role === 'admin' ? 'admin' : 'staff',
    permissions: Array.isArray(permissions) ? permissions.filter(p => ALL_MODULES.includes(p)) : [],
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
  if (user.role === 'admin' && role === 'staff') {
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
  if (role !== undefined) user.role = role === 'admin' ? 'admin' : 'staff';
  if (Array.isArray(permissions)) user.permissions = permissions.filter(p => ALL_MODULES.includes(p));
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
