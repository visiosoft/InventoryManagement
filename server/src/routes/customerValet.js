import { Router } from 'express';
import { Contract, Customer, Site } from '../models/index.js';
import { StoredContainer, ScanEvent, ItemPhoto, WarehouseJob } from '../models/warehouse.js';
import { ServiceRequest, SERVICE_TYPES, nextServiceRequestNo } from '../models/serviceRequest.js';
import { requireCustomer } from './customerAuth.js';
import {
  SERVICE_PRICES, CAPACITY, SLOTS, WORKER_HOURS, SERVICE_CATALOG, slotById, estimateFor,
  workerStartTimes, workerEndTime, toMinutes, dubaiToday, addDays, isDateString, workerClosed,
} from '../services/servicePricing.js';

/**
 * Valet storage from the customer app: the things we hold for them, and the
 * jobs they book — boxes sent out, collections, deliveries back, a worker at
 * their unit. Mounted inside customerStorage.js, under the same login.
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
const CANCELLABLE = ['requested', 'confirmed', 'scheduled'];
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
// even before the warehouse scans it out.
async function deliveriesFor(customerId) {
  const open = await ServiceRequest.find({ customer: customerId, type: { $in: DELIVERS }, status: { $in: OPEN_STATUSES } })
    .select('items status').lean();
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

router.get('/items', wrap(async (req, res) => {
  const customerId = req.customer.customerId;
  const [items, deliveries] = await Promise.all([
    StoredContainer.find({ customer: customerId }).sort({ createdAt: -1 }).limit(1000).lean(),
    deliveriesFor(customerId),
  ]);
  res.json(items.map((c) => itemView(c, deliveries)));
}));

router.get('/items/:id', wrap(async (req, res) => {
  const item = await ownedItem(req, req.params.id);
  const [deliveries, history] = await Promise.all([deliveriesFor(req.customer.customerId), itemHistory(item)]);
  res.json({ ...itemView(item, deliveries), history });
}));

// The newest photo only: the one staff took last shows the item as it is now.
// Also reachable by a document link (?dt=), so an <Image> can load it.
router.get('/items/:id/photo', wrap(async (req, res) => {
  const item = await ownedItem(req, req.params.id);
  const photo = await ItemPhoto.findOne({ container: item._id }).sort({ createdAt: -1 }).select('+data mimeType').lean();
  if (!photo) notFound('Photo');
  res.set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff').type(photo.mimeType)
    .send(photo.data.buffer ? Buffer.from(photo.data.buffer) : photo.data);
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

// Slots are shared by every van job (supplies, pickups, drop-offs), counted
// until cancelled: a completed job still used the van that day.
async function slotsOn(date) {
  const booked = await ServiceRequest.find({ date, type: { $ne: 'worker' }, status: { $ne: 'cancelled' } }).select('slot').lean();
  const count = (id) => booked.filter((r) => r.slot === id).length;
  return SLOTS.map((s) => ({ id: s.id, label: s.label, evening: s.evening, full: count(s.id) >= CAPACITY.slotCapacity }));
}

function checkHours(hours) {
  const h = Number(hours);
  if (!Number.isInteger(h) || h < WORKER_HOURS.minHours || h > WORKER_HOURS.maxHours) {
    fail(`Choose between ${WORKER_HOURS.minHours} and ${WORKER_HOURS.maxHours} hours`);
  }
  return h;
}

// A start is free if, at every half hour it covers, fewer than `workers`
// other bookings are already on — and it ends by closing.
async function workerStartsOn(date, hours) {
  const booked = (await ServiceRequest.find({ date, type: 'worker', status: { $ne: 'cancelled' } }).select('startTime hours').lean())
    .map((r) => [toMinutes(r.startTime), toMinutes(r.startTime) + r.hours * 60]);
  const step = WORKER_HOURS.stepMinutes;
  const closing = toMinutes(WORKER_HOURS.lastEnd);
  return workerStartTimes().map((time) => {
    const start = toMinutes(time);
    const end = start + hours * 60;
    let available = end <= closing;
    for (let m = start; available && m < end; m += step) {
      if (booked.filter(([s, e]) => s <= m && m < e).length >= CAPACITY.workers) available = false;
    }
    return { time, available };
  });
}

router.get('/services/catalog', wrap(async (req, res) => {
  const facility = await facilityFor(await activeContract(req.customer.customerId));
  res.json({
    services: SERVICE_CATALOG,
    prices: { ...SERVICE_PRICES, ...CAPACITY },
    slots: SLOTS,
    worker: WORKER_HOURS,
    facility,
  });
}));

router.get('/services/availability', wrap(async (req, res) => {
  const { type, date } = req.query;
  if (!SERVICE_TYPES.includes(type)) fail('Choose a service');
  checkDate(date);
  if (type === 'worker') {
    const hours = checkHours(req.query.hours ?? WORKER_HOURS.minHours);
    const closed = workerClosed(date);
    // Closed days still list every start, all unavailable, so the picker has
    // the same shape to draw either way.
    const starts = (await workerStartsOn(date, hours)).map((s) => (closed ? { ...s, available: false } : s));
    return res.json({ date, closed, starts });
  }
  res.json({ date, closed: false, slots: await slotsOn(date) });
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
    endTime: r.startTime && r.hours ? workerEndTime(r.startTime, r.hours) : null,
    address: { label: r.address?.label || '', line: r.address?.line || '' },
    pickup: { boxes: r.pickup?.boxes || 0, bulky: r.pickup?.bulky || 0, description: r.pickup?.description || '' },
    supplies: { boxes: r.supplies?.boxes || 0, extraLabels: r.supplies?.extraLabels || 0 },
    items: r.items.map(expandItem),
    job: r.job,
    notes: r.notes,
    estimate: { lines: (r.estimate?.lines || []).map((l) => ({ label: l.label, amount: l.amount })), total: r.estimate?.total || 0 },
    charged: r.charged ?? null,
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

const describe = (r) => {
  const title = SERVICE_CATALOG.find((s) => s.type === r.type).title.toLowerCase();
  const when = r.type === 'worker' ? `${r.startTime}–${workerEndTime(r.startTime, r.hours)}` : slotById(r.slot).label;
  return `${title} ${r.ref} on ${r.date}, ${when} (est. AED ${r.estimate.total})`;
};

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
    const start = (await workerStartsOn(date, hours)).find((s) => s.time === body.startTime);
    if (!start) fail('Choose a start time');
    if (!start.available) fail('That start time is no longer available — choose another');
    const job = freeText(body.job, 1000, 'Job description');
    if (job.length < 3) fail('Tell us what the worker should help with');
    Object.assign(doc, { startTime: body.startTime, hours, job, address: await facilityFor(contract) });
    doc.estimate = estimateFor(type, { hours });
  } else {
    const slot = slotById(body.slot);
    if (!slot) fail('Choose a time slot');
    if ((await slotsOn(date)).find((s) => s.id === slot.id).full) fail('That time slot is full — choose another');
    if (type === 'pickup' || type === 'both') {
      const boxes = count(body.pickup?.boxes, 0, 200, 'Boxes');
      const bulky = count(body.pickup?.bulky, 0, 200, 'Furniture & bulky items');
      if (boxes + bulky < 1) fail('Tell us how many boxes or bulky items to collect');
      doc.pickup = { boxes, bulky, description: freeText(body.pickup?.description, 1000, 'Description') };
    }
    if (DELIVERS.includes(type)) doc.items = await deliverableItems(customerId, body.items);
    if (type === 'supplies') {
      doc.supplies = { boxes: count(body.supplies?.boxes, 1, 200, 'Boxes'), extraLabels: count(body.supplies?.extraLabels, 0, 200, 'Extra labels') };
    }
    // Last, so a request that fails validation doesn't save a new address.
    doc.address = await addressFor(customerId, body);
    Object.assign(doc, { slot: slot.id });
    doc.estimate = estimateFor(type, {
      boxes: doc.pickup?.boxes, bulky: doc.pickup?.bulky, items: doc.items?.length,
      supplyBoxes: doc.supplies?.boxes, evening: slot.evening,
    });
  }

  doc.ref = await nextServiceRequestNo();
  doc.statusLog = [{ status: 'requested', at: new Date() }];
  const created = await ServiceRequest.create(doc);
  if (contract) {
    contract.timeline.push({ text: `Tenant requested via app: ${describe(created)}`, author: 'customer app' });
    await contract.save();
  }
  const [request] = await requestViews(customerId, [created.toObject()]);
  res.status(201).json({ request });
}));

router.get('/services', wrap(async (req, res) => {
  const requests = await ServiceRequest.find({ customer: req.customer.customerId }).sort({ createdAt: -1 }).limit(200).lean();
  res.json(await requestViews(req.customer.customerId, requests));
}));

router.get('/services/:id', wrap(async (req, res) => {
  const r = await ownedRequest(req, req.params.id);
  const [view] = await requestViews(req.customer.customerId, [r.toObject()]);
  res.json(view);
}));

// Once the van is on its way, cancelling is a phone call, not a button.
router.post('/services/:id/cancel', wrap(async (req, res) => {
  const r = await ownedRequest(req, req.params.id);
  if (!CANCELLABLE.includes(r.status)) fail('This request can no longer be cancelled', 409);
  r.status = 'cancelled';
  r.statusLog.push({ status: 'cancelled', at: new Date() });
  await r.save();
  if (r.contract) {
    await Contract.updateOne({ _id: r.contract }, { $push: { timeline: { text: `Tenant cancelled via app: ${r.ref}`, author: 'customer app' } } });
  }
  const [request] = await requestViews(req.customer.customerId, [r.toObject()]);
  res.json({ request });
}));

export default router;
