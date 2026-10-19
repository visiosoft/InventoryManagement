import { Router } from 'express';
import { Contract, Customer, Site } from '../models/index.js';
import { StoredContainer, ScanEvent, ItemPhoto, WarehouseJob } from '../models/warehouse.js';
import { ServiceRequest, SERVICE_TYPES, nextServiceRequestNo } from '../models/serviceRequest.js';
import { requireCustomer } from './customerAuth.js';
import {
  SERVICE_PRICES, CAPACITY, SLOTS, WORKER_HOURS, SERVICE_CATALOG, DISPOSAL_LOADS, slotById, estimateFor,
  workerStartTimes, workerEndTime, toMinutes, dubaiToday, addDays, isDateString, workerClosed, hoursLabel,
} from '../services/servicePricing.js';
import { CARD_FEE_PCT } from '../services/appBooking.js';
import {
  PAY_WINDOW_MINUTES, PAYING_WINDOW_MINUTES, paymentExpired, notExpired, expireStale, paymentView, describeRequest,
} from '../services/servicePayments.js';
import {
  cancelPaymentIntent, createCheckoutSession, createSheetPayment, ensureStripeCustomer, expireCheckoutSession, refundPayment,
  stripeConfigured, stripeEmbeddedConfigured, stripePublishableKey, stripeSheetEnabled,
} from '../services/stripe.js';

/**
 * Valet storage from the customer app: the things we hold for them, and the
 * jobs they book — boxes sent out, collections, deliveries back, workers at
 * their unit, a dump truck. Mounted inside customerStorage.js, under the same login.
 *
 * Same rule as the rest of the portal: every query starts from the signed-in
 * customer, and every response goes through a view below. Warehouse records
 * carry shelf codes, employee ids and scan notes, and service requests carry
 * staff notes and job links; none of that is the customer's to read.
 */
const router = Router();
router.use(requireCustomer);

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
};
const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };
const notFound = (what) => fail(`${what} not found`, 404);

const MAX_ADDRESSES = 10;
const BOOK_AHEAD_DAYS = 60;
const DEFAULT_FACILITY = 'PurpleBox Storage, Al Quoz 2';
const OPEN_STATUSES = ['requested', 'confirmed', 'scheduled', 'in_progress'];
const CANCELLABLE = ['awaiting_payment', 'requested', 'confirmed', 'scheduled'];
const IN_WAREHOUSE = ['RECEIVED', 'AWAITING_PUTAWAY', 'IN_STORAGE'];
const DELIVERS = ['dropoff', 'both'];

// ── Facility & contract ─────────────────────────────────────────────────────
const activeContract = (customerId) =>
  Contract.findOne({ customer: customerId, status: 'active', archived: { $ne: true } })
    .populate('unit').populate('units').sort({ startDate: -1 });

// Where a rented worker meets the customer: their own unit, at its facility.
async function facilityFor(contract) {
  const unit = contract?.units?.[0] || contract?.unit;
  if (!unit?.unitNumber) return { label: 'At my unit', line: DEFAULT_FACILITY };
  // A unit with no site is on the default site — same convention as Unit.site.
  const site = unit.site ? await Site.findById(unit.site).lean() : await Site.findOne({ isDefault: true }).lean();
  return { label: 'At my unit', line: `Unit ${unit.unitNumber} · ${site?.address || DEFAULT_FACILITY}` };
}

// ── Items ───────────────────────────────────────────────────────────────────
const humanise = (type) => {
  const words = String(type || 'item').toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// Items on a delivery that hasn't happened yet, and how far along it is. An
// item on its way back is not "stored" any more as far as the customer cares,
// even before the warehouse scans it out. A delivery still being paid for
// holds its items; one whose time to pay ran out does not.
async function deliveriesFor(customerId) {
  const open = await ServiceRequest.find({
    customer: customerId, type: { $in: DELIVERS }, status: { $in: ['awaiting_payment', ...OPEN_STATUSES] }, ...notExpired(),
  }).select('items status').lean();
  const byItem = new Map();
  for (const r of open) for (const id of r.items) byItem.set(String(id), r.status);
  return byItem;
}

function itemStatus(c, deliveries) {
  const delivery = deliveries.get(String(c._id));
  if (delivery) return delivery === 'in_progress' ? 'transit' : 'scheduled';
  if (c.currentStatus === 'CREATED') return 'expected'; // labelled, not collected yet
  if (c.currentStatus === 'DISPATCHED') return 'out';
  return 'stored';
}

function itemView(c, deliveries) {
  const hasDims = c.length != null || c.width != null || c.height != null;
  return {
    id: c._id,
    label: c.displayCode,
    name: c.description || humanise(c.type),
    category: c.type,
    status: itemStatus(c, deliveries),
    condition: c.condition,
    storedAt: c.storedAt || null,
    hasPhoto: (c.photoCount || 0) > 0,
    dims: hasDims ? { length: c.length, width: c.width, height: c.height } : null,
    weight: c.weight,
    contents: c.contents || '',
  };
}

const briefItemView = (c, deliveries) => ({ id: c._id, label: c.displayCode, name: c.description || humanise(c.type), status: itemStatus(c, deliveries) });

// The valet is for customers we hold things for: anything ever labelled for
// them counts, even if all of it has gone back since.
const valetActive = async (customerId) => Boolean(await StoredContainer.findOne({ customer: customerId }).select('_id').lean());

async function ownedItem(req, id) {
  const item = await StoredContainer.findOne({ _id: String(id), customer: req.customer.customerId }).lean();
  if (!item) notFound('Item');
  return item;
}

// What a scan means to the person who owns the box. Relocations, edits,
// label reprints and inspections are the warehouse's business, so they are
// left out rather than given a vague line.
const SCAN_TEXT = {
  CREATED: 'Labelled',
  RECEIVE: 'Received at warehouse',
  PHOTO_ADDED: 'Photographed',
  PUTAWAY: 'Put away in storage',
  DISPATCH: 'Dispatched to you',
};

const deliveryText = (r, status) => ({
  awaiting_payment: `Delivery booked, awaiting payment · ${r.ref}`,
  requested: `Delivery requested · ${r.ref}`,
  confirmed: `Delivery confirmed · ${r.ref}`,
  scheduled: `Delivery scheduled for ${r.date} · ${r.ref}`,
  in_progress: `On its way to you · ${r.ref}`,
  completed: `Delivered to you · ${r.ref}`,
  cancelled: `Delivery cancelled · ${r.ref}`,
}[status]);

async function itemHistory(item) {
  const [events, pickups, requests] = await Promise.all([
    ScanEvent.find({ objectId: item._id, eventType: { $in: Object.keys(SCAN_TEXT) } }).select('eventType timestamp').lean(),
    WarehouseJob.find({ customer: item.customer, type: 'PICKUP', status: 'COMPLETED', containers: item._id }).select('completedAt updatedAt').lean(),
    ServiceRequest.find({ customer: item.customer, items: item._id }).select('ref date statusLog').lean(),
  ]);
  const history = [
    ...events.map((e) => ({ at: e.timestamp, text: SCAN_TEXT[e.eventType] })),
    ...pickups.map((j) => ({ at: j.completedAt || j.updatedAt, text: 'Collected' })),
    ...requests.flatMap((r) => r.statusLog.map((s) => ({ at: s.at, text: deliveryText(r, s.status) }))),
  ];
  return history.sort((a, b) => new Date(b.at) - new Date(a.at));
}

// A delivered item has left our care for good, so the list is what we still
// hold; ?include=delivered adds those back (shown as 'out').
router.get('/items', wrap(async (req, res) => {
  const customerId = req.customer.customerId;
  const filter = { customer: customerId, ...(req.query.include === 'delivered' ? {} : { currentStatus: { $ne: 'DISPATCHED' } }) };
  const [items, deliveries] = await Promise.all([
    StoredContainer.find(filter).sort({ createdAt: -1 }).limit(1000).lean(),
    deliveriesFor(customerId),
  ]);
  res.json(items.map((c) => itemView(c, deliveries)));
}));

router.get('/items/:id', wrap(async (req, res) => {
  const item = await ownedItem(req, req.params.id);
  const [deliveries, history] = await Promise.all([deliveriesFor(req.customer.customerId), itemHistory(item)]);
  res.json({ ...itemView(item, deliveries), history });
}));

const sendPhoto = (res, photo) => {
  if (!photo) notFound('Photo');
  res.set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff').type(photo.mimeType)
    .send(photo.data.buffer ? Buffer.from(photo.data.buffer) : photo.data);
};

// The newest photo only: the one staff took last shows the item as it is now.
// Also reachable by a document link (?dt=), so an <Image> can load it.
router.get('/items/:id/photo', wrap(async (req, res) => {
  const item = await ownedItem(req, req.params.id);
  sendPhoto(res, await ItemPhoto.findOne({ container: item._id }).sort({ createdAt: -1 }).select('+data mimeType').lean());
}));

// Every photo, newest first; ids only, each fetched by the route below (which
// a document link can open too).
router.get('/items/:id/photos', wrap(async (req, res) => {
  const item = await ownedItem(req, req.params.id);
  const photos = await ItemPhoto.find({ container: item._id }).sort({ createdAt: -1 }).select('createdAt').lean();
  res.json(photos.map((p) => ({ id: p._id, at: p.createdAt })));
}));

router.get('/items/:id/photos/:photoId', wrap(async (req, res) => {
  const item = await ownedItem(req, req.params.id);
  sendPhoto(res, await ItemPhoto.findOne({ _id: String(req.params.photoId), container: item._id }).select('+data mimeType').lean());
}));

// ── Addresses ───────────────────────────────────────────────────────────────
const addressView = (a) => ({ id: a._id, label: a.label, line: a.line });

function cleanAddress(input, { defaultLabel = '' } = {}) {
  const label = String(input?.label ?? '').replace(/\s+/g, ' ').trim() || defaultLabel;
  const line = String(input?.line ?? '').replace(/\s+/g, ' ').trim();
  if (label.length < 1 || label.length > 40) fail('Give the address a name of up to 40 characters');
  if (line.length < 5 || line.length > 300) fail('Enter the full address (5 to 300 characters)');
  return { label, line };
}

router.get('/addresses', wrap(async (req, res) => {
  const customer = await Customer.findById(req.customer.customerId).select('savedAddresses').lean();
  res.json((customer?.savedAddresses || []).map(addressView));
}));

router.post('/addresses', wrap(async (req, res) => {
  const address = cleanAddress(req.body);
  // Conditional push, so two quick taps can't both slip under the cap.
  const updated = await Customer.findOneAndUpdate(
    { _id: req.customer.customerId, [`savedAddresses.${MAX_ADDRESSES - 1}`]: { $exists: false } },
    { $push: { savedAddresses: address } },
    { new: true, projection: { savedAddresses: 1 } },
  );
  if (!updated) fail(`You can save up to ${MAX_ADDRESSES} addresses`);
  res.status(201).json(addressView(updated.savedAddresses.at(-1)));
}));

// ── Availability ────────────────────────────────────────────────────────────
function checkDate(date) {
  if (!isDateString(date)) fail('Choose a date (YYYY-MM-DD)');
}

// Van slots are shared by every van job (supplies, pickups, drop-offs); the
// dump truck has slots of its own. Counted until cancelled: a completed job
// still used the vehicle that day. A delivery being paid for holds its slot
// while it has time to pay, and lets go of it after.
async function slotsOn(date, type) {
  const truck = type === 'disposal';
  const types = truck ? { $in: ['disposal'] } : { $nin: ['worker', 'disposal'] };
  const booked = await ServiceRequest.find({ date, type: types, status: { $ne: 'cancelled' }, ...notExpired() }).select('slot').lean();
  const capacity = truck ? CAPACITY.truckSlotCapacity : CAPACITY.slotCapacity;
  const count = (id) => booked.filter((r) => r.slot === id).length;
  return SLOTS.map((s) => ({ id: s.id, label: s.label, evening: s.evening, full: count(s.id) >= capacity }));
}

// Half an hour to two hours, in half hours.
function checkHours(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || !Number.isInteger(h / WORKER_HOURS.stepHours) || h < WORKER_HOURS.minHours || h > WORKER_HOURS.maxHours) {
    fail(`Choose from ${hoursLabel(WORKER_HOURS.minHours)} to ${hoursLabel(WORKER_HOURS.maxHours)} hours, in half hours`);
  }
  return h;
}

function checkWorkers(workers) {
  const n = Number(workers);
  if (!Number.isInteger(n) || n < 1 || n > WORKER_HOURS.maxWorkers) fail(`Choose 1 to ${WORKER_HOURS.maxWorkers} workers`);
  return n;
}

// A start is free if, at every half hour it covers, the workers already
// booked plus the ones asked for fit the shift — and it ends by closing.
// Bookings from before a count was asked had one worker.
async function workerStartsOn(date, hours, workers = 1) {
  const booked = (await ServiceRequest.find({ date, type: 'worker', status: { $ne: 'cancelled' } }).select('startTime hours workers').lean())
    .map((r) => [toMinutes(r.startTime), toMinutes(r.startTime) + r.hours * 60, r.workers || 1]);
  const step = WORKER_HOURS.stepMinutes;
  const closing = toMinutes(WORKER_HOURS.lastEnd);
  return workerStartTimes().map((time) => {
    const start = toMinutes(time);
    const end = start + hours * 60;
    let available = end <= closing;
    for (let m = start; available && m < end; m += step) {
      const busy = booked.filter(([s, e]) => s <= m && m < e).reduce((n, [, , w]) => n + w, 0);
      if (busy + workers > CAPACITY.workers) available = false;
    }
    return { time, available };
  });
}

router.get('/services/catalog', wrap(async (req, res) => {
  const customerId = req.customer.customerId;
  const [contract, active, itemCount] = await Promise.all([
    activeContract(customerId),
    valetActive(customerId),
    StoredContainer.countDocuments({ customer: customerId, currentStatus: { $ne: 'DISPATCHED' } }),
  ]);
  const facility = await facilityFor(contract);
  res.json({
    services: SERVICE_CATALOG,
    prices: { ...SERVICE_PRICES, ...CAPACITY },
    slots: SLOTS,
    worker: WORKER_HOURS,
    disposal: Object.entries(DISPOSAL_LOADS).map(([id, l]) => ({ id, ...l })),
    facility,
    valet: { active, itemCount },
  });
}));

router.get('/services/availability', wrap(async (req, res) => {
  const { type, date } = req.query;
  if (!SERVICE_TYPES.includes(type)) fail('Choose a service');
  checkDate(date);
  if (type === 'worker') {
    const hours = checkHours(req.query.hours ?? WORKER_HOURS.minHours);
    const workers = checkWorkers(req.query.workers ?? 1);
    const closed = workerClosed(date);
    // Closed days still list every start, all unavailable, so the picker has
    // the same shape to draw either way.
    const starts = (await workerStartsOn(date, hours, workers)).map((s) => (closed ? { ...s, available: false } : s));
    return res.json({ date, closed, starts });
  }
  res.json({ date, closed: false, slots: await slotsOn(date, type) });
}));

// ── Requests ────────────────────────────────────────────────────────────────
// Items are always expanded the same way, list or detail, so the app has one
// shape to draw. Deleted items still show, by label, on the jobs that moved them.
async function requestViews(customerId, requests) {
  const ids = [...new Set(requests.flatMap((r) => r.items.map(String)))];
  const [items, deliveries] = await Promise.all([
    ids.length ? StoredContainer.find({ _id: { $in: ids } }, null, { includeDeleted: true }).lean() : [],
    deliveriesFor(customerId),
  ]);
  const byId = new Map(items.map((c) => [String(c._id), c]));
  return requests.map((r) => requestView(r, (id) => {
    const c = byId.get(String(id));
    return c ? briefItemView(c, deliveries) : { id, label: null, name: 'Item', status: null };
  }));
}

function requestView(r, expandItem) {
  const slot = slotById(r.slot);
  return {
    id: r._id,
    ref: r.ref,
    type: r.type,
    status: r.status,
    date: r.date,
    slot: r.slot,
    slotLabel: slot?.label || null,
    startTime: r.startTime,
    hours: r.hours,
    workers: r.type === 'worker' ? r.workers || 1 : null,
    disposal: r.type === 'disposal' ? { load: r.disposal?.load, description: r.disposal?.description || '' } : null,
    endTime: r.startTime && r.hours ? workerEndTime(r.startTime, r.hours) : null,
    address: { label: r.address?.label || '', line: r.address?.line || '' },
    pickup: { boxes: r.pickup?.boxes || 0, bulky: r.pickup?.bulky || 0, description: r.pickup?.description || '' },
    supplies: { boxes: r.supplies?.boxes || 0, extraLabels: r.supplies?.extraLabels || 0 },
    items: r.items.map(expandItem),
    job: r.job,
    notes: r.notes,
    estimate: { lines: (r.estimate?.lines || []).map((l) => ({ label: l.label, amount: l.amount })), total: r.estimate?.total || 0 },
    charged: r.charged ?? null,
    payment: paymentView(r.payment),
    statusLog: r.statusLog.map((s) => ({ status: s.status, at: s.at })),
    driver: r.driverName ? { name: r.driverName, phone: r.driverPhone || '' } : null,
    createdAt: r.createdAt,
  };
}

async function ownedRequest(req, id) {
  if (!/^[a-f\d]{24}$/i.test(String(id))) notFound('Request');
  const r = await ServiceRequest.findOne({ _id: id, customer: req.customer.customerId });
  if (!r) notFound('Request');
  return r;
}

function count(v, min, max, what) {
  const n = v === undefined || v === null || v === '' ? 0 : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(`${what} must be a whole number from ${min} to ${max}`);
  return n;
}

function freeText(v, max, what) {
  if (v != null && typeof v !== 'string') fail(`${what} must be text`);
  const s = String(v ?? '').trim();
  if (s.length > max) fail(`${what} must be at most ${max} characters`);
  return s;
}

// A saved address by id, or a new one typed in — saved for next time while
// there's room, unless the same line is already on file.
async function addressFor(customerId, body) {
  const customer = await Customer.findById(customerId).select('savedAddresses');
  if (body.addressId) {
    const saved = customer?.savedAddresses.id(String(body.addressId));
    if (!saved) fail('Choose one of your saved addresses');
    return { label: saved.label, line: saved.line };
  }
  if (!body.address) fail('Choose or enter the address');
  const address = cleanAddress(body.address, { defaultLabel: 'Address' });
  const known = customer.savedAddresses.some((a) => a.line.toLowerCase() === address.line.toLowerCase());
  if (!known && customer.savedAddresses.length < MAX_ADDRESSES) {
    customer.savedAddresses.push(address);
    await customer.save();
  }
  return address;
}

// Only items sitting in the warehouse, and not already on another delivery,
// can be sent for.
async function deliverableItems(customerId, ids) {
  if (!Array.isArray(ids) || !ids.length) fail('Choose the items to deliver');
  const unique = [...new Set(ids.map(String))];
  if (unique.length > 500) fail('Choose at most 500 items');
  const [items, deliveries] = await Promise.all([
    StoredContainer.find({ _id: { $in: unique }, customer: customerId }).select('_id currentStatus').lean(),
    deliveriesFor(customerId),
  ]);
  if (items.length !== unique.length) fail('Some of those items are not in your storage');
  if (items.some((c) => !IN_WAREHOUSE.includes(c.currentStatus) || deliveries.has(String(c._id)))) {
    fail('Some of those items are not in storage right now or are already on a delivery');
  }
  return unique;
}

router.post('/services', wrap(async (req, res) => {
  const customerId = req.customer.customerId;
  const body = req.body || {};
  const { type, date } = body;
  if (!SERVICE_TYPES.includes(type)) fail('Choose a service');
  checkDate(date);
  const today = dubaiToday();
  if (date <= today || date > addDays(today, BOOK_AHEAD_DAYS)) fail(`Choose a date from tomorrow up to ${BOOK_AHEAD_DAYS} days ahead`);

  const notes = freeText(body.notes, 1000, 'Notes');
  const contract = await activeContract(customerId);
  const doc = { customer: customerId, contract: contract?._id || null, type, date, notes };

  if (type === 'worker') {
    // The worker helps at the customer's unit, so there has to be one.
    if (!contract) fail('Renting a worker is for customers with an active unit', 403);
    if (workerClosed(date)) fail('Workers are not available on Sundays');
    const hours = checkHours(body.hours);
    const workers = checkWorkers(body.workers ?? 1);
    const start = (await workerStartsOn(date, hours, workers)).find((s) => s.time === body.startTime);
    if (!start) fail('Choose a start time');
    if (!start.available) fail('That start time is no longer available — choose another');
    const job = freeText(body.job, 1000, 'Job description');
    if (job.length < 3) fail('Tell us what the worker should help with');
    Object.assign(doc, { startTime: body.startTime, hours, workers, job, address: await facilityFor(contract) });
    doc.estimate = estimateFor(type, { hours, workers });
  } else {
    const slot = slotById(body.slot);
    if (!slot) fail('Choose a time slot');
    if ((await slotsOn(date, type)).find((s) => s.id === slot.id).full) fail('That time slot is full — choose another');
    if (type === 'pickup' || type === 'both') {
      const boxes = count(body.pickup?.boxes, 0, 200, 'Boxes');
      const bulky = count(body.pickup?.bulky, 0, 200, 'Furniture & bulky items');
      if (boxes + bulky < 1) fail('Tell us how many boxes or bulky items to collect');
      doc.pickup = { boxes, bulky, description: freeText(body.pickup?.description, 1000, 'Description') };
    }
    if (DELIVERS.includes(type)) {
      if (!(await valetActive(customerId))) fail('Delivery is for customers with items in our storage', 403);
      doc.items = await deliverableItems(customerId, body.items);
    }
    if (type === 'supplies') {
      doc.supplies = { boxes: count(body.supplies?.boxes, 1, 200, 'Boxes'), extraLabels: count(body.supplies?.extraLabels, 0, 200, 'Extra labels') };
    }
    if (type === 'disposal') {
      if (!DISPOSAL_LOADS[body.disposal?.load]) fail('Choose how big the load is');
      const description = freeText(body.disposal?.description, 1000, 'Description');
      if (description.length < 3) fail('Tell us what we are taking away');
      doc.disposal = { load: body.disposal.load, description };
    }
    // Last, so a request that fails validation doesn't save a new address. A
    // dump truck can also clear the customer's own unit.
    if (type === 'disposal' && body.fromUnit === true) {
      if (!contract) fail('You have no active unit to clear', 403);
      doc.address = await facilityFor(contract);
    } else {
      doc.address = await addressFor(customerId, body);
    }
    Object.assign(doc, { slot: slot.id });
    doc.estimate = estimateFor(type, {
      boxes: doc.pickup?.boxes, bulky: doc.pickup?.bulky, items: doc.items?.length,
      supplyBoxes: doc.supplies?.boxes, evening: slot.evening, load: doc.disposal?.load,
    });
  }

  doc.ref = await nextServiceRequestNo();
  // A delivery is paid by card as it is booked. Until Stripe confirms that it
  // only holds its slot and items, and the contract hears of it once paid.
  const paying = DELIVERS.includes(type);
  const now = new Date();
  doc.status = paying ? 'awaiting_payment' : 'requested';
  doc.statusLog = [{ status: doc.status, at: now }];
  if (paying) {
    doc.payment = { required: true, state: 'pending', amount: doc.estimate.total, cardFee: 0, expiresAt: new Date(now.getTime() + PAY_WINDOW_MINUTES * 60_000) };
  }
  const created = await ServiceRequest.create(doc);
  if (contract && !paying) {
    contract.timeline.push({ text: `Tenant requested via app: ${describeRequest(created)}`, author: 'customer app' });
    await contract.save();
  }
  const [request] = await requestViews(customerId, [created.toObject()]);
  res.status(201).json({ request });
}));

router.get('/services', wrap(async (req, res) => {
  const requests = await ServiceRequest.find({ customer: req.customer.customerId }).sort({ createdAt: -1 }).limit(200).lean();
  res.json(await requestViews(req.customer.customerId, await expireStale(requests)));
}));

router.get('/services/:id', wrap(async (req, res) => {
  const r = await ownedRequest(req, req.params.id);
  await expireStale([r]);
  const [view] = await requestViews(req.customer.customerId, [r.toObject()]);
  res.json(view);
}));

// ── Paying for a delivery ───────────────────────────────────────────────────
const PAID_MEANWHILE = 'Your payment went through — we are confirming your request';
const round2 = (n) => Math.round(n * 100) / 100;

async function payableRequest(req) {
  if (!stripeConfigured()) fail('Online payment is not available right now', 503);
  const r = await ownedRequest(req, req.params.id);
  await expireStale([r]);
  if (r.payment?.state === 'paid') fail('This delivery is already paid', 409);
  if (r.status !== 'awaiting_payment' || r.payment?.state !== 'pending') fail('This booking has expired. Please request the delivery again.', 410);
  return r;
}

// Only one way to pay may be open at a time: close the earlier Checkout
// session or payment sheet, and stop if it was paid first.
async function closeOpenPayment(r) {
  const p = r.payment;
  if (p.stripeCheckoutSessionId && (await expireCheckoutSession(p.stripeCheckoutSessionId)) === 'complete') fail(PAID_MEANWHILE, 409);
  if (p.stripePaymentIntentId && ['succeeded', 'processing'].includes(await cancelPaymentIntent(p.stripePaymentIntentId))) fail(PAID_MEANWHILE, 409);
  p.stripeCheckoutSessionId = null;
  p.stripePaymentIntentId = null;
}

const payTitle = (r) => `${r.type === 'both' ? 'Pickup & delivery' : 'Delivery from storage'} ${r.ref}`;

// Same shape as paying for a unit (customerBooking.js): the app gets a card
// form, Stripe's webhook confirms the payment, the app never says it was paid.
router.post('/services/:id/pay', wrap(async (req, res) => {
  const r = await payableRequest(req);
  const embedded = req.body?.embedded === true && stripeEmbeddedConfigured();
  await closeOpenPayment(r);
  // The booking flow's public "go back to the app" page, worded for a delivery
  // (this router sits behind the customer login, so it can't serve one itself).
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const done = `${proto}://${req.headers['x-forwarded-host'] || req.get('host')}${req.baseUrl.replace(/\/storage$/, '/booking')}/done?for=delivery`;
  const session = await createCheckoutSession({
    amountAed: r.payment.amount,
    productName: payTitle(r),
    description: describeRequest(r),
    metadata: { serviceRequestId: String(r._id), serviceRef: r.ref },
    successUrl: done,
    cancelUrl: `${done}&cancelled=1`,
    feePct: CARD_FEE_PCT,
    expiresInMinutes: 30,
    embedded,
  });
  r.payment.stripeCheckoutSessionId = session.id;
  r.payment.cardFee = session.feeAmount;
  r.payment.expiresAt = new Date(Date.now() + PAYING_WINDOW_MINUTES * 60_000);
  await r.save();
  res.json({
    ...(embedded ? { clientSecret: session.clientSecret, publishableKey: stripePublishableKey() } : { url: session.url }),
    amount: r.payment.amount, cardFee: session.feeAmount, totalCharged: round2(r.payment.amount + session.feeAmount),
  });
}));

// The native payment sheet; 404 until STRIPE_PAYMENT_SHEET=true, like the booking's.
router.post('/services/:id/pay-sheet', wrap(async (req, res) => {
  if (!stripeSheetEnabled()) fail('Payment sheet is not available', 404);
  const r = await payableRequest(req);
  await closeOpenPayment(r);
  const customer = await Customer.findById(req.customer.customerId);
  const stripeCustomerId = await ensureStripeCustomer(customer);
  const sheet = await createSheetPayment({
    amountAed: r.payment.amount, feePct: CARD_FEE_PCT, stripeCustomerId,
    description: `${payTitle(r)} — ${describeRequest(r)}`,
    metadata: { serviceRequestId: String(r._id), serviceRef: r.ref, purpleboxCustomerId: String(customer._id) },
  });
  r.payment.stripePaymentIntentId = sheet.id;
  r.payment.cardFee = sheet.feeAmount;
  r.payment.expiresAt = new Date(Date.now() + PAYING_WINDOW_MINUTES * 60_000);
  await r.save();
  res.json({
    paymentIntentClientSecret: sheet.clientSecret, publishableKey: stripePublishableKey(), merchantDisplayName: 'PurpleBox Storage',
    customerId: stripeCustomerId, customerSessionClientSecret: sheet.customerSessionClientSecret,
    amount: r.payment.amount, cardFee: sheet.feeAmount, totalCharged: round2(r.payment.amount + sheet.feeAmount),
  });
}));

// Once the van is on its way, cancelling is a phone call, not a button. An
// unpaid delivery just lapses; a paid one is refunded in full, card fee too —
// and if the refund fails it stays booked, so no money goes unaccounted for.
router.post('/services/:id/cancel', wrap(async (req, res) => {
  const r = await ownedRequest(req, req.params.id);
  const at = new Date();
  if (paymentExpired(r, at)) {
    await expireStale([r], at); // already lapsed: that is the cancellation
  } else if (r.status === 'awaiting_payment') {
    await closeOpenPayment(r);
    const entry = { status: 'cancelled', at };
    // Conditional, in case the webhook marked it paid a moment ago.
    const { modifiedCount } = await ServiceRequest.updateOne(
      { _id: r._id, status: 'awaiting_payment', 'payment.state': 'pending' },
      { $set: { status: 'cancelled', 'payment.state': 'expired', 'payment.stripeCheckoutSessionId': null, 'payment.stripePaymentIntentId': null }, $push: { statusLog: entry } },
    );
    if (!modifiedCount) fail(PAID_MEANWHILE, 409);
    r.status = 'cancelled';
    r.payment.state = 'expired';
    r.statusLog.push(entry);
  } else {
    if (!CANCELLABLE.includes(r.status)) fail('This request can no longer be cancelled', 409);
    if (r.payment?.state === 'paid') {
      try {
        const refund = await refundPayment({ paymentIntentId: r.payment.stripePaymentIntentId, checkoutSessionId: r.payment.stripeCheckoutSessionId });
        r.payment.state = 'refunded';
        r.payment.refundId = refund.id;
      } catch (e) {
        console.error('[customerValet] refund failed for', r.ref, e.message);
        fail('We could not refund your payment automatically — please message us', 502);
      }
    }
    r.status = 'cancelled';
    r.statusLog.push({ status: 'cancelled', at });
    await r.save();
  }
  // An unpaid delivery never reached the contract's timeline, so neither does its end.
  if (r.contract && (!r.payment || r.payment.state === 'refunded')) {
    const refunded = r.payment?.state === 'refunded' ? ' (card payment refunded)' : '';
    await Contract.updateOne({ _id: r.contract }, { $push: { timeline: { text: `Tenant cancelled via app: ${r.ref}${refunded}`, author: 'customer app' } } });
  }
  const [request] = await requestViews(req.customer.customerId, [r.toObject()]);
  res.json({ request });
}));

export default router;
