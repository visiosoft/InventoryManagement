import { Router } from 'express';
import mongoose from 'mongoose';
import { Customer } from '../models/index.js';
import { CustomerNotification } from '../models/customerNotification.js';
import { requireCustomer } from './customerAuth.js';

/**
 * The customer's notification inbox in the app, and the one switch they have
 * over it. Mounted inside customerStorage.js, under the same login.
 *
 * Same rule as the rest of the portal: every query starts from the signed-in
 * customer, and rows go out through a view — the dedupe key and the customer
 * id are ours, not theirs.
 */
const router = Router();
router.use(requireCustomer);

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
};
const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };

const INBOX_SIZE = 100;

const notificationView = (n) => ({
  id: n._id,
  kind: n.kind,
  title: n.title,
  body: n.body,
  data: { route: n.data?.route || '/(tabs)', ...(n.data?.params ? { params: n.data.params } : {}) },
  read: !!n.readAt,
  createdAt: n.createdAt,
});

const unreadFor = (customerId) => CustomerNotification.countDocuments({ customer: customerId, readAt: null });

router.get('/notifications', wrap(async (req, res) => {
  const customerId = req.customer.customerId;
  const [items, unread] = await Promise.all([
    CustomerNotification.find({ customer: customerId }).sort({ createdAt: -1, _id: -1 }).limit(INBOX_SIZE).lean(),
    unreadFor(customerId),
  ]);
  res.json({ items: items.map(notificationView), unread });
}));

// Ids that aren't theirs (or aren't ids) are simply not matched: nothing to
// say about somebody else's inbox, not even that a row exists.
router.post('/notifications/read', wrap(async (req, res) => {
  const customerId = req.customer.customerId;
  const filter = { customer: customerId, readAt: null };
  if (req.body?.all !== true) {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 500) fail('Send the ids to mark read, or all: true');
    filter._id = { $in: ids.map(String).filter((id) => mongoose.isValidObjectId(id)) };
  }
  await CustomerNotification.updateMany(filter, { $set: { readAt: new Date() } });
  res.json({ unread: await unreadFor(customerId) });
}));

const prefsView = (customer) => ({ promotions: customer?.notificationPrefs?.promotions !== false });

router.get('/notification-prefs', wrap(async (req, res) => {
  const customer = await Customer.findById(req.customer.customerId).select('notificationPrefs').lean();
  if (!customer) fail('Customer not found', 404);
  res.json(prefsView(customer));
}));

router.patch('/notification-prefs', wrap(async (req, res) => {
  if (typeof req.body?.promotions !== 'boolean') fail('promotions must be true or false');
  const customer = await Customer.findOneAndUpdate(
    { _id: req.customer.customerId },
    { $set: { 'notificationPrefs.promotions': req.body.promotions } },
    { new: true, projection: { notificationPrefs: 1 } },
  ).lean();
  if (!customer) fail('Customer not found', 404);
  res.json(prefsView(customer));
}));

export default router;
