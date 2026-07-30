import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { User } from '../models/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
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
    user: { id: user._id, name: user.name, email: user.email, role: user.role, permissions: user.permissions ?? [], isActive: user.isActive ?? true },
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

  const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
  const resetUrl = `${origin}/reset-password?token=${token}`;

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
