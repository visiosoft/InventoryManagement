import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { Customer } from '../models/index.js';

const router = Router();

const otpStore = new Map();

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function signCustomerToken(customer) {
  return jwt.sign(
    { customerId: customer._id, phone: customer.phone, type: 'customer' },
    process.env.JWT_SECRET,
    { expiresIn: '30d' },
  );
}

function customerPayload(customer) {
  return { id: customer._id, fullName: customer.fullName, phone: customer.phone, email: customer.email };
}

export function requireCustomer(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'customer') return res.status(401).json({ error: 'Invalid token type' });
    req.customer = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

router.post('/request-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });
    const code = generateOtp();
    otpStore.set(phone, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
    res.json({ message: 'OTP sent', code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code are required' });
    const stored = otpStore.get(phone);
    if (!stored || stored.code !== code) return res.status(401).json({ error: 'Invalid OTP' });
    if (Date.now() > stored.expiresAt) { otpStore.delete(phone); return res.status(401).json({ error: 'OTP expired' }); }
    otpStore.delete(phone);

    let customer = await Customer.findOne({ $or: [{ phone }, { phones: phone }] });
    if (!customer) customer = await Customer.create({ fullName: phone, phone, phones: [phone] });

    const token = signCustomerToken(customer);
    res.json({ token, customer: customerPayload(customer) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/google', async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(400).json({ error: 'Access token is required' });

    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!infoRes.ok) return res.status(401).json({ error: 'Invalid Google token' });
    const gUser = await infoRes.json();

    if (!gUser.email) return res.status(400).json({ error: 'Google account has no email' });

    let customer = await Customer.findOne({ email: gUser.email });
    if (!customer) {
      customer = await Customer.create({
        fullName: gUser.name || gUser.email.split('@')[0],
        email: gUser.email,
        phone: '',
        googleId: gUser.sub,
      });
    } else if (!customer.googleId) {
      customer.googleId = gUser.sub;
      if (!customer.fullName || customer.fullName === customer.phone) customer.fullName = gUser.name || customer.fullName;
      await customer.save();
    }

    const needsPhone = !customer.phone;
    const token = signCustomerToken(customer);
    res.json({ token, customer: customerPayload(customer), needsPhone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/set-phone', requireCustomer, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });
    const customer = await Customer.findByIdAndUpdate(
      req.customer.customerId,
      { phone, $addToSet: { phones: phone } },
      { new: true },
    );
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const newToken = signCustomerToken(customer);
    res.json({ token: newToken, customer: customerPayload(customer) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', requireCustomer, async (req, res) => {
  try {
    const customer = await Customer.findById(req.customer.customerId).lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json({ customer: { ...customerPayload(customer), nationality: customer.nationality, address: customer.address } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/profile', requireCustomer, async (req, res) => {
  try {
    const { fullName, email, nationality, address } = req.body;
    const update = {};
    if (fullName !== undefined) update.fullName = fullName;
    if (email !== undefined) update.email = email;
    if (nationality !== undefined) update.nationality = nationality;
    if (address !== undefined) update.address = address;
    const customer = await Customer.findByIdAndUpdate(req.customer.customerId, update, { new: true }).lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json({ customer: { ...customerPayload(customer), nationality: customer.nationality, address: customer.address } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
