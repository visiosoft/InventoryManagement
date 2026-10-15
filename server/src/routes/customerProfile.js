import { Router } from 'express';
import { Contract, Customer, Document } from '../models/index.js';
import { requireCustomer, otpLimiter } from './customerAuth.js';
import { checkOtp, issueOtp, normalizePhone } from '../services/customerOtp.js';
import { profileChecklist, validEmail } from '../services/profileChecklist.js';
import { idComplete, ID_TYPES } from '../services/identityDocs.js';
import { customerDocumentFilter } from '../services/customerIdentity.js';

/**
 * "Complete your profile" in the customer app: what we know, what is still missing, and the small steps that fill it in
 * (verify an email, choose the WhatsApp number, emergency contact, nationality and address). Every step is optional.
 */
const router = Router();
router.use(requireCustomer);

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
};
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const LIVE = ['active', 'pending_signature'];

async function me(req) {
  const customer = await Customer.findById(req.customer.customerId);
  if (!customer) throw bad('Customer not found', 404);
  return customer;
}

async function snapshot(customer) {
  const [contracts, idDocs] = await Promise.all([
    Contract.find({ customer: customer._id, status: { $in: LIVE } }).select('authorizedPersons').lean(),
    customerDocumentFilter(customer._id).then((f) => Document.find({ ...f, type: { $in: ID_TYPES } }).select('type side createdAt').lean()),
  ]);
  const accessCount = contracts.reduce((n, c) => n + (c.authorizedPersons?.length || 0), 0);
  const checklist = profileChecklist(customer, { idComplete: idComplete(idDocs), accessCount, hasContract: contracts.length > 0 });
  return {
    customer: {
      id: customer._id, fullName: customer.fullName, phone: customer.phone, email: customer.email,
      emailVerified: !!customer.emailVerifiedAt, phoneVerified: !!customer.phoneVerifiedAt,
      whatsapp: { sameAsPhone: customer.whatsappSameAsPhone !== false, phone: customer.whatsappPhone || '', optedIn: !!customer.whatsappOptIn?.at },
      emergencyNumber: customer.emergencyNumber || '', nationality: customer.nationality || '', address: customer.address || '',
    },
    checklist,
  };
}

router.get('/', wrap(async (req, res) => { res.json(await snapshot(await me(req))); }));

// ── Email: type it, get a code at that address, enter it ────────────────────
router.post('/email/request', otpLimiter, wrap(async (req, res) => {
  const customer = await me(req);
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!validEmail(email)) throw bad('Enter a valid email address');
  const sent = await issueOtp({ key: `email-verify:${customer._id}:${email}`, email });
  res.json({ ok: true, ...(sent.devCode ? { code: sent.devCode } : {}) });
}));

router.post('/email/verify', otpLimiter, wrap(async (req, res) => {
  const customer = await me(req);
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!validEmail(email)) throw bad('Enter a valid email address');
  await checkOtp({ key: `email-verify:${customer._id}:${email}`, code: req.body?.code });
  customer.email = email;
  customer.emailVerifiedAt = new Date();
  // The code proved they control this mailbox, so it may now be used to match their invoices in Zoho Books.
  customer.emailFromApp = false;
  await customer.save();
  res.json(await snapshot(customer));
}));

// ── WhatsApp: the number they log in with, or another one proven with a code ──
// Recording the choice also records the opt-in Meta requires before template messages.
router.post('/whatsapp/same', wrap(async (req, res) => {
  const customer = await me(req);
  customer.whatsappSameAsPhone = true;
  customer.whatsappPhone = '';
  customer.whatsappOptIn = { at: new Date(), source: 'app' };
  await customer.save();
  res.json(await snapshot(customer));
}));

router.post('/whatsapp/request', otpLimiter, wrap(async (req, res) => {
  const customer = await me(req);
  const digits = normalizePhone(req.body?.phone);
  if (digits.length < 10) throw bad('Enter the full WhatsApp number with country code');
  const sent = await issueOtp({ key: `wa-verify:${customer._id}:${digits}`, phone: digits });
  res.json({ ok: true, ...(sent.devCode ? { code: sent.devCode } : {}) });
}));

router.post('/whatsapp/verify', otpLimiter, wrap(async (req, res) => {
  const customer = await me(req);
  const digits = normalizePhone(req.body?.phone);
  if (digits.length < 10) throw bad('Enter the full WhatsApp number with country code');
  await checkOtp({ key: `wa-verify:${customer._id}:${digits}`, code: req.body?.code });
  customer.whatsappSameAsPhone = false;
  customer.whatsappPhone = `+${digits}`;
  customer.whatsappOptIn = { at: new Date(), source: 'app' };
  await customer.save();
  res.json(await snapshot(customer));
}));

// ── Details: emergency contact, nationality, address ────────────────────────
router.patch('/details', wrap(async (req, res) => {
  const customer = await me(req);
  const { emergencyNumber, nationality, address } = req.body || {};
  if (emergencyNumber !== undefined) {
    const digits = normalizePhone(emergencyNumber);
    if (emergencyNumber && digits.length < 9) throw bad('Enter a valid emergency number');
    customer.emergencyNumber = emergencyNumber ? `+${digits}` : '';
  }
  if (nationality !== undefined) customer.nationality = String(nationality).trim().slice(0, 60);
  if (address !== undefined) customer.address = String(address).trim().slice(0, 300);
  await customer.save();
  res.json(await snapshot(customer));
}));

export default router;
