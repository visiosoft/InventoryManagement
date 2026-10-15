import { before, after, beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import Stripe from 'stripe';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Contract, Counter, Customer, CustomerOtp, Invoice, Payment, Site, Unit, User } from '../src/models/index.js';
import { ServiceRequest } from '../src/models/serviceRequest.js';
import { CustomerNotification } from '../src/models/customerNotification.js';
import { setExpoSender } from '../src/services/expoPush.js';
import { dayLabel, notifyCustomer, runCustomerNotificationSweep } from '../src/services/customerNotify.js';
import { addDays, dubaiToday } from '../src/services/servicePricing.js';
import customerAuthRouter from '../src/routes/customerAuth.js';
import customerStorageRouter from '../src/routes/customerStorage.js';
import serviceRequestRouter from '../src/routes/serviceRequests.js';
import customerNotificationRouter from '../src/routes/customerNotifications.js';
import stripeWebhookRouter from '../src/routes/stripeWebhook.js';

let mongod, app, site, ops, marketer, outsider;
const base = '/api/customer-portal/storage';
const models = [Contract, Counter, Customer, CustomerOtp, Invoice, Payment, Site, Unit, User, ServiceRequest, CustomerNotification];
const WEBHOOK_SECRET = 'whsec_test_customer_notifications';

// Nothing reaches Expo: every chunk lands here, and a token with "dead" in it
// answers the way Expo does for an uninstalled app.
let sentChunks = [];
const fakeExpo = async (chunk) => {
  sentChunks.push(chunk);
  return chunk.map((m) => (m.to.includes('dead')
    ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
    : { status: 'ok', id: 'ticket' }));
};
const sentMessages = () => sentChunks.flat();
const token = (name) => `ExponentPushToken[${name}]`;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret';
  process.env.DISABLE_BACKGROUND_JOBS = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  delete process.env.EXPO_PUSH_DISABLED;
  delete process.env.WHATSAPP_OTP_TEMPLATE;
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'customer_notifications_test' });
  await Promise.all(models.map((m) => m.init()));
  app = express();
  // The webhook needs the exact bytes Stripe signed, as index.js keeps them.
  app.use(express.json({ verify: (req, _res, buf) => { if (req.originalUrl.includes('/api/stripe/webhook')) req.rawBody = Buffer.from(buf); } }));
  app.use('/api/customer-auth', customerAuthRouter);
  app.use(base, customerStorageRouter);
  const asStaff = (req, _res, next) => { req.user = req.headers['x-test-user'] ? { id: req.headers['x-test-user'] } : undefined; next(); };
  app.use('/api/service-requests', asStaff, serviceRequestRouter);
  app.use('/api/customer-notifications', asStaff, customerNotificationRouter);
  app.use('/api/stripe/webhook', stripeWebhookRouter);
}, { timeout: 240000 });

after(async () => {
  setExpoSender(null);
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all(models.map((m) => m.collection.deleteMany({})));
  sentChunks = [];
  setExpoSender(fakeExpo);
  site = await Site.create({ name: 'Al Quoz', address: 'Warehouse 12, Al Quoz 2', isDefault: true });
  ops = await User.create({ name: 'Ops', email: 'ops@test.invalid', passwordHash: 'x', role: 'staff', permissions: ['warehouse'] });
  marketer = await User.create({ name: 'Marketing', email: 'mkt@test.invalid', passwordHash: 'x', role: 'staff', permissions: ['campaign_studio'] });
  outsider = await User.create({ name: 'Sales', email: 'sales@test.invalid', passwordHash: 'x', role: 'staff' });
});

afterEach(() => { delete process.env.EXPO_PUSH_DISABLED; });

async function login(phone) {
  const otp = await request(app).post('/api/customer-auth/request-otp').send({ phone });
  const res = await request(app).post('/api/customer-auth/verify-otp').send({ phone, code: otp.body.code });
  assert.equal(res.status, 200);
  return { Authorization: `Bearer ${res.body.token}` };
}

let unitSeq = 0;
async function contractFor(customer, { endDate, status = 'active', contractNo } = {}) {
  unitSeq += 1;
  const unit = await Unit.create({ unitNumber: `L-${100 + unitSeq}`, sizeSqf: 100, site: site._id });
  return Contract.create({
    contractNo: contractNo || `C-${1000 + unitSeq}`, customer: customer._id, unit: unit._id, billingPeriod: 'monthly', rate: 1000,
    startDate: new Date(Date.now() - 300 * 86_400_000), endDate: endDate || new Date(Date.now() + 200 * 86_400_000), status,
  });
}

async function seedTenant(phone, extra = {}) {
  const customer = await Customer.create({ fullName: `Tenant ${phone}`, phone, phones: [phone], stage: 'customer', ...extra });
  const contract = await contractFor(customer);
  return { customer, contract, auth: await login(phone) };
}

const inbox = (auth) => request(app).get(`${base}/notifications`).set(auth);
// A Dubai calendar day as the Date a form would store: its local midnight.
const dubaiMidnight = (day) => new Date(`${day}T00:00:00+04:00`);

// ── Push tokens ─────────────────────────────────────────────────────────────
test('push token: validated, idempotent, moved between customers, removed on sign-out', async () => {
  const a = await seedTenant('+971502000001');
  const b = await seedTenant('+971502000002');
  const t = token('phone-1');

  assert.equal((await request(app).post('/api/customer-auth/push-token').send({ token: t })).status, 401);
  assert.equal((await request(app).post('/api/customer-auth/push-token').set(a.auth).send({ token: 'not-a-token' })).status, 400);

  for (let i = 0; i < 2; i += 1) {
    const r = await request(app).post('/api/customer-auth/push-token').set(a.auth).send({ token: t, platform: 'ios' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
  }
  assert.deepEqual((await Customer.findById(a.customer._id).lean()).pushTokens, [t]);

  // The same phone signs in as somebody else: it belongs to them now.
  await request(app).post('/api/customer-auth/push-token').set(b.auth).send({ token: t, platform: 'android' });
  assert.deepEqual((await Customer.findById(a.customer._id).lean()).pushTokens, []);
  assert.deepEqual((await Customer.findById(b.customer._id).lean()).pushTokens, [t]);

  const del = await request(app).delete('/api/customer-auth/push-token').set(b.auth).send({ token: t });
  assert.deepEqual(del.body, { ok: true });
  assert.deepEqual((await Customer.findById(b.customer._id).lean()).pushTokens, []);
});

// ── Inbox & prefs ───────────────────────────────────────────────────────────
test('inbox: newest first, read one or all, and only ever my own', async () => {
  const a = await seedTenant('+971502000011');
  const b = await seedTenant('+971502000012');
  await notifyCustomer(a.customer._id, { kind: 'payment', title: 'First', body: 'one', data: { route: '/(tabs)/payments' }, key: 'k1' });
  await notifyCustomer(a.customer._id, { kind: 'service', title: 'Second', body: 'two', data: { route: '/service/[id]', params: { id: 'abc' } } });
  await notifyCustomer(b.customer._id, { kind: 'payment', title: 'Theirs', body: 'b', data: { route: '/(tabs)/payments' } });

  const list = await inbox(a.auth);
  assert.equal(list.status, 200);
  assert.equal(list.body.unread, 2);
  assert.deepEqual(list.body.items.map((n) => n.title), ['Second', 'First']);
  assert.deepEqual(Object.keys(list.body.items[0]).sort(), ['body', 'createdAt', 'data', 'id', 'kind', 'read', 'title']);
  assert.deepEqual(list.body.items[0].data, { route: '/service/[id]', params: { id: 'abc' } });
  assert.deepEqual(list.body.items[1].data, { route: '/(tabs)/payments' });

  // Somebody else's id, and junk, are just not matched.
  const theirs = await CustomerNotification.findOne({ customer: b.customer._id });
  const one = await request(app).post(`${base}/notifications/read`).set(a.auth).send({ ids: [list.body.items[1].id, String(theirs._id), 'junk'] });
  assert.deepEqual(one.body, { unread: 1 });
  assert.equal((await CustomerNotification.findById(theirs._id)).readAt, null);
  assert.equal((await inbox(a.auth)).body.items.find((n) => n.title === 'First').read, true);

  assert.equal((await request(app).post(`${base}/notifications/read`).set(a.auth).send({})).status, 400);
  const all = await request(app).post(`${base}/notifications/read`).set(a.auth).send({ all: true });
  assert.deepEqual(all.body, { unread: 0 });
  assert.equal((await inbox(b.auth)).body.unread, 1);
});

test('prefs: promotions on by default, switchable, validated', async () => {
  const a = await seedTenant('+971502000021');
  assert.deepEqual((await request(app).get(`${base}/notification-prefs`).set(a.auth)).body, { promotions: true });
  assert.equal((await request(app).patch(`${base}/notification-prefs`).set(a.auth).send({ promotions: 'no' })).status, 400);
  const off = await request(app).patch(`${base}/notification-prefs`).set(a.auth).send({ promotions: false });
  assert.deepEqual(off.body, { promotions: false });
  assert.deepEqual((await request(app).get(`${base}/notification-prefs`).set(a.auth)).body, { promotions: false });
});

// ── notifyCustomer ──────────────────────────────────────────────────────────
test('notifyCustomer: pushes with the route, once per key, prunes dead tokens, honours the promotion opt-out', async () => {
  const c = await Customer.create({ fullName: 'Pushy', phone: '+971502000031', pushTokens: [token('live'), token('dead-one')] });
  const msg = { kind: 'service', title: 'Pickup confirmed', body: 'SR-0001', data: { route: '/service/[id]', params: { id: 'x1' } }, key: 'service:x1:confirmed' };

  const first = await notifyCustomer(c._id, msg);
  assert.deepEqual(first, { created: true, sent: 1 });
  const note = await CustomerNotification.findOne({ customer: c._id });
  const pushed = sentMessages();
  assert.equal(pushed.length, 2);
  assert.deepEqual(pushed[0].data, { notificationId: String(note._id), route: '/service/[id]', params: { id: 'x1' }, kind: 'service' });
  assert.equal(pushed[0].channelId, 'default');
  assert.equal(pushed[0].badge, 1);
  assert.deepEqual((await Customer.findById(c._id).lean()).pushTokens, [token('live')]);

  assert.deepEqual(await notifyCustomer(c._id, msg), { created: false, sent: 0 });
  assert.equal(await CustomerNotification.countDocuments({ customer: c._id }), 1);

  await Customer.updateOne({ _id: c._id }, { $set: { 'notificationPrefs.promotions': false } });
  assert.deepEqual(await notifyCustomer(c._id, { kind: 'promotion', title: 'Sale', body: '20% off', data: { route: '/(tabs)' } }), { created: false, sent: 0 });
  assert.equal(await CustomerNotification.countDocuments({ customer: c._id, kind: 'promotion' }), 0);

  // Switched off: still in the inbox, nothing sent. A customer we can't find is a no-op.
  process.env.EXPO_PUSH_DISABLED = 'true';
  sentChunks = [];
  assert.deepEqual(await notifyCustomer(c._id, { kind: 'payment', title: 'Paid', data: { route: '/(tabs)/payments' } }), { created: true, sent: 0 });
  assert.equal(sentChunks.length, 0);
  assert.deepEqual(await notifyCustomer(new mongoose.Types.ObjectId(), { kind: 'payment', title: 'x' }), { created: false, sent: 0 });
});

// ── Service requests ────────────────────────────────────────────────────────
test('service status: staff moving a booking along notifies the customer, once per status', async () => {
  const t = await seedTenant('+971502000041');
  const date = addDays(dubaiToday(), 3);
  const pickup = await ServiceRequest.create({ customer: t.customer._id, ref: 'SR-0003', type: 'pickup', date, slot: '10-12', statusLog: [{ status: 'requested' }] });
  const worker = await ServiceRequest.create({ customer: t.customer._id, ref: 'SR-0004', type: 'worker', date, startTime: '10:00', hours: 1.5, workers: 1, statusLog: [{ status: 'requested' }] });
  const patch = (r, body, user = ops) => request(app).patch(`/api/service-requests/${r._id}`).set('x-test-user', String(user._id)).send(body);

  assert.equal((await patch(pickup, { status: 'confirmed' }, outsider)).status, 403);
  assert.equal(await CustomerNotification.countDocuments(), 0);

  assert.equal((await patch(pickup, { status: 'confirmed' })).status, 200);
  await patch(pickup, { staffNote: 'gate code 1234' }); // not a status change
  await patch(pickup, { status: 'scheduled' });
  await patch(pickup, { status: 'confirmed' }); // back again: already told
  await patch(pickup, { status: 'in_progress' });
  await patch(worker, { status: 'completed' });

  const items = (await inbox(t.auth)).body.items;
  assert.deepEqual(items.map((n) => n.title), ['Worker booking completed', 'Pickup van on its way', 'Pickup scheduled', 'Pickup confirmed']);
  assert.equal(items.at(-1).body, `SR-0003 · ${dayLabel(date)}, 10:00 – 12:00`);
  assert.equal(items[0].body, `SR-0004 · ${dayLabel(date)}, 10:00 – 11:30`);
  assert.deepEqual(items.at(-1).data, { route: '/service/[id]', params: { id: String(pickup._id) } });
  assert.ok(items.every((n) => n.kind === 'service'));
  assert.ok(!JSON.stringify(items).includes('gate code'));
});

// ── Payment received ────────────────────────────────────────────────────────
test('payment received: the Stripe webhook paying a storage invoice tells the customer once', async () => {
  const t = await seedTenant('+971502000051');
  const invoice = await Invoice.create({ invoiceNo: 'INV-000123', customer: t.customer._id, dueDate: new Date(), total: 1305, status: 'sent' });
  const deliver = (sessionId) => {
    const payload = JSON.stringify({
      id: `evt_${sessionId}`, object: 'event', type: 'checkout.session.completed',
      data: { object: { id: sessionId, object: 'checkout.session', amount_total: 130500, metadata: { storageInvoiceId: String(invoice._id), amountFils: '130500' } } },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    return request(app).post('/api/stripe/webhook').set('stripe-signature', header).set('Content-Type', 'application/json').send(payload);
  };

  assert.equal((await deliver('cs_test_1')).status, 200);
  assert.equal((await deliver('cs_test_1')).status, 200); // Stripe retries
  assert.equal((await Invoice.findById(invoice._id)).status, 'paid');

  const items = (await inbox(t.auth)).body.items;
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].kind, items[0].title, items[0].body], ['payment', 'Payment received', 'AED 1,305 for INV-000123. Thank you!']);
  assert.deepEqual(items[0].data, { route: '/(tabs)/payments' });
});

// ── Daily sweep ─────────────────────────────────────────────────────────────
test('sweep: payment due soon, today and overdue, each once; nothing for paid or long-overdue invoices', async () => {
  const t = await seedTenant('+971502000061');
  const at = (day) => new Date(`${day}T10:00:00+04:00`);
  const due = await Invoice.create({ invoiceNo: 'INV-1', customer: t.customer._id, dueDate: dubaiMidnight('2026-10-23'), total: 1305, paymentMade: 300, status: 'partial' });
  await Invoice.create({ invoiceNo: 'INV-PAID', customer: t.customer._id, dueDate: dubaiMidnight('2026-10-23'), total: 500, paymentMade: 500, status: 'paid' });
  await Invoice.create({ invoiceNo: 'INV-SETTLED', customer: t.customer._id, dueDate: dubaiMidnight('2026-10-23'), total: 500, paymentMade: 500, status: 'sent' });
  await Invoice.create({ invoiceNo: 'INV-DRAFT', customer: t.customer._id, dueDate: dubaiMidnight('2026-10-23'), total: 500, status: 'draft' });
  await Invoice.create({ invoiceNo: 'INV-ANCIENT', customer: t.customer._id, dueDate: dubaiMidnight('2026-01-10'), total: 500, status: 'overdue' });

  const runs = [];
  for (const day of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-21', '2026-10-23', '2026-10-24', '2026-10-25']) {
    runs.push((await runCustomerNotificationSweep({ now: at(day) })).due);
  }
  // 4 days out: nothing; 3 days: soon; 2 days: already sent; due day: today; next day: overdue; after: already sent.
  assert.deepEqual(runs, [0, 1, 0, 0, 1, 1, 0]);

  const items = (await inbox(t.auth)).body.items;
  assert.deepEqual(items.map((n) => n.title), ['Payment overdue', 'Payment due today', 'Payment due on Fri 23 Oct']);
  assert.equal(items[2].body, 'AED 1,005 for INV-1. You can pay in the app in a few taps.');
  assert.equal(items[0].body, 'AED 1,005 for INV-1 was due on Fri 23 Oct. Please pay in the app, or talk to us if something\'s wrong.');
  assert.ok(items.every((n) => n.kind === 'payment' && n.data.route === '/(tabs)/payments'));
  assert.deepEqual((await CustomerNotification.find().lean()).map((n) => n.key).sort(), ['soon', 'today', 'overdue'].map((s) => `due:${due._id}:${s}`).sort());
});

test('sweep: renewal at 30, 14 and 7 days, each once; nothing for ended contracts; a renewed contract starts again', async () => {
  const customer = await Customer.create({ fullName: 'Renewer', phone: '+971502000071', pushTokens: [token('renewer')] });
  const at = (day) => new Date(`${day}T10:00:00+04:00`);
  const contract = await contractFor(customer, { endDate: dubaiMidnight('2026-11-19') });
  await contractFor(customer, { endDate: dubaiMidnight('2026-11-19'), status: 'ended' });
  // 20 days left on the first run: between milestones, so it waits for 14.
  const later = await contractFor(customer, { endDate: dubaiMidnight('2026-11-09') });

  const runs = [];
  for (const day of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-26', '2026-11-05', '2026-11-06', '2026-11-12', '2026-11-18']) {
    runs.push((await runCustomerNotificationSweep({ now: at(day) })).renewal);
  }
  // 10-19: 31 days → none. 10-20: 30 → one. 10-26: later has 14 → one.
  // 11-05: contract 14 + later 4 (7-day milestone) → two. 11-12: 7 → one.
  assert.deepEqual(runs, [0, 1, 0, 1, 2, 0, 1, 0]);

  const notes = await CustomerNotification.find({ kind: 'renewal' }).sort({ createdAt: 1, _id: 1 }).lean();
  assert.equal(notes[0].title, 'Your agreement ends on Thu 19 Nov');
  assert.deepEqual(notes[0].data, { route: '/checkout' });
  assert.match(notes[0].body, /Renew in the app/);
  assert.deepEqual(notes.filter((n) => String(n.key).includes(String(contract._id))).map((n) => n.key.split(':').at(-1)), ['30', '14', '7']);
  assert.deepEqual(notes.filter((n) => String(n.key).includes(String(later._id))).map((n) => n.key.split(':').at(-1)), ['14', '7']);
  assert.equal(sentMessages().length, 5);

  // Renewed for a year: the same contract, a new end, its reminders again.
  await Contract.updateOne({ _id: contract._id }, { $set: { endDate: dubaiMidnight('2027-11-19') } });
  assert.equal((await runCustomerNotificationSweep({ now: at('2027-10-20') })).renewal, 1);
});

// ── Promotions ──────────────────────────────────────────────────────────────
test('broadcast: tenants or app users, opt-outs skipped, Campaign Studio permission required', async () => {
  const tenant = await seedTenant('+971502000081');
  await Customer.updateOne({ _id: tenant.customer._id }, { $set: { pushTokens: [token('tenant')] } });
  const optedOut = await seedTenant('+971502000082');
  await Customer.updateOne({ _id: optedOut.customer._id }, { $set: { 'notificationPrefs.promotions': false } });
  const appUser = await login('+971502000083'); // signed in, no contract, no token
  await Customer.create({ fullName: 'Never used the app', phone: '+971502000084' });
  const ended = await Customer.create({ fullName: 'Former tenant', phone: '+971502000085' });
  await contractFor(ended, { status: 'ended' });

  const send = (body, user = marketer) => request(app).post('/api/customer-notifications/broadcast').set('x-test-user', String(user._id)).send(body);
  const promo = { title: 'Ramadan offer', body: '20% off a second unit this month.' };

  assert.equal((await send({ ...promo, audience: 'tenants' }, outsider)).status, 403);
  assert.equal((await send({ ...promo, audience: 'tenants' }, ops)).status, 403);
  assert.equal((await send({ ...promo, title: 'Hi', audience: 'tenants' })).status, 400);
  assert.equal((await send({ ...promo, audience: 'everyone' })).status, 400);
  assert.equal(await CustomerNotification.countDocuments(), 0);

  const tenants = await send({ ...promo, audience: 'tenants' });
  assert.equal(tenants.status, 200);
  assert.deepEqual(tenants.body, { recipients: 1, sent: 1 });

  const all = await send({ ...promo, audience: 'all' });
  assert.deepEqual(all.body, { recipients: 2, sent: 1 });
  const appInbox = (await inbox(appUser)).body.items;
  assert.equal(appInbox.length, 1);
  assert.deepEqual([appInbox[0].kind, appInbox[0].title, appInbox[0].data.route], ['promotion', 'Ramadan offer', '/(tabs)']);
  assert.equal((await inbox(optedOut.auth)).body.items.length, 0);

  const admin = await User.create({ name: 'Boss', email: 'boss@test.invalid', passwordHash: 'x', role: 'admin' });
  assert.equal((await send({ ...promo, audience: 'tenants' }, admin)).status, 200);
});

// ── Inspections ─────────────────────────────────────────────────────────────
test('inspection: finds the contract by number, notifies the tenant, notes the timeline', async () => {
  const t = await seedTenant('+971502000091');
  await Customer.updateOne({ _id: t.customer._id }, { $set: { pushTokens: [token('inspect')] } });
  const date = addDays(dubaiToday(), 5);
  const post = (body, user = ops) => request(app).post('/api/customer-notifications/inspection').set('x-test-user', String(user._id)).send(body);

  const found = await request(app).get('/api/customer-notifications/contracts?q=' + t.contract.contractNo).set('x-test-user', String(ops._id));
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.map((c) => [c.id, c.customerName, c.units.length]), [[String(t.contract._id), t.customer.fullName, 1]]);

  assert.equal((await post({ contractId: String(t.contract._id), date }, marketer)).status, 403);
  assert.equal((await post({ contractId: String(t.contract._id), date: '2020-01-01' })).status, 400);
  assert.equal((await post({ contractId: String(t.contract._id), date, time: '25:00' })).status, 400);
  assert.equal((await post({ contractId: String(new mongoose.Types.ObjectId()), date })).status, 404);

  const r = await post({ contractId: String(t.contract._id), date, time: '10:30', note: 'Please make sure the corridor is clear.' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, sent: 1 });

  const [n] = (await inbox(t.auth)).body.items;
  const unit = (await Unit.findById(t.contract.unit)).unitNumber;
  assert.equal(n.kind, 'inspection');
  assert.equal(n.title, `Unit inspection on ${dayLabel(date)}`);
  assert.equal(n.body, `Our team will inspect unit ${unit} on ${dayLabel(date)} at 10:30. Please make sure the corridor is clear.`);
  assert.deepEqual(n.data, { route: '/(tabs)/storage' });

  const timeline = (await Contract.findById(t.contract._id).lean()).timeline;
  assert.equal(timeline.at(-1).author, 'Ops');
  assert.match(timeline.at(-1).text, new RegExp(`^Unit inspection scheduled for ${dayLabel(date)} at 10:30 — tenant notified in the app`));
});

test('recent: last sent with customer name, filterable by kind, staff only', async () => {
  const t = await seedTenant('+971502000101');
  await notifyCustomer(t.customer._id, { kind: 'payment', title: 'Payment received', data: { route: '/(tabs)/payments' } });
  await notifyCustomer(t.customer._id, { kind: 'promotion', title: 'Offer', data: { route: '/(tabs)' } });
  const get = (q, user) => request(app).get(`/api/customer-notifications/recent${q}`).set('x-test-user', String(user._id));

  assert.equal((await get('', outsider)).status, 403);
  assert.equal((await get('?kind=spam', ops)).status, 400);
  const all = await get('', marketer);
  assert.deepEqual(all.body.map((n) => [n.title, n.customer.name]), [['Offer', t.customer.fullName], ['Payment received', t.customer.fullName]]);
  assert.ok(!('key' in all.body[0]));
  assert.deepEqual((await get('?kind=payment', ops)).body.map((n) => n.title), ['Payment received']);
});
