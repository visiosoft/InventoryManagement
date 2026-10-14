import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { User, AuditLog } from '../models/index.js';
import { signToken, requireAuth, effectiveRole } from '../middleware/auth.js';
import { sendMail, mailConfigured } from '../services/mail.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const user = await User.findOne({ email: String(email).toLowerCase() });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({
    token: signToken(user),
    user: { id: user._id, name: user.name, email: user.email, role: effectiveRole(user.role), accountsAdmin: user.role === 'accounts_admin', permissions: user.role === 'accounts_admin' ? [] : (user.permissions ?? []), isActive: user.isActive ?? true },
  });
});

router.post('/forgot-password', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const user = await User.findOne({ email });
  if (!user) return res.json({ ok: true });

  const token = crypto.randomBytes(32).toString('hex');
  user.resetToken = token;
  user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();

  const baseUrl = process.env.APP_URL || 'https://office.purplebox.ae';
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  try {
    if (mailConfigured()) {
      await sendMail({
        to: user.email,
        subject: 'PurpleBox — Reset your password',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#14081F">Reset your password</h2>
            <p>Hi ${user.name},</p>
            <p>Click the button below to reset your password. This link expires in 1 hour.</p>
            <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:#5B2BC9;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin:16px 0">Reset Password</a>
            <p style="font-size:13px;color:#756E80">If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
        text: `Reset your password: ${resetUrl}`,
      });
    }
  } catch {
    // Silently fail — don't reveal email delivery issues
  }

  res.json({ ok: true });
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const user = await User.findOne({
    resetToken: String(token),
    resetTokenExpiry: { $gt: new Date() },
  });
  if (!user) return res.status(400).json({ error: 'Invalid or expired reset link' });

  user.passwordHash = await bcrypt.hash(String(password), 10);
  user.resetToken = null;
  user.resetTokenExpiry = null;
  await user.save();

  res.json({ ok: true });
});

// Fresh from the database, not the token: permissions are baked into the token
// at login, so a grant made in Settings → Users would otherwise not show until
// the person logged out and back in.
/**
 * "View as": an admin opens the app the way another person sees it, with no
 * password. The token is view-only (see requireAuth), lasts two hours, carries
 * who is really behind it, and starting one is written to the audit log.
 */
router.post('/view-as', requireAuth, async (req, res) => {
  try {
    if (req.user?.role !== 'admin' || req.user.viewAs) return res.status(403).json({ error: 'Admins only' });
    const target = await User.findById(String(req.body?.userId || '')).select('-passwordHash');
    if (!target || target.isActive === false) return res.status(404).json({ error: 'User not found or inactive' });
    if (String(target._id) === String(req.user.id)) return res.status(400).json({ error: 'That is you' });
    const token = signToken(target, { viewAs: true, actorId: req.user.id, actorName: req.user.name }, '2h');
    await AuditLog.create({
      user: req.user.id, userName: req.user.name || '', userEmail: req.user.email || '',
      action: 'view_as', entity: 'user', entityId: String(target._id),
      method: 'POST', path: '/auth/view-as', ipAddress: req.ip || '',
      detail: `Viewing as ${target.name} (${target.email})`,
    }).catch(() => {});
    res.json({
      token,
      user: { id: target._id, name: target.name, email: target.email, role: effectiveRole(target.role), accountsAdmin: target.role === 'accounts_admin', permissions: target.role === 'accounts_admin' ? [] : (target.permissions ?? []), isActive: true },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash').lean();
    if (!user) return res.json({ user: req.user });
    res.json({
      user: {
        id: user._id, name: user.name, email: user.email, role: effectiveRole(user.role),
        accountsAdmin: user.role === 'accounts_admin',
        permissions: user.role === 'accounts_admin' ? [] : (user.permissions ?? []),
        isActive: user.isActive ?? true,
      },
    });
  } catch {
    res.json({ user: req.user });
  }
});

export default router;
