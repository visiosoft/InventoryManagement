import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { User } from '../models/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { sendMail, mailConfigured } from '../services/mail.js';
import { tenancyMode } from '../middleware/tenant.js';
import { organisationForEmail } from '../tenancy/control.js';
import { connectionFor } from '../tenancy/connections.js';
import { runInTenant } from '../tenancy/context.js';

const router = Router();

/**
 * The one request that has to work out which customer it belongs to before it
 * can open a database.
 *
 * Everywhere else the organisation comes from the token; here there is no
 * token yet, so the address is looked up in the directory and the password is
 * checked inside that customer's own database.
 *
 * An unknown address and a wrong password are answered identically, so this
 * cannot be used to find out who has an account.
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const attempt = async (org) => {
    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return null;
    if (user.isActive === false) return null;
    return {
      token: signToken(user, org),
      user: { id: user._id, name: user.name, email: user.email, role: user.role, permissions: user.permissions ?? [], isActive: user.isActive ?? true },
      ...(org ? { organisation: { id: String(org._id), name: org.name, slug: org.slug } } : {}),
    };
  };

  // One company, one database: the context is already pinned.
  if (tenancyMode() === 'single') {
    const out = await attempt(null);
    return out ? res.json(out) : res.status(401).json({ error: 'Invalid email or password' });
  }

  const org = await organisationForEmail(email);
  if (!org) return res.status(401).json({ error: 'Invalid email or password' });
  if (org.status === 'suspended') {
    return res.status(403).json({ error: 'This account is suspended. Please get in touch.' });
  }
  if (org.status === 'provisioning') {
    return res.status(503).json({ error: 'This account is still being set up. Try again in a moment.' });
  }
  if (org.status === 'cancelled') {
    return res.status(403).json({ error: 'This account is closed.' });
  }

  const out = await runInTenant({ connection: connectionFor(org.dbName), org }, () => attempt(org));
  return out ? res.json(out) : res.status(401).json({ error: 'Invalid email or password' });
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

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
