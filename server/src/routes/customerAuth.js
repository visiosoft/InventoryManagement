import { Router } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { Customer } from '../models/index.js';
import { checkOtp, issueOtp, normalizePhone } from '../services/customerOtp.js';
import { findCustomersByContact, maskEmail, parseContact } from '../services/customerLookup.js';

const router = Router();

// Sending a code costs money and texts a stranger, so this is per-IP on top of
// the per-phone cooldown in services/customerOtp.js.
export const otpLimiter = rateLimit({
  windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — please wait a minute and try again.' },
  skip: () => process.env.NODE_ENV === 'test',
});

/** `via: 'phone'` marks a login whose phone was proven by a code just now. */
export function signCustomerToken(customer, via) {
  return jwt.sign(
    { customerId: customer._id, phone: customer.phone, type: 'customer', ...(via ? { via } : {}) },
    process.env.JWT_SECRET,
    { expiresIn: '30d' },
  );
}

export function customerPayload(customer) {
  return { id: customer._id, fullName: customer.fullName, phone: customer.phone, email: customer.email };
}

// A browser tab or the in-app browser can't send our Bearer header, so to open
// a PDF the app swaps its login for a document link: good for one path, for a
// few minutes, and for nothing else. The login token itself never goes in a URL.
const DOCUMENT_PATH = /^\/customer-portal\/(storage\/(contracts|invoices)\/[a-f\d]{24}\/pdf|storage\/payments\/[a-f\d]{24}\/receipt|booking\/[a-f\d]{24}\/contract\.pdf)$/;

function documentLinkCustomer(req) {
  if (req.method !== 'GET' || typeof req.query.dt !== 'string') return null;
  try {
    const d = jwt.verify(req.query.dt, process.env.JWT_SECRET);
    if (d.type !== 'customer_doc' || d.path !== req.originalUrl.split('?')[0]) return null;
    return { customerId: d.customerId, type: 'customer' };
  } catch {
    return null;
  }
}

export function requireCustomer(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    const viaLink = documentLinkCustomer(req);
    if (viaLink) { req.customer = viaLink; return next(); }
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'customer') return res.status(401).json({ error: 'Invalid token type' });
    req.customer = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Log in with the mobile or the email we hold for you. A mobile we don't know
// starts a new account; an email we don't know is turned away, because every
// account needs a mobile and an email alone can't create one.
// `phone` is what older app builds send; `identifier` takes either.
const contactOf = (body) => parseContact(body?.identifier ?? body?.phone);
const otpKey = (contact) => (contact.kind === 'phone' ? contact.digits : `login:${contact.key}`);

// `href` is the document's API path as the app lists it; the route serving it
// still checks the document belongs to this customer.
router.post('/document-link', requireCustomer, (req, res) => {
  const href = String(req.body?.href || '');
  if (!DOCUMENT_PATH.test(href)) return res.status(400).json({ error: 'Not a document' });
  const token = jwt.sign({ type: 'customer_doc', customerId: req.customer.customerId, path: `/api${href}` }, process.env.JWT_SECRET, { expiresIn: '5m' });
  res.json({ token, expiresIn: 300 });
});

router.post('/request-otp', otpLimiter, async (req, res) => {
  try {
    const contact = contactOf(req.body);
    if (contact.kind === 'email') {
      const { customers } = await findCustomersByContact(contact);
      if (!customers.length) {
        return res.status(404).json({ error: "We don't have that email on file. Log in with your mobile number instead.", code: 'unknown_email' });
      }
      const sent = await issueOtp({ key: otpKey(contact), email: customers[0].email });
      return res.json({ message: 'OTP sent', channel: 'email', sentTo: maskEmail(customers[0].email), ...(sent.devCode ? { code: sent.devCode } : {}) });
    }
    const sent = await issueOtp({ key: otpKey(contact), phone: contact.digits });
    res.json({ message: 'OTP sent', channel: 'phone', ...(sent.devCode ? { code: sent.devCode } : {}) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/verify-otp', otpLimiter, async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Phone and code are required' });
    const contact = contactOf(req.body);

    await checkOtp({ key: otpKey(contact), code });

    // The record that rents something wins, so the app opens on their units.
    let customer = (await findCustomersByContact(contact)).customers[0];
    const isNew = !customer;
    if (!customer) {
      if (contact.kind === 'email') return res.status(404).json({ error: "We don't have that email on file." });
      const { fullName } = req.body;
      const e164 = `+${normalizePhone(contact.value)}`;
      /* Signing in is not renting.
       *
       * Anybody can reach the portal and get themselves a record; before this
       * they arrived on the tenant list as a customer. They are promoted when
       * a contract exists, like everybody else — services/customerStage.js. */
      customer = await Customer.create({ fullName: fullName || e164, phone: e164, phones: [e164], stage: 'prospect' });
    }

    const token = signCustomerToken(customer, contact.kind === 'phone' ? 'phone' : 'email');
    res.json({ token, customer: customerPayload(customer), isNew });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
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
        // Signing in with Google is not renting either.
        stage: 'prospect',
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

// Whether this login's phone was proven by a code. Tokens from before `via`
// existed came from phone codes unless the record was made by Google, where
// the phone is only typed in (set-phone) and proves nothing.
const phoneProven = (decoded, customer) => decoded.via === 'phone' || (!decoded.via && !customer.googleId);

router.get('/me', requireCustomer, async (req, res) => {
  try {
    let customer = await Customer.findById(req.customer.customerId).lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    // Logged in before their stored number was recognised, so they got an
    // empty record of their own? Move them onto the one renting on that
    // number — the same hand-over link-unit does — and give the app a new token.
    let token;
    if (phoneProven(req.customer, customer) && customer.phone) {
      const { customers, renting } = await findCustomersByContact({ kind: 'phone', value: customer.phone });
      const tenant = renting.has(String(customer._id)) ? null : customers.find((c) => renting.has(String(c._id)));
      if (tenant) {
        const e164 = `+${normalizePhone(customer.phone)}`;
        await Customer.updateOne({ _id: tenant._id }, { $addToSet: { phones: e164 } });
        await Customer.updateOne({ _id: customer._id }, { $set: { phone: '', phones: [] } });
        customer = await Customer.findById(tenant._id).lean();
        token = signCustomerToken(customer, 'phone');
      }
    }
    res.json({ customer: { ...customerPayload(customer), nationality: customer.nationality, address: customer.address }, ...(token ? { token } : {}) });
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
    if (email !== undefined) {
      const before = await Customer.findById(req.customer.customerId).select('email').lean();
      if (String(before?.email || '').trim().toLowerCase() !== String(email || '').trim().toLowerCase()) update.emailFromApp = true;
    }
    const customer = await Customer.findByIdAndUpdate(req.customer.customerId, update, { new: true }).lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json({ customer: { ...customerPayload(customer), nationality: customer.nationality, address: customer.address } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
