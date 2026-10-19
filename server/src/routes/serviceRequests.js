import { Router } from 'express';
import { User } from '../models/index.js';
import { ServiceRequest, SERVICE_TYPES, SERVICE_STATUSES } from '../models/serviceRequest.js';
import { operationalPermission } from '../services/warehouse.js';
import { notifyServiceStatus } from '../services/customerNotify.js';
import { expireStale } from '../services/servicePayments.js';
import { syncFromSource } from '../services/clientRequests.js';

/**
 * Staff side of the valet jobs customers book in the app: see what's waiting,
 * move it along, say who's driving, and record what was actually charged.
 *
 * Same gate as the warehouse routes — the people who run the vans and the
 * shelves — and re-read from the account so a revoked permission bites at once.
 */
const router = Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };

router.use(asyncRoute(async (req, res, next) => {
  if (!req.user?.id || !/^[a-f0-9]{24}$/i.test(req.user.id)) return res.status(401).json({ error: 'Employee authentication required.' });
  const user = await User.findById(req.user.id).select('role permissions isActive name');
  if (!user?.isActive || !operationalPermission(user)) return res.status(403).json({ error: 'Warehouse permission required.' });
  req.staffUser = user;
  next();
}));

// A finished or cancelled job is history; reopening one would put a cancelled
// delivery back on a customer's screen. Anything else may move either way —
// plans change, and staff know the order of a day better than a rule would.
const FINAL = ['completed', 'cancelled'];

const shortText = (v, max, what) => {
  if (typeof v !== 'string' || v.length > max) fail(`${what} must be text of at most ${max} characters.`);
  return v.trim();
};

// A delivery not paid for yet isn't a job yet, so it is left out unless asked
// for (?includeUnpaid=1, or ?status=awaiting_payment). Items come with their
// shelf, so a drop-off doubles as the pick list.
router.get('/', asyncRoute(async (req, res) => {
  const filter = {};
  if (req.query.status) { if (!SERVICE_STATUSES.includes(req.query.status)) fail('Invalid status.'); filter.status = req.query.status; }
  else if (req.query.includeUnpaid !== '1') filter.status = { $ne: 'awaiting_payment' };
  if (req.query.type) { if (!SERVICE_TYPES.includes(req.query.type)) fail('Invalid type.'); filter.type = req.query.type; }
  const requests = await ServiceRequest.find(filter)
    .populate('customer', 'fullName phone clientId')
    .populate('contract', 'contractNo')
    .populate({ path: 'items', select: 'displayCode description type currentStatus currentLocation', populate: { path: 'currentLocation', select: 'displayCode name' } })
    .sort({ date: 1, createdAt: -1 }).limit(500).lean();
  res.json(await expireStale(requests));
}));

router.patch('/:id', asyncRoute(async (req, res) => {
  if (!/^[a-f0-9]{24}$/i.test(req.params.id)) fail('Request not found.', 404);
  const r = await ServiceRequest.findById(req.params.id);
  if (!r) fail('Request not found.', 404);
  const body = req.body || {};

  let statusChanged = false;
  if (body.status !== undefined && body.status !== r.status) {
    if (!SERVICE_STATUSES.includes(body.status)) fail('Invalid status.');
    // Only booking in the app puts a request into waiting for payment.
    if (body.status === 'awaiting_payment') fail('Only the customer app sets a request to awaiting payment.');
    if (FINAL.includes(r.status)) fail(`This request is already ${r.status}.`, 409);
    r.status = body.status;
    r.statusLog.push({ status: body.status, at: new Date() });
    statusChanged = true;
  }
  if (body.staffNote !== undefined) r.staffNote = shortText(body.staffNote, 2000, 'Staff note');
  if (body.driverName !== undefined) r.driverName = shortText(body.driverName, 120, 'Driver name');
  if (body.driverPhone !== undefined) r.driverPhone = shortText(body.driverPhone, 40, 'Driver phone');
  if (body.warehouseJob !== undefined) r.warehouseJob = body.warehouseJob ? shortText(body.warehouseJob, 64, 'Warehouse job') : null;
  if (body.charged !== undefined) {
    // What the customer actually owes once the job is done; null clears it.
    if (body.charged !== null && (typeof body.charged !== 'number' || !Number.isFinite(body.charged) || body.charged < 0 || body.charged > 1e6)) {
      fail('Charged must be an amount in AED.');
    }
    r.charged = body.charged === null ? null : Math.round(body.charged * 100) / 100;
  }
  await r.save();
  // After the save, so the customer is never told about a change that didn't
  // stick. Keyed per status, so flicking back and forth announces each once.
  if (statusChanged) await notifyServiceStatus(r);
  // Keeps the Client Requests inbox row in step; never throws.
  if (statusChanged) await syncFromSource('ServiceRequest', r._id);
  await r.populate('customer', 'fullName phone clientId');
  res.json(r.toObject());
}));

router.use((error, _req, res, _next) => {
  const status = error.status || (['ValidationError', 'CastError'].includes(error.name) ? 400 : 500);
  if (status === 500) console.error('[service-requests]', error);
  res.status(status).json({ error: status === 500 ? 'Could not update the service request.' : error.message });
});

export default router;
