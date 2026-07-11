const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');

const router = express.Router();
const DEMO = () => String(process.env.DEMO_OTP).toLowerCase() === 'true';

// POST /api/auth/request-otp  { phone }
// Generates a 4-digit code. In DEMO mode the code is returned in the response
// (so you don't need an SMS provider). In production, send it via Twilio/SMS here.
router.post('/request-otp', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const code = String(Math.floor(1000 + Math.random() * 9000));
    const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 min

    const user = await User.findOneAndUpdate(
      { phone },
      { phone, otpCode: code, otpExpiresAt: expires },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // TODO(production): await sms.send(phone, `Your PurpleBox code is ${code}`);
    console.log(`OTP for ${phone}: ${code}`);

    res.json({ ok: true, ...(DEMO() ? { devCode: code } : {}) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/verify-otp  { phone, code }
router.post('/verify-otp', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').trim();
    const code = String(req.body.code || '').trim();
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });

    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ error: 'Request a code first' });

    const valid =
      DEMO() || // in demo mode any 4-digit code works
      (user.otpCode === code && user.otpExpiresAt && user.otpExpiresAt > new Date());

    if (!valid) return res.status(401).json({ error: 'Invalid or expired code' });

    user.otpCode = null;
    user.otpExpiresAt = null;
    await user.save();

    res.json({
      token: signToken(user),
      user: { id: user._id, phone: user.phone, name: user.name, role: user.role },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/admin-login  { phone, password }  (for the ops/admin panel)
router.post('/admin-login', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').trim();
    const password = String(req.body.password || '');
    const user = await User.findOne({ phone, role: 'admin' });
    if (!user || !user.passwordHash) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ token: signToken(user), user: { id: user._id, phone: user.phone, role: user.role } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
