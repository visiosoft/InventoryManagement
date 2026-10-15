import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Contract, Counter, Customer, CustomerOtp, Site, Unit, User } from '../src/models/index.js';
import { StoredContainer, ScanEvent, ItemPhoto } from '../src/models/warehouse.js';
import { ServiceRequest } from '../src/models/serviceRequest.js';
import { addDays, dubaiToday, weekday } from '../src/services/servicePricing.js';
import customerAuthRouter from '../src/routes/customerAuth.js';
import customerStorageRouter from '../src/routes/customerStorage.js';
import serviceRequestRouter from '../src/routes/serviceRequests.js';

let mongod, app, site, staff, outsider;
const base = '/api/customer-portal/storage';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const models = [Contract, Counter, Customer, CustomerOtp, Site, Unit, User, StoredContainer, ScanEvent, ItemPhoto, ServiceRequest];

// The first day from tomorrow that matches — so a test never lands on a
// Sunday (or misses one) depending on when it runs.
const firstDay = (match) => { let d = addDays(dubaiToday(), 1); while (!match(weekday(d))) d = addDays(d, 1); return d; };
const workday = () => firstDay((w) => w !== 0);
const sunday = () => firstDay((w) => w === 0);

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret';
  delete process.env.WHATSAPP_OTP_TEMPLATE;
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'service_requests_test' });
  await Promise.all(models.map((m) => m.init()));
  app = express();
  app.use(express.json());
  app.use('/api/customer-auth', customerAuthRouter);
  app.use(base, customerStorageRouter);
  app.use('/api/service-requests', (req, _res, next) => { req.user = req.headers['x-test-user'] ? { id: req.headers['x-test-user'] } : undefined; next(); }, serviceRequestRouter);
}, { timeout: 240000 });

after(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  // Scan events refuse deletes through the model by design; the raw
  // collection is the only way to start each test clean.
  await Promise.all(models.map((m) => m.collection.deleteMany({})));
  site = await Site.create({ name: 'Al Quoz', address: 'Warehouse 12, Al Quoz 2', isDefault: true });
  staff = await User.create({ name: 'Ops', email: 'ops@test.invalid', passwordHash: 'x', role: 'staff', permissions: ['warehouse'] });
  outsider = await User.create({ name: 'Sales', email: 'sales@test.invalid', passwordHash: 'x', role: 'staff' });
});

async function login(phone) {
  const otp = await request(app).post('/api/customer-auth/request-otp').send({ phone });
  const res = await request(app).post('/api/customer-auth/verify-otp').send({ phone, code: otp.body.code });
  assert.equal(res.status, 200);
  return { Authorization: `Bearer ${res.body.token}` };
}

async function seedTenant(phone, unitNumber = 'L-114') {
  const customer = await Customer.create({ fullName: `Tenant ${phone}`, phone, phones: [phone], stage: 'customer' });
  const unit = await Unit.create({ unitNumber, sizeSqf: 100, site: site._id });
  const contract = await Contract.create({
    contractNo: `C-${phone.slice(-4)}`, customer: customer._id, unit: unit._id, billingPeriod: 'monthly', rate: 1000,
    startDate: new Date(Date.now() - 40 * 86_400_000), endDate: new Date(Date.now() + 200 * 86_400_000), status: 'active',
  });
  return { customer, unit, contract, auth: await login(phone) };
}

let codeSeq = 0;
async function item(customer, input = {}) {
  codeSeq += 1;
  return StoredContainer.create({
    displayCode: `PBX-T${String(codeSeq).padStart(4, '0')}`, type: 'BOX', customer: customer._id, site: site._id, warehouse: 'WH1',
    currentStatus: 'IN_STORAGE', currentLocation: 'SECRET-SHELF-B12', storedAt: new Date(), ...input,
  });
}

const scanEvent = (c, eventType, extra = {}) => ScanEvent.create({
  requestId: randomUUID(), requestHash: 'h', barcode: c.displayCode, objectType: c.type, objectId: c._id, eventType,
  customer: c.customer, site: c.site, employee: staff._id, currentLocation: 'SECRET-SHELF-B12', notes: 'SECRET NOTE', ...extra,
});

const book = (auth, body) => request(app).post(`${base}/services`).set(auth).send(body);
const address = { label: 'Home', line: 'Villa 7, Street 12, Jumeirah 1' };

test('catalog: services, prices, slots, worker hours and the facility of my unit', async () => {
  const t = await seedTenant('+971501000001');
  const r = await request(app).get(`${base}/services/catalog`).set(t.auth);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.services.map((s) => s.type), ['supplies', 'pickup', 'dropoff', 'both', 'worker', 'disposal']);
  assert.deepEqual(r.body.services.map((s) => s.from), [50, 250, 250, 450, 50, 400]);
  assert.equal(r.body.services[4].sub, 'Help at your unit · AED 50/hour per worker, up to 2 hours');
  assert.deepEqual(r.body.disposal.map((l) => [l.id, l.price]), [['small', 400], ['large', 800]]);
  assert.equal(r.body.prices.pickup, 250);
  assert.equal(r.body.prices.slotCapacity, 3);
  assert.equal(r.body.slots.length, 6);
  assert.deepEqual(r.body.slots.at(-1), { id: '18-20', label: '18:00 – 20:00', evening: true });
  assert.deepEqual(r.body.worker, {
    firstStart: '08:00', lastEnd: '20:00', stepMinutes: 30, closedWeekdays: [0], minHours: 0.5, maxHours: 2, stepHours: 0.5, maxWorkers: 2,
  });
  assert.deepEqual(r.body.facility, { label: 'At my unit', line: 'Unit L-114 · Warehouse 12, Al Quoz 2' });

  const visitor = await login('+971501000002');
  const none = await request(app).get(`${base}/services/catalog`).set(visitor);
  assert.equal(none.body.facility.line, 'PurpleBox Storage, Al Quoz 2');
});

test('availability: a slot fills at capacity; workers are closed on Sunday and must end by 20:00', async () => {
  const t = await seedTenant('+971501000003');
  const day = workday();
  assert.equal((await request(app).get(`${base}/services/availability?type=pickup&date=soon`).set(t.auth)).status, 400);
  assert.equal((await request(app).get(`${base}/services/availability?type=teleport&date=${day}`).set(t.auth)).status, 400);

  for (let i = 0; i < 3; i += 1) {
    await ServiceRequest.create({ customer: t.customer._id, ref: `SR-X${i}`, type: 'pickup', date: day, slot: '10-12' });
  }
  await ServiceRequest.create({ customer: t.customer._id, ref: 'SR-XC', type: 'pickup', date: day, slot: '12-14', status: 'cancelled' });
  const slots = await request(app).get(`${base}/services/availability?type=dropoff&date=${day}`).set(t.auth);
  assert.equal(slots.status, 200);
  assert.equal(slots.body.closed, false);
  assert.equal(slots.body.slots.find((s) => s.id === '10-12').full, true);
  assert.equal(slots.body.slots.find((s) => s.id === '12-14').full, false, 'cancelled requests free the slot');

  const sun = await request(app).get(`${base}/services/availability?type=worker&date=${sunday()}&hours=1`).set(t.auth);
  assert.equal(sun.body.closed, true);
  assert.ok(sun.body.starts.every((s) => !s.available));

  const w = await request(app).get(`${base}/services/availability?type=worker&date=${day}&hours=1.5`).set(t.auth);
  const at = (time) => w.body.starts.find((s) => s.time === time);
  assert.equal(w.body.starts[0].time, '08:00');
  assert.equal(w.body.starts.at(-1).time, '19:30');
  assert.equal(at('18:30').available, true, '18:30 + 1.5h ends at 20:00');
  assert.equal(at('19:00').available, false, 'would end after closing');
  assert.equal((await request(app).get(`${base}/services/availability?type=worker&date=${day}&hours=2.5`).set(t.auth)).status, 400, 'over 2 hours');
  assert.equal((await request(app).get(`${base}/services/availability?type=worker&date=${day}&hours=1&workers=3`).set(t.auth)).status, 400, 'only two workers');

  // Two workers already on 09:00–11:00: nothing overlapping that is free.
  for (const ref of ['SR-W1', 'SR-W2']) {
    await ServiceRequest.create({ customer: t.customer._id, ref, type: 'worker', date: day, startTime: '09:00', hours: 2 });
  }
  const busy = await request(app).get(`${base}/services/availability?type=worker&date=${day}&hours=1`).set(t.auth);
  const b = (time) => busy.body.starts.find((s) => s.time === time).available;
  assert.deepEqual([b('08:00'), b('08:30'), b('10:30'), b('11:00')], [true, false, false, true]);

  // One booking for both workers fills the time just the same; one worker
  // booked leaves room for one more, not two.
  await ServiceRequest.create({ customer: t.customer._id, ref: 'SR-W3', type: 'worker', date: day, startTime: '14:00', hours: 1, workers: 2 });
  await ServiceRequest.create({ customer: t.customer._id, ref: 'SR-W4', type: 'worker', date: day, startTime: '16:00', hours: 1, workers: 1 });
  const one = await request(app).get(`${base}/services/availability?type=worker&date=${day}&hours=0.5&workers=1`).set(t.auth);
  const two = await request(app).get(`${base}/services/availability?type=worker&date=${day}&hours=0.5&workers=2`).set(t.auth);
  const o = (time) => one.body.starts.find((s) => s.time === time).available;
  const tw = (time) => two.body.starts.find((s) => s.time === time).available;
  assert.deepEqual([o('14:00'), o('16:00'), tw('16:00'), tw('17:00')], [false, true, false, true]);

  // The dump truck has its own slots: full vans don't block it.
  const truck = await request(app).get(`${base}/services/availability?type=disposal&date=${day}`).set(t.auth);
  assert.equal(truck.body.slots.find((s) => s.id === '10-12').full, false);
  await ServiceRequest.create({ customer: t.customer._id, ref: 'SR-T1', type: 'disposal', date: day, slot: '12-14' });
  const truck2 = await request(app).get(`${base}/services/availability?type=disposal&date=${day}`).set(t.auth);
  assert.equal(truck2.body.slots.find((s) => s.id === '12-14').full, true, 'one truck per slot');
  const vans = await request(app).get(`${base}/services/availability?type=pickup&date=${day}`).set(t.auth);
  assert.equal(vans.body.slots.find((s) => s.id === '12-14').full, false, 'a truck booking does not take a van');
});

test('create: each type is priced on the server, exactly', async () => {
  const t = await seedTenant('+971501000004');
  const day = workday();
  const [a, b] = [await item(t.customer), await item(t.customer)];

  const pickup = await book(t.auth, { type: 'pickup', date: day, slot: '18-20', address, pickup: { boxes: 5, bulky: 2, description: 'Sofa' } });
  assert.equal(pickup.status, 201, JSON.stringify(pickup.body));
  assert.deepEqual(pickup.body.request.estimate.lines, [
    { label: 'Service fee', amount: 250 }, { label: 'Boxes × 5', amount: 50 },
    { label: 'Furniture & bulky × 2', amount: 80 }, { label: 'Evening slot', amount: 50 },
  ]);
  assert.equal(pickup.body.request.estimate.total, 430);
  assert.equal(pickup.body.request.ref, 'SR-0001');
  assert.equal(pickup.body.request.slotLabel, '18:00 – 20:00');
  assert.deepEqual(pickup.body.request.statusLog.map((s) => s.status), ['requested']);

  const saved = await request(app).get(`${base}/addresses`).set(t.auth);
  assert.deepEqual(saved.body.map((x) => x.line), [address.line], 'a new address is saved for next time');
  const addressId = saved.body[0].id;

  const dropoff = await book(t.auth, { type: 'dropoff', date: day, slot: '08-10', addressId, items: [a._id, b._id] });
  assert.equal(dropoff.status, 201, JSON.stringify(dropoff.body));
  assert.equal(dropoff.body.request.estimate.total, 250 + 60);
  assert.deepEqual(dropoff.body.request.items.map((i) => i.label), [a.displayCode, b.displayCode]);
  assert.equal(dropoff.body.request.address.label, 'Home');

  const c = await item(t.customer);
  const both = await book(t.auth, { type: 'both', date: day, slot: '10-12', addressId, items: [c._id], pickup: { boxes: 3, bulky: 0 } });
  assert.equal(both.status, 201, JSON.stringify(both.body));
  assert.deepEqual(both.body.request.estimate.lines.map((l) => l.label), ['Service fee', 'Boxes × 3', 'Delivered items × 1']);
  assert.equal(both.body.request.estimate.total, 450 + 30 + 30);

  const supplies = await book(t.auth, { type: 'supplies', date: day, slot: '12-14', addressId, supplies: { boxes: 20, extraLabels: 10 } });
  assert.equal(supplies.status, 201, JSON.stringify(supplies.body));
  assert.deepEqual(supplies.body.request.estimate, { lines: [{ label: 'Boxes & labels × 20', amount: 200 }, { label: 'Delivery', amount: 50 }], total: 250 });

  const worker = await book(t.auth, { type: 'worker', date: day, startTime: '09:30', hours: 1.5, workers: 2, job: 'Rearrange shelves' });
  assert.equal(worker.status, 201, JSON.stringify(worker.body));
  assert.deepEqual(worker.body.request.estimate, { lines: [{ label: '2 workers · 1.5 h × AED 50', amount: 150 }], total: 150 });
  assert.equal(worker.body.request.endTime, '11:00');
  assert.equal(worker.body.request.workers, 2);
  assert.deepEqual(worker.body.request.address, { label: 'At my unit', line: 'Unit L-114 · Warehouse 12, Al Quoz 2' });

  const solo = await book(t.auth, { type: 'worker', date: day, startTime: '15:00', hours: 0.5, job: 'Lift one box' });
  assert.equal(solo.status, 201, JSON.stringify(solo.body));
  assert.deepEqual(solo.body.request.estimate, { lines: [{ label: 'Worker · 0.5 h × AED 50', amount: 25 }], total: 25 });
  assert.equal(solo.body.request.workers, 1, 'one worker unless asked');

  const truck = await book(t.auth, { type: 'disposal', date: day, slot: '18-20', addressId, disposal: { load: 'large', description: 'Old sofa and a broken fridge' } });
  assert.equal(truck.status, 201, JSON.stringify(truck.body));
  assert.deepEqual(truck.body.request.estimate, { lines: [{ label: 'Dump truck · Full truck', amount: 800 }, { label: 'Evening slot', amount: 50 }], total: 850 });
  assert.deepEqual(truck.body.request.disposal, { load: 'large', description: 'Old sofa and a broken fridge' });
  const fromUnit = await book(t.auth, { type: 'disposal', date: day, slot: '08-10', fromUnit: true, disposal: { load: 'small', description: 'Empty boxes' } });
  assert.equal(fromUnit.status, 201, JSON.stringify(fromUnit.body));
  assert.deepEqual(fromUnit.body.request.address, { label: 'At my unit', line: 'Unit L-114 · Warehouse 12, Al Quoz 2' });

  const contract = await Contract.findById(t.contract._id);
  assert.equal(contract.timeline.filter((e) => e.text.startsWith('Tenant requested via app:')).length, 8);
  assert.ok(contract.timeline.some((e) => e.text.includes('SR-0001')));
  assert.ok(contract.timeline.some((e) => e.text.includes('09:30–11:00, 2 workers')));

  const list = await request(app).get(`${base}/services`).set(t.auth);
  assert.deepEqual(list.body.map((r) => r.type), ['disposal', 'disposal', 'worker', 'worker', 'supplies', 'both', 'dropoff', 'pickup']);
});

test('create: refuses what it cannot book, with a reason', async () => {
  const t = await seedTenant('+971501000005');
  const day = workday();
  const good = { type: 'pickup', date: day, slot: '08-10', address, pickup: { boxes: 1 } };
  for (const [bad, why] of [
    [{ ...good, type: 'teleport' }, 'type'],
    [{ ...good, date: dubaiToday() }, 'today'],
    [{ ...good, date: addDays(dubaiToday(), 61) }, 'too far'],
    [{ ...good, date: '2026-02-30' }, 'not a day'],
    [{ ...good, slot: '20-22' }, 'slot'],
    [{ ...good, pickup: { boxes: 0, bulky: 0 } }, 'nothing to collect'],
    [{ ...good, pickup: { boxes: 201 } }, 'too many boxes'],
    [{ ...good, pickup: { boxes: 1.5 } }, 'fraction'],
    [{ ...good, address: undefined }, 'no address'],
    [{ ...good, address: { label: 'Home', line: 'x' } }, 'short address'],
    [{ ...good, address: undefined, addressId: new mongoose.Types.ObjectId().toString() }, 'unknown saved address'],
    [{ ...good, notes: 'x'.repeat(1001) }, 'long notes'],
    [{ type: 'dropoff', date: day, slot: '08-10', address, items: [] }, 'no items'],
    [{ type: 'supplies', date: day, slot: '08-10', address, supplies: { boxes: 0 } }, 'no boxes'],
    [{ type: 'worker', date: day, startTime: '09:00', hours: 1, job: 'ok' }, 'short job'],
    [{ type: 'worker', date: day, startTime: '19:30', hours: 2, job: 'Help me' }, 'ends after 20:00'],
    [{ type: 'worker', date: day, startTime: '09:15', hours: 1, job: 'Help me' }, 'off the half hour'],
    [{ type: 'worker', date: day, startTime: '09:00', hours: 2.5, job: 'Help me' }, 'over two hours'],
    [{ type: 'worker', date: day, startTime: '09:00', hours: 0.75, job: 'Help me' }, 'not a half hour'],
    [{ type: 'worker', date: day, startTime: '09:00', hours: 1, workers: 3, job: 'Help me' }, 'only two workers'],
    [{ type: 'worker', date: day, startTime: '09:00', hours: 1, workers: 0, job: 'Help me' }, 'no workers'],
    [{ type: 'disposal', date: day, slot: '08-10', address, disposal: { load: 'huge', description: 'Sofa' } }, 'unknown load'],
    [{ type: 'disposal', date: day, slot: '08-10', address, disposal: { load: 'small', description: 'x' } }, 'no description'],
    [{ type: 'worker', date: sunday(), startTime: '09:00', hours: 1, job: 'Help me' }, 'Sunday'],
  ]) {
    const r = await book(t.auth, bad);
    assert.equal(r.status, 400, `${why}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.error, why);
  }
  assert.equal(await ServiceRequest.countDocuments(), 0);
  assert.equal((await Customer.findById(t.customer._id)).savedAddresses.length, 0, 'a refused request saves no address');

  // A slot at capacity is refused.
  for (let i = 0; i < 3; i += 1) await ServiceRequest.create({ customer: t.customer._id, ref: `SR-F${i}`, type: 'supplies', date: day, slot: '08-10' });
  assert.equal((await book(t.auth, good)).status, 400);

  // No unit, no worker.
  const visitor = await login('+971501000006');
  const r = await book(visitor, { type: 'worker', date: day, startTime: '09:00', hours: 1, job: 'Help me' });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'Renting a worker is for customers with an active unit');
});

test('dropoff: someone else’s item, or one not in storage, is refused', async () => {
  const t = await seedTenant('+971501000007');
  const other = await seedTenant('+971501000008', 'L-200');
  const theirs = await item(other.customer);
  const expected = await item(t.customer, { currentStatus: 'CREATED', currentLocation: null, storedAt: null });
  const body = (items) => ({ type: 'dropoff', date: workday(), slot: '08-10', address, items });
  assert.equal((await book(t.auth, body([theirs._id]))).status, 400);
  assert.equal((await book(t.auth, body([expected._id]))).status, 400);
  assert.equal((await book(t.auth, body(['not-an-id']))).status, 400);
  assert.equal(await ServiceRequest.countDocuments(), 0);
});

test('items: scheduled once on a delivery, transit when under way, stored again after cancel', async () => {
  const t = await seedTenant('+971501000009');
  const box = await item(t.customer, { description: 'Winter clothes', length: 60, width: 40, height: 40, weight: 12, photoCount: 1 });
  const status = async () => (await request(app).get(`${base}/items`).set(t.auth)).body.find((i) => i.id === box._id).status;
  assert.equal(await status(), 'stored');

  const r = await book(t.auth, { type: 'dropoff', date: workday(), slot: '08-10', address, items: [box._id] });
  assert.equal(await status(), 'scheduled');
  const again = await book(t.auth, { type: 'dropoff', date: workday(), slot: '10-12', address, items: [box._id] });
  assert.equal(again.status, 400, 'already on a delivery');

  await ServiceRequest.updateOne({ _id: r.body.request.id }, { status: 'in_progress' });
  assert.equal(await status(), 'transit');
  await ServiceRequest.updateOne({ _id: r.body.request.id }, { status: 'scheduled' });

  const cancel = await request(app).post(`${base}/services/${r.body.request.id}/cancel`).set(t.auth);
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.request.status, 'cancelled');
  assert.deepEqual(cancel.body.request.statusLog.map((s) => s.status), ['requested', 'cancelled']);
  assert.equal(await status(), 'stored');

  const detail = await request(app).get(`${base}/items/${box._id}`).set(t.auth);
  assert.ok(detail.body.history.some((h) => h.text.startsWith('Delivery requested · SR-')));
  assert.ok(detail.body.history.some((h) => h.text.startsWith('Delivery cancelled · SR-')));
});

test('cancel: only before the job is under way, and only your own request', async () => {
  const t = await seedTenant('+971501000010');
  const other = await seedTenant('+971501000011', 'L-201');
  const r = await book(t.auth, { type: 'supplies', date: workday(), slot: '08-10', address, supplies: { boxes: 5 } });
  const id = r.body.request.id;

  assert.equal((await request(app).get(`${base}/services/${id}`).set(other.auth)).status, 404);
  assert.equal((await request(app).post(`${base}/services/${id}/cancel`).set(other.auth)).status, 404);
  assert.equal((await request(app).get(`${base}/services/not-an-id`).set(t.auth)).status, 404);
  assert.deepEqual((await request(app).get(`${base}/services`).set(other.auth)).body, []);

  await ServiceRequest.updateOne({ _id: id }, { status: 'in_progress' });
  const late = await request(app).post(`${base}/services/${id}/cancel`).set(t.auth);
  assert.equal(late.status, 409);
  assert.equal(late.body.error, 'This request can no longer be cancelled');
});

test('staff: list with filters, move a request along, then it is final', async () => {
  const t = await seedTenant('+971501000012');
  const r = await book(t.auth, { type: 'pickup', date: workday(), slot: '08-10', address, pickup: { boxes: 2 } });
  const id = r.body.request.id;
  const staffReq = (method, path, user = staff) => request(app)[method](`/api/service-requests${path}`).set('x-test-user', String(user._id));

  assert.equal((await request(app).get('/api/service-requests')).status, 401);
  assert.equal((await staffReq('get', '/', outsider)).status, 403);
  const list = await staffReq('get', '/?status=requested&type=pickup');
  assert.equal(list.status, 200);
  assert.equal(list.body[0].customer.fullName, 'Tenant +971501000012');
  assert.equal((await staffReq('get', '/?type=dropoff')).body.length, 0);
  assert.equal((await staffReq('get', '/?status=lost')).status, 400);

  const scheduled = await staffReq('patch', `/${id}`).send({ status: 'scheduled', driverName: 'Ali', driverPhone: '+971500000099', staffNote: 'GATE CODE 1234' });
  assert.equal(scheduled.status, 200);
  assert.deepEqual(scheduled.body.statusLog.map((s) => s.status), ['requested', 'scheduled']);
  assert.equal((await staffReq('patch', `/${id}`).send({ status: 'flying' })).status, 400);
  assert.equal((await staffReq('patch', `/${id}`).send({ charged: -5 })).status, 400);

  const done = await staffReq('patch', `/${id}`).send({ status: 'completed', charged: 270 });
  assert.equal(done.body.status, 'completed');
  assert.equal(done.body.charged, 270);
  assert.equal((await staffReq('patch', `/${id}`).send({ status: 'requested' })).status, 409);
  assert.equal((await staffReq('patch', `/${id}`).send({ charged: 260 })).status, 200, 'the charge can still be corrected');

  // The customer sees the driver and the charge, never the staff note.
  const mine = await request(app).get(`${base}/services/${id}`).set(t.auth);
  assert.deepEqual(mine.body.driver, { name: 'Ali', phone: '+971500000099' });
  assert.equal(mine.body.charged, 260);
  assert.deepEqual(mine.body.statusLog.map((s) => s.status), ['requested', 'scheduled', 'completed']);
  const raw = JSON.stringify(mine.body);
  for (const secret of ['GATE CODE', 'staffNote', 'warehouseJob']) assert.ok(!raw.includes(secret), `leaked ${secret}`);
});

test('items: views and history never leak warehouse internals; photos only for the owner', async () => {
  const t = await seedTenant('+971501000013');
  const other = await seedTenant('+971501000014', 'L-202');
  const box = await item(t.customer, { type: 'DOCUMENT_BOX', contents: 'Tax files', photoCount: 1 });
  const theirs = await item(other.customer);
  await scanEvent(box, 'CREATED');
  await scanEvent(box, 'RECEIVE');
  await scanEvent(box, 'RELOCATE');
  await scanEvent(box, 'PUTAWAY');
  await ItemPhoto.create({ container: box._id, data: png, mimeType: 'image/png', employee: staff._id });

  const list = await request(app).get(`${base}/items`).set(t.auth);
  assert.deepEqual(list.body.map((i) => i.id), [box._id]);
  assert.equal(list.body[0].name, 'Document box');
  assert.equal(list.body[0].hasPhoto, true);
  assert.equal(list.body[0].dims, null);

  const detail = await request(app).get(`${base}/items/${box._id}`).set(t.auth);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.history.map((h) => h.text).sort(), ['Labelled', 'Put away in storage', 'Received at warehouse']);
  const raw = JSON.stringify([list.body, detail.body]);
  for (const secret of ['SECRET-SHELF', 'SECRET NOTE', String(staff._id), 'employee', 'currentLocation', 'lastScanBy', '"site"', '"warehouse"']) {
    assert.ok(!raw.includes(secret), `leaked ${secret}`);
  }

  assert.equal((await request(app).get(`${base}/items/${theirs._id}`).set(t.auth)).status, 404);
  assert.equal((await request(app).get(`${base}/items/${theirs._id}/photo`).set(t.auth)).status, 404);
  const photo = await request(app).get(`${base}/items/${box._id}/photo`).set(t.auth);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers['content-type'], 'image/png');
  assert.equal(Buffer.compare(photo.body, png), 0);

  // A document link opens the photo without a header, and nothing else.
  const href = `/customer-portal/storage/items/${box._id}/photo`;
  const link = await request(app).post('/api/customer-auth/document-link').set(t.auth).send({ href });
  assert.equal(link.status, 200);
  assert.equal((await request(app).get(`/api${href}?dt=${link.body.token}`)).status, 200);
  assert.equal((await request(app).get(`${base}/items/${box._id}?dt=${link.body.token}`)).status, 401);
});

test('addresses: validated, listed, and capped at ten', async () => {
  const t = await seedTenant('+971501000015');
  assert.equal((await request(app).post(`${base}/addresses`).set(t.auth).send({ label: '', line: address.line })).status, 400);
  assert.equal((await request(app).post(`${base}/addresses`).set(t.auth).send({ label: 'x'.repeat(41), line: address.line })).status, 400);
  assert.equal((await request(app).post(`${base}/addresses`).set(t.auth).send({ label: 'Home', line: 'abc' })).status, 400);
  for (let i = 0; i < 10; i += 1) {
    const r = await request(app).post(`${base}/addresses`).set(t.auth).send({ label: `Place ${i}`, line: `Building ${i}, Dubai Marina` });
    assert.equal(r.status, 201);
    assert.deepEqual(Object.keys(r.body).sort(), ['id', 'label', 'line']);
  }
  assert.equal((await request(app).post(`${base}/addresses`).set(t.auth).send({ label: 'Eleventh', line: 'Building 11, Dubai Marina' })).status, 400);
  const list = await request(app).get(`${base}/addresses`).set(t.auth);
  assert.equal(list.body.length, 10);
  assert.equal(list.body[0].label, 'Place 0');
});
