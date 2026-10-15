import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Customer, Contract, Site, Unit, User } from '../src/models/index.js';
import { StoredContainer, WarehouseLocation, ScanEvent, ItemPhoto, WarehouseCounter, WarehouseJob } from '../src/models/warehouse.js';
import { command, createContainers, createLocation, editLocation, deleteLocation, editContainer, deleteContainer, scan, addPhoto, createWarehouseJob, updateWarehouseJob, getOrCreateJobLink, revokeJobLink, confirmJobPublicly } from '../src/services/warehouse.js';
import { validateMovement } from '../src/services/warehouseRules.js';
import warehouseRouter from '../src/routes/warehouse.js';

let replica, admin, staff, outsider, site, customer, otherCustomer, booking, unit, app;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const run = (actor, operation, input, fn) => command(actor, { requestId: randomUUID(), ...input }, operation, ctx => fn(ctx, input));
const location = (input = {}) => run(admin, 'CREATE_LOCATION', { site: String(site._id), warehouse: 'WH1', name: 'Shelf', kind: 'SHELF', ...input }, createLocation).then(r => r.location);
const containers = (input = {}) => run(staff, 'CREATE_CONTAINERS', { customer: String(customer._id), site: String(site._id), warehouse: 'WH1', type: 'BOX', quantity: 1, ...input }, createContainers).then(r => r.containers);
const scanItem = (item, action, destination, actor = staff, notes) => run(actor, 'SCAN', { barcode: item.displayCode, action, locationBarcode: destination?.displayCode, notes }, scan);
const photograph = item => run(staff, 'ADD_PHOTO', { container: item._id }, ctx => addPhoto(ctx, item._id, png));
const createJob = (input = {}) => run(staff, 'CREATE_JOB', { site: String(site._id), warehouse: 'WH1', customer: String(customer._id), address: '123 Main St', ...input }, createWarehouseJob).then(r => r.job);
const updateJob = (jobId, input = {}) => run(staff, 'UPDATE_JOB', input, (ctx, body) => updateWarehouseJob(ctx, jobId, body)).then(r => r.job);
async function readyItem(input = {}) {
  const [item] = await containers(input);
  const receiving = await location({ name: 'Receiving', kind: 'RECEIVING' });
  await scanItem(item, 'RECEIVE', receiving);
  await photograph(item);
  return item;
}

before(async () => {
  // Never reads .env or connects to an existing database.
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.14' } });
  await mongoose.connect(replica.getUri(), { dbName: 'warehouse_integration_test' });
  await Promise.all([User, Customer, Contract, Site, Unit, StoredContainer, WarehouseLocation, ScanEvent, ItemPhoto, WarehouseCounter].map(m => m.init()));
  admin = await User.create({ name: 'Supervisor', email: 'admin@test.invalid', passwordHash: 'test', role: 'admin' });
  staff = await User.create({ name: 'Warehouse employee', email: 'staff@test.invalid', passwordHash: 'test', role: 'staff', permissions: ['warehouse'] });
  outsider = await User.create({ name: 'Other employee', email: 'other@test.invalid', passwordHash: 'test', role: 'staff' });
  site = await Site.create({ name: 'Test facility', code: 'TEST', isDefault: true });
  customer = await Customer.create({ fullName: 'John Smith', clientId: 'TEST-JOHN', phone: '+971500000001', notes: 'PRIVATE NOTES', email: 'private@test.invalid' });
  otherCustomer = await Customer.create({ fullName: 'Another customer' });
  unit = await Unit.create({ unitNumber: 'TEST-UNIT', site: site._id });
  booking = await Contract.create({ contractNo: 'BK-10492', customer: customer._id, unit: unit._id, billingPeriod: 'monthly', rate: 1, startDate: new Date(), endDate: new Date(Date.now() + 86400000) });
  app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = req.headers['x-test-user'] ? { id: req.headers['x-test-user'] } : undefined; next(); });
  app.use('/warehouse', warehouseRouter);
}, { timeout: 240000 });

after(async () => { await mongoose.disconnect(); await replica?.stop(); });

test('five existing-customer boxes receive unique UUIDs/codes and complete inbound custody', async () => {
  const count = await Customer.countDocuments();
  const boxes = await containers({ quantity: 5, booking: String(booking._id), unit: String(unit._id) });
  assert.equal(await Customer.countDocuments(), count);
  assert.equal(new Set(boxes.map(b => b.displayCode)).size, 5);
  assert.match(boxes[0]._id, /^[0-9a-f-]{36}$/);
  assert.equal(String(boxes[0].booking), String(booking._id));
  const dock = await location({ kind: 'RECEIVING', name: 'Inbound' });
  const shelf = await location({ name: 'B12-S04', maxContainers: 5 });
  for (const box of boxes) {
    await scanItem(box, 'RECEIVE', dock);
    await photograph(box);
    await scanItem(box, 'PUTAWAY', shelf);
    const saved = await StoredContainer.findById(box._id);
    assert.equal(saved.currentStatus, 'IN_STORAGE');
    assert.equal(saved.currentLocation, shelf._id);
    assert.equal(String(saved.lastScanBy), String(staff._id));
    const events = await ScanEvent.find({ objectId: box._id }).sort({ timestamp: 1 });
    assert.deepEqual(events.map(e => e.eventType), ['CREATED', 'RECEIVE', 'PHOTO_ADDED', 'PUTAWAY']);
    assert.equal(events.at(-1).previousLocation, dock._id);
  }
  assert.equal((await WarehouseLocation.findById(shelf._id)).usedContainers, 5);
});

test('creation rejects another customer booking and foreign facility unit', async () => {
  await assert.rejects(containers({ customer: String(otherCustomer._id), booking: String(booking._id) }), /does not belong/);
  const otherSite = await Site.create({ name: 'Other facility' });
  await assert.rejects(containers({ site: String(otherSite._id), booking: String(booking._id), unit: String(unit._id) }), /does not belong/);
});

test('duplicate request is idempotent; changed payload under the same request ID is refused', async () => {
  const item = await readyItem();
  const shelf = await location();
  const input = { requestId: randomUUID(), barcode: item.displayCode, action: 'PUTAWAY', locationBarcode: shelf.displayCode };
  const first = await command(staff, input, 'SCAN', ctx => scan(ctx, input));
  const replay = await command(staff, input, 'SCAN', ctx => scan(ctx, input));
  assert.equal(first.container.currentLocation, replay.container.currentLocation);
  assert.equal(replay.replayed, true);
  assert.equal(await ScanEvent.countDocuments({ requestId: input.requestId }), 1);
  assert.equal((await WarehouseLocation.findById(shelf._id)).usedContainers, 1);
  const changed = { ...input, notes: 'different' };
  await assert.rejects(command(staff, changed, 'SCAN', ctx => scan(ctx, changed)), /different command/);
  await assert.rejects(scanItem(item, 'PUTAWAY', shelf), /ALREADY SCANNED/);
});

test('wrong warehouse, missing photo, and unauthorized moves leave state/history unchanged', async () => {
  const [item] = await containers();
  const shelf = await location();
  const foreign = await location({ warehouse: 'WH2' });
  await assert.rejects(scanItem(item, 'PUTAWAY', shelf), /NO ACTIVE MOVEMENT AUTHORIZATION/);
  const receiving = await location({ kind: 'RECEIVING' });
  await scanItem(item, 'RECEIVE', receiving);
  const beforeCount = await ScanEvent.countDocuments({ objectId: item._id });
  await assert.rejects(scanItem(item, 'PUTAWAY', foreign), /WRONG LOCATION/);
  await assert.rejects(scanItem(item, 'PUTAWAY', shelf), /photo/);
  assert.equal(await ScanEvent.countDocuments({ objectId: item._id }), beforeCount);
  assert.equal((await StoredContainer.findById(item._id)).currentStatus, 'RECEIVED');
  await photograph(item); await scanItem(item, 'PUTAWAY', shelf);
  const second = await location();
  await assert.rejects(scanItem(item, 'RELOCATE', second), /Supervisor/);
  await assert.rejects(scanItem(item, 'RELOCATE', second, admin), /reason/);
  await scanItem(item, 'RELOCATE', second, admin, 'Make space for intake');
  assert.equal((await WarehouseLocation.findById(shelf._id)).usedContainers, 0);
  assert.equal((await WarehouseLocation.findById(second._id)).usedContainers, 1);
});

test('dispatching a stored item to the customer frees its shelf and needs no supervisor', async () => {
  const item = await readyItem();
  const shelf = await location({ maxContainers: 5 });
  await scanItem(item, 'PUTAWAY', shelf);
  const dispatch = await location({ kind: 'DISPATCH', name: 'Front counter' });
  await assert.rejects(scanItem(item, 'DISPATCH', shelf, staff, 'Picked up in person'), /Select a dispatch location/);
  await assert.rejects(scanItem(item, 'DISPATCH', dispatch, staff), /who is picking this up/);
  await scanItem(item, 'DISPATCH', dispatch, staff, 'Picked up in person, ID checked');
  const saved = await StoredContainer.findById(item._id);
  assert.equal(saved.currentStatus, 'DISPATCHED');
  assert.equal(saved.currentLocation, null);
  assert.equal((await WarehouseLocation.findById(shelf._id)).usedContainers, 0);
  await assert.rejects(scanItem(item, 'DISPATCH', dispatch, staff, 'Again'), /ALREADY SCANNED/);
  const events = await ScanEvent.find({ objectId: item._id }).sort({ timestamp: 1 });
  assert.equal(events.at(-1).eventType, 'DISPATCH');
  assert.equal(events.at(-1).destinationLocation, dispatch._id);
});

test('an item can be dispatched straight from receiving, before ever reaching a shelf', async () => {
  const [item] = await containers();
  const receiving = await location({ kind: 'RECEIVING' });
  await scanItem(item, 'RECEIVE', receiving);
  const dispatch = await location({ kind: 'DISPATCH' });
  await scanItem(item, 'DISPATCH', dispatch, staff, 'Customer changed their mind, took it back immediately');
  assert.equal((await StoredContainer.findById(item._id)).currentStatus, 'DISPATCHED');
});

test('receiving with no location scan auto-resolves the warehouse’s one receiving area', async () => {
  const [item] = await containers({ warehouse: 'WH-AUTO' });
  await assert.rejects(run(staff, 'SCAN', { barcode: item.displayCode, action: 'RECEIVE' }, scan), /No receiving area/);
  const receiving = await location({ warehouse: 'WH-AUTO', kind: 'RECEIVING' });
  await run(staff, 'SCAN', { barcode: item.displayCode, action: 'RECEIVE' }, scan);
  const saved = await StoredContainer.findById(item._id);
  assert.equal(saved.currentStatus, 'RECEIVED');
  assert.equal(String(saved.currentLocation), String(receiving._id));
  await location({ warehouse: 'WH-AUTO', kind: 'RECEIVING', name: 'Second dock' });
  const [other] = await containers({ warehouse: 'WH-AUTO' });
  await assert.rejects(run(staff, 'SCAN', { barcode: other.displayCode, action: 'RECEIVE' }, scan), /More than one receiving area/);
});

test('a pickup job tracks items from creation through receiving to completion', async () => {
  const job = await createJob({ type: 'PICKUP', partnerName: 'Fast Movers', partnerPhone: '+971500000099' });
  assert.equal(job.status, 'ASSIGNED');
  await assert.rejects(updateJob(job._id, { status: 'COMPLETED' }), /Link at least one item/);
  const [item] = await containers();
  await updateJob(job._id, { addContainers: [item._id] });
  await assert.rejects(updateJob(job._id, { status: 'COMPLETED' }), /still need to be received/);
  const receiving = await location({ kind: 'RECEIVING' });
  await scanItem(item, 'RECEIVE', receiving);
  const done = await updateJob(job._id, { status: 'COMPLETED' });
  assert.equal(done.status, 'COMPLETED');
  assert.ok(done.completedAt);
  await assert.rejects(updateJob(job._id, { partnerName: 'Someone else' }), /already closed/);
});

test('a delivery job only requires stored items and only completes once they are dispatched', async () => {
  const item = await readyItem();
  const shelf = await location({ maxContainers: 5 });
  await scanItem(item, 'PUTAWAY', shelf);
  const [notStored] = await containers();
  await assert.rejects(createJob({ type: 'DELIVERY', containers: [notStored._id] }), /not currently in storage/);
  const job = await createJob({ type: 'DELIVERY', containers: [item._id] });
  assert.equal(job.status, 'REQUESTED');
  assert.deepEqual(job.containers, [item._id]);
  await assert.rejects(updateJob(job._id, { status: 'COMPLETED' }), /still need to be dispatched/);
  const dispatch = await location({ kind: 'DISPATCH' });
  await scanItem(item, 'DISPATCH', dispatch, staff, 'Handed to delivery partner');
  const done = await updateJob(job._id, { status: 'COMPLETED' });
  assert.equal(done.status, 'COMPLETED');
});

test('a job link is optional, idempotent, revocable, and lets a partner confirm with no staff account', async () => {
  const job = await createJob({ type: 'PICKUP' });
  const { token: token1 } = await run(staff, 'CREATE_JOB_LINK', {}, ctx => getOrCreateJobLink(ctx, job._id));
  const { token: token2 } = await run(staff, 'CREATE_JOB_LINK', {}, ctx => getOrCreateJobLink(ctx, job._id));
  assert.equal(token1, token2);
  const confirmAs = (input = {}) => run({ _id: job.createdBy }, 'PUBLIC_JOB_CONFIRM', input, (ctx, body) => confirmJobPublicly(ctx, job._id, body));
  await assert.rejects(confirmAs(), /Link at least one item/);
  const [item] = await containers();
  await updateJob(job._id, { addContainers: [item._id] });
  await assert.rejects(confirmAs(), /still need to be received/);
  const receiving = await location({ kind: 'RECEIVING' });
  await scanItem(item, 'RECEIVE', receiving);
  const confirmed = await confirmAs({ notes: 'Left at reception' });
  assert.equal(confirmed.job.status, 'COMPLETED');
  const events = await ScanEvent.find({ objectId: job._id }).sort({ timestamp: 1 });
  assert.match(events.at(-1).notes, /Confirmed by partner via link: Left at reception/);
  await assert.rejects(confirmAs(), /already been confirmed/);
});

test('revoking a job link clears it so a later confirm attempt finds nothing', async () => {
  const job = await createJob({ type: 'PICKUP' });
  await run(staff, 'CREATE_JOB_LINK', {}, ctx => getOrCreateJobLink(ctx, job._id));
  await run(staff, 'REVOKE_JOB_LINK', {}, ctx => revokeJobLink(ctx, job._id));
  const reloaded = await WarehouseJob.findById(job._id).lean();
  assert.equal(reloaded.confirmToken, null);
});

test('a job with no address and a customer with none on file is refused', async () => {
  await assert.rejects(createJob({ type: 'PICKUP', address: undefined, customer: String(otherCustomer._id) }), /Enter the pickup or delivery address/);
});

test('concurrent putaway never overfills the last free slot', async () => {
  const first = await readyItem(), second = await readyItem();
  const shelf = await location({ maxContainers: 1 });
  const results = await Promise.allSettled([scanItem(first, 'PUTAWAY', shelf), scanItem(second, 'PUTAWAY', shelf)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /capacity/);
  assert.equal((await WarehouseLocation.findById(shelf._id)).usedContainers, 1);
  assert.equal(await StoredContainer.countDocuments({ currentLocation: shelf._id }), 1);
});

test('capacity rejects missing measurements and applies volume/weight limits', () => {
  const item = { site: 's', warehouse: 'WH1', currentStatus: 'RECEIVED', photoCount: 1, weight: null, volume: null };
  const loc = { _id: 'loc', site: 's', warehouse: 'WH1', kind: 'SHELF', usedContainers: 0, usedWeight: 0, usedVolume: 0, maxWeight: 10 };
  assert.throws(() => validateMovement(item, loc, 'PUTAWAY', false), /Record the item weight/);
  assert.throws(() => validateMovement({ ...item, weight: 11 }, loc, 'PUTAWAY', false), /weight capacity/);
  assert.throws(() => validateMovement({ ...item, weight: 1, volume: 2 }, { ...loc, maxVolume: 1 }, 'PUTAWAY', false), /volume capacity/);
});

test('editing a location requires a supervisor and only touches name/capacity', async () => {
  const shelf = await location({ maxContainers: 5 });
  await assert.rejects(run(staff, 'EDIT_LOCATION', { name: 'New name' }, ctx => editLocation(ctx, shelf._id, { name: 'New name' })), /Supervisor/);
  await run(admin, 'EDIT_LOCATION', { name: 'Renamed shelf', maxContainers: 8 }, ctx => editLocation(ctx, shelf._id, { name: 'Renamed shelf', maxContainers: 8 }));
  const saved = await WarehouseLocation.findById(shelf._id);
  assert.equal(saved.name, 'Renamed shelf');
  assert.equal(saved.maxContainers, 8);
  const zone = await location({ kind: 'ZONE' });
  await assert.rejects(run(admin, 'EDIT_LOCATION', { maxContainers: 3 }, ctx => editLocation(ctx, zone._id, { maxContainers: 3 })), /storage racks, shelves and bins/);
});

test('a location can only be deleted once nothing occupies or nests under it', async () => {
  const zone = await location({ kind: 'ZONE' });
  const shelf = await location({ parent: zone._id });
  const item = await readyItem();
  await scanItem(item, 'PUTAWAY', shelf);
  await assert.rejects(run(admin, 'DELETE_LOCATION', {}, ctx => deleteLocation(ctx, shelf._id)), /still has items/);
  await assert.rejects(run(admin, 'DELETE_LOCATION', {}, ctx => deleteLocation(ctx, zone._id)), /nested under it/);
  await scanItem(item, 'RELOCATE', await location(), admin, 'freeing the shelf for deletion');
  await run(admin, 'DELETE_LOCATION', {}, ctx => deleteLocation(ctx, shelf._id));
  assert.equal(await WarehouseLocation.findById(shelf._id), null);
  await run(admin, 'DELETE_LOCATION', {}, ctx => deleteLocation(ctx, zone._id));
});

test('editing a container updates measurements before storage and is blocked after', async () => {
  const [item] = await containers();
  await run(staff, 'EDIT_CONTAINER', { weight: 12, length: 10, width: 10, height: 10 }, ctx => editContainer(ctx, item._id, { weight: 12, length: 10, width: 10, height: 10 }));
  const saved = await StoredContainer.findById(item._id);
  assert.equal(saved.weight, 12);
  assert.equal(saved.volume, 0.001);
  const ready = await readyItem();
  const shelf = await location();
  await scanItem(ready, 'PUTAWAY', shelf);
  await assert.rejects(run(staff, 'EDIT_CONTAINER', { weight: 5 }, ctx => editContainer(ctx, ready._id, { weight: 5 })), /in storage/);
  await run(staff, 'EDIT_CONTAINER', { description: 'Relabelled' }, ctx => editContainer(ctx, ready._id, { description: 'Relabelled' }));
  assert.equal((await StoredContainer.findById(ready._id)).description, 'Relabelled');
});

test('deleting a container soft-deletes it, releases its shelf, and keeps its history', async () => {
  const item = await readyItem();
  const shelf = await location({ maxContainers: 5 });
  await scanItem(item, 'PUTAWAY', shelf);
  await assert.rejects(run(staff, 'DELETE_CONTAINER', {}, ctx => deleteContainer(ctx, item._id)), /Supervisor/);
  await run(admin, 'DELETE_CONTAINER', { notes: 'Customer disposed of it' }, ctx => deleteContainer(ctx, item._id, { notes: 'Customer disposed of it' }));
  assert.equal(await StoredContainer.findById(item._id), null);
  assert.notEqual(await StoredContainer.findOne({ _id: item._id }, null, { includeDeleted: true }), null);
  assert.equal((await WarehouseLocation.findById(shelf._id)).usedContainers, 0);
  const events = await ScanEvent.find({ objectId: item._id }).sort({ timestamp: 1 });
  assert.equal(events.at(-1).eventType, 'DELETED');
});

// Writes are no longer wrapped in a transaction (services/warehouse.js —
// this deployment's MongoDB is a standalone server, which can't run one), so
// a failure writing the event can no longer roll back a state mutation that
// already committed just before it. The command still surfaces the error to
// the caller either way — this test now locks in that the state change is
// real and visible, not that it was undone.
test('event failure surfaces the error without undoing an already-saved state mutation', async () => {
  const item = await readyItem();
  const saved = await StoredContainer.findById(item._id);
  const originalCreate = ScanEvent.create;
  ScanEvent.create = async () => { throw new Error('Simulated event storage failure'); };
  try {
    await assert.rejects(scanItem(item, 'INSPECT'), /Simulated event/);
  } finally { ScanEvent.create = originalCreate; }
  const after = await StoredContainer.findById(item._id);
  assert.equal(after.revision, saved.revision + 1);
  assert.ok(after.lastScanAt.getTime() > saved.lastScanAt.getTime());
});

test('events refuse update, document save, delete, replace and bulk write', async () => {
  const event = await ScanEvent.findOne();
  event.notes = 'tampering';
  await assert.rejects(event.save(), /immutable/);
  await assert.rejects(ScanEvent.updateOne({ _id: event._id }, { $set: { notes: 'tampering' } }), /immutable/);
  await assert.rejects(ScanEvent.deleteMany({}), /immutable/);
  await assert.rejects(event.deleteOne(), /immutable/);
  await assert.rejects(ScanEvent.replaceOne({ _id: event._id }, event.toObject()), /immutable/);
  await assert.rejects(ScanEvent.bulkWrite([{ deleteOne: { filter: { _id: event._id } } }]), /immutable/);
});

test('HTTP permissions, safe lookup, private photos, and revoked access', async () => {
  await request(app).get('/warehouse/setup').expect(401);
  await request(app).get('/warehouse/setup').set('x-test-user', String(outsider._id)).expect(403);
  const lookup = await request(app).get('/warehouse/customers?search=John').set('x-test-user', String(staff._id)).expect(200);
  assert.equal(lookup.body[0].fullName, 'John Smith');
  assert.equal(lookup.body[0].notes, undefined); assert.equal(lookup.body[0].email, undefined);
  const item = await readyItem();
  const detail = await request(app).get(`/warehouse/containers/${item._id}`).set('x-test-user', String(staff._id)).expect(200);
  const photoId = detail.body.photos[0]._id;
  await request(app).get(`/warehouse/photos/${photoId}`).expect(401);
  const photo = await request(app).get(`/warehouse/photos/${photoId}`).set('x-test-user', String(staff._id)).expect(200);
  assert.equal(photo.headers['content-type'], 'image/png');
  assert.deepEqual(photo.body, png);
  await User.updateOne({ _id: staff._id }, { $set: { permissions: [] } });
  await request(app).get('/warehouse/setup').set('x-test-user', String(staff._id)).expect(403);
  await User.updateOne({ _id: staff._id }, { $set: { permissions: ['warehouse'] } });
});

test('containers can be looked up by a specific list of ids, for a job’s linked items', async () => {
  const [a, b] = await containers({ quantity: 2 });
  const [other] = await containers();
  const result = await request(app).get('/warehouse/containers').query({ site: String(site._id), ids: `${a._id},${b._id}` }).set('x-test-user', String(staff._id)).expect(200);
  const ids = result.body.data.map(c => c._id).sort();
  assert.deepEqual(ids, [a._id, b._id].sort());
  assert.ok(!ids.includes(other._id));
});

test('unknown barcode is recorded without silently creating inventory', async () => {
  const beforeCount = await StoredContainer.countDocuments();
  const result = await run(staff, 'SCAN', { barcode: 'PBX-BX-999999999', action: 'INSPECT' }, scan);
  assert.equal(result.recognized, false);
  assert.equal(await StoredContainer.countDocuments(), beforeCount);
  assert.equal(await ScanEvent.countDocuments({ barcode: 'PBX-BX-999999999', eventType: 'UNKNOWN_SCAN' }), 1);
});

test('labels return a real PDF and only a supervisor may reprint', async () => {
  const [item] = await containers();
  const body = { requestId: randomUUID(), codes: [item.displayCode], format: '4x6' };
  const first = await request(app).post('/warehouse/labels').set('x-test-user', String(staff._id)).send(body).expect(200);
  assert.match(first.headers['content-type'], /application\/pdf/);
  assert.equal(first.body.subarray(0, 4).toString(), '%PDF');
  await request(app).post('/warehouse/labels').set('x-test-user', String(staff._id)).send(body).expect(200);
  await request(app).post('/warehouse/labels').set('x-test-user', String(staff._id)).send({ ...body, requestId: randomUUID() }).expect(403);
  await request(app).post('/warehouse/labels').set('x-test-user', String(admin._id)).send({ ...body, requestId: randomUUID(), format: 'A4' }).expect(200);
});

test('photo endpoint rejects disguised HTML and validates size without changing state', async () => {
  const [item] = await containers();
  await request(app).post(`/warehouse/containers/${item._id}/photos`).set('x-test-user', String(staff._id)).field('requestId', randomUUID()).attach('photo', Buffer.from('<script>alert(1)</script>'), { filename: 'fake.jpg', contentType: 'image/jpeg' }).expect(400);
  assert.equal((await StoredContainer.findById(item._id)).photoCount, 0);
});
