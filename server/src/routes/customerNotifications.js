import { Router } from 'express';
import mongoose from 'mongoose';
import { Contract, User } from '../models/index.js';
import { CustomerNotification, NOTIFICATION_KINDS } from '../models/customerNotification.js';
import { operationalPermission, escapeRegex } from '../services/warehouse.js';
import { broadcastPromotion, dayLabel, notifyCustomer } from '../services/customerNotify.js';
import { addDays, dubaiToday, isDateString } from '../services/servicePricing.js';

/**
 * Staff side of the customer app's notifications: send a promotion, tell a
 * tenant their unit is being inspected, and see what went out.
 *
 * Two different gates, because these are two different jobs. A promotion is
 * marketing to people who did not ask for it, so it takes the same permission
 * as Campaign Studio. An inspection is operations, so it takes the warehouse
 * permission the service-request page uses. Both re-read from the account so a
 * revoked permission bites at once.
 */
const router = Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };

// The rule middleware/auth.js's requireCampaignAccess applies, read off the
// account loaded below rather than the login token.
const canPromote = (user) => user.role === 'admin' || user.permissions?.includes('campaign_studio');

router.use(asyncRoute(async (req, res, next) => {
  if (!req.user?.id || !/^[a-f0-9]{24}$/i.test(req.user.id)) return res.status(401).json({ error: 'Employee authentication required.' });
  const user = await User.findById(req.user.id).select('role permissions isActive name');
  if (!user?.isActive) return res.status(403).json({ error: 'Your account is not active.' });
  req.staffUser = user;
  next();
}));

const requirePromote = (req, res, next) => (canPromote(req.staffUser) ? next() : res.status(403).json({ error: 'Campaign Studio has not been turned on for you' }));
const requireOperations = (req, res, next) => (operationalPermission(req.staffUser) ? next() : res.status(403).json({ error: 'Warehouse permission required.' }));
// Either job may look at what was sent.
const requireEither = (req, res, next) => (canPromote(req.staffUser) || operationalPermission(req.staffUser)
  ? next() : res.status(403).json({ error: 'Campaign Studio or warehouse permission required.' }));

function text(v, min, max, what) {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (s.length < min || s.length > max) fail(`${what} must be ${min} to ${max} characters.`);
  return s;
}

// ── Promotions ──────────────────────────────────────────────────────────────
router.post('/broadcast', requirePromote, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const title = text(body.title, 3, 80, 'Title');
  const message = text(body.body, 3, 300, 'Message');
  if (!['tenants', 'all'].includes(body.audience)) fail('Choose who it goes to.');
  res.json(await broadcastPromotion({ title, body: message, audience: body.audience }));
}));

// ── Inspections ─────────────────────────────────────────────────────────────
const unitsOf = (c) => (c.units?.length ? c.units : [c.unit]).map((u) => u?.unitNumber).filter(Boolean);

// Finding the contract by the number on the paperwork, for the form.
router.get('/contracts', requireOperations, asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 40);
  if (q.length < 2) return res.json([]);
  const contracts = await Contract.find({ contractNo: new RegExp(escapeRegex(q), 'i'), status: 'active', archived: { $ne: true } })
    .select('contractNo customer unit units endDate').populate('customer', 'fullName').populate('unit', 'unitNumber').populate('units', 'unitNumber')
    .sort({ contractNo: 1 }).limit(20).lean();
  res.json(contracts.map((c) => ({ id: c._id, contractNo: c.contractNo, customerName: c.customer?.fullName || '', units: unitsOf(c), endDate: c.endDate })));
}));

router.post('/inspection', requireOperations, asyncRoute(async (req, res) => {
  const body = req.body || {};
  if (!mongoose.isValidObjectId(body.contractId)) fail('Choose a contract.');
  const today = dubaiToday();
  if (!isDateString(body.date) || body.date < today || body.date > addDays(today, 365)) fail('Choose a date from today up to a year ahead (YYYY-MM-DD).');
  const time = body.time ? String(body.time) : '';
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('Time must be HH:MM.');
  const note = body.note ? text(body.note, 0, 300, 'Note') : '';

  const contract = await Contract.findOne({ _id: body.contractId, status: 'active', archived: { $ne: true } })
    .select('contractNo customer unit units').populate('unit', 'unitNumber').populate('units', 'unitNumber').lean();
  if (!contract) fail('Active contract not found.', 404);

  const units = unitsOf(contract);
  const day = dayLabel(body.date);
  const at = time ? ` at ${time}` : '';
  const what = units.length ? `${units.length > 1 ? 'units' : 'unit'} ${units.join(', ')}` : 'your unit';
  const out = await notifyCustomer(contract.customer, {
    kind: 'inspection',
    title: `Unit inspection on ${day}`,
    body: `Our team will inspect ${what} on ${day}${at}.${note ? ` ${note}` : ''}`,
    data: { route: '/(tabs)/storage' },
  });
  // A push, not a save: an old contract that no longer passes validation
  // must still take a timeline line.
  await Contract.updateOne({ _id: contract._id }, { $push: { timeline: {
    text: `Unit inspection scheduled for ${day}${at} — tenant notified in the app${note ? `: ${note}` : ''}`,
    author: req.staffUser.name || 'staff',
  } } });
  res.json({ ok: true, sent: out.sent });
}));

// ── What went out ───────────────────────────────────────────────────────────
router.get('/recent', requireEither, asyncRoute(async (req, res) => {
  const filter = {};
  if (req.query.kind) { if (!NOTIFICATION_KINDS.includes(req.query.kind)) fail('Invalid kind.'); filter.kind = req.query.kind; }
  const rows = await CustomerNotification.find(filter).populate('customer', 'fullName').sort({ createdAt: -1, _id: -1 }).limit(100).lean();
  res.json(rows.map((n) => ({
    id: n._id, kind: n.kind, title: n.title, body: n.body, read: !!n.readAt, createdAt: n.createdAt,
    customer: n.customer ? { id: n.customer._id, name: n.customer.fullName } : null,
  })));
}));

router.use((error, _req, res, _next) => {
  const status = error.status || (['ValidationError', 'CastError'].includes(error.name) ? 400 : 500);
  if (status === 500) console.error('[customer-notifications]', error);
  res.status(status).json({ error: status === 500 ? 'Could not complete that.' : error.message });
});

export default router;
