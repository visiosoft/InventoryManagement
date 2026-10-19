import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  Contract, ContractRenewal, Counter, Customer, CustomerOtp, CustomerRequest, Document, Invoice, Lead, Payment, Site, Task, Unit, User,
} from '../src/models/index.js';
import { ServiceRequest } from '../src/models/serviceRequest.js';
import { CustomerNotification } from '../src/models/customerNotification.js';
import { ClientRequest } from '../src/models/clientRequest.js';
import {
  escalateOverdue, onIdentityUpload, onServiceRequestCreated, openClientRequest, backfillClientRequests,
} from '../src/services/clientRequests.js';
import customerAuthRouter from '../src/routes/customerAuth.js';
import customerStorageRouter from '../src/routes/customerStorage.js';
import serviceRequestRouter from '../src/routes/serviceRequests.js';
import clientRequestRouter from '../src/routes/clientRequests.js';

let mongod, app, site, admin, ops, rep, accounts, nobody;
const storage = '/api/customer-portal/storage';
const models = [Contract, ContractRenewal, Counter, Customer, CustomerOtp, CustomerRequest, Document, Invoice, Lead, Payment, Site, Task, Unit, User,
  ServiceRequest, CustomerNotification, ClientRequest];
const DAY = 86_400_000;

// Stands in for requireAuth: the routers re-read the account themselves.
const asUser = (req, _res, next) => { req.user = req.headers['x-test-user'] ? { id: req.headers['x-test-user'] } : undefined; next(); };

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret';
  process.env.EXPO_PUSH_DISABLED = 'true';
  delete process.env.WHATSAPP_OTP_TEMPLATE;
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'client_requests_test' });
  await Promise.all(models.map((m) => m.init()));
  app = express();
  app.use(express.json());
  app.use('/api/customer-auth', customerAuthRouter);
  app.use(storage, customerStorageRouter);
  app.use('/api/service-requests', asUser, serviceRequestRouter);
  app.use('/api/client-requests', asUser, clientRequestRouter);
}, { timeout: 240000 });

after(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all(models.map((m) => m.collection.deleteMany({})));
  site = await Site.create({ name: 'Al Quoz', address: 'Warehouse 12', isDefault: true });
  const mk = (name, role, permissions = []) => User.create({ name, email: `${name.toLowerCase()}@test.invalid`, passwordHash: 'x', role, permissions });
  admin = await mk('Admin', 'admin');
  ops = await mk('Ops', 'staff', ['warehouse']);
  rep = await mk('Rep', 'sales_rep');
  accounts = await mk('Accounts', 'accounts');
  nobody = await mk('Nobody', 'staff', ['units']);
});

const as = (user) => ({ 'x-test-user': String(user._id) });
const api = (path) => `/api/client-requests${path}`;

async function login(phone) {
  const otp = await request(app).post('/api/customer-auth/request-otp').send({ phone });
  const res = await request(app).post('/api/customer-auth/verify-otp').send({ phone, code: otp.body.code });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { Authorization: `Bearer ${res.body.token}` };
}

let unitSeq = 0;
async function tenant(phone, { salesRep = null, status = 'active' } = {}) {
  unitSeq += 1;
  const customer = await Customer.create({ fullName: `Tenant ${phone.slice(-4)}`, phone, phones: [phone], stage: 'customer' });
  const unit = await Unit.create({ unitNumber: `U-${unitSeq}`, sizeSqf: 100, price: 1000, site: site._id, status: 'occupied' });
  const contract = await Contract.create({
    contractNo: `C-${phone.slice(-4)}`, customer: customer._id, unit: unit._id, units: [unit._id], billingPeriod: 'monthly', rate: 1000, deposit: 500,
    startDate: new Date(Date.now() - 60 * DAY), endDate: new Date(Date.now() + 30 * DAY), status, salesRep,
  });
  return { customer, unit, contract };
}

test('open is idempotent per source, and a decided request is never reopened', async () => {
  const { customer, contract } = await tenant('+971502000001');
  const source = { kind: 'CustomerRequest', id: new mongoose.Types.ObjectId() };
  const a = await openClientRequest({ type: 'extend', customer, contract, source, title: 'Extend' });
  const b = await openClientRequest({ type: 'extend', customer, contract, source, title: 'Extend again' });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(String(a.request._id), String(b.request._id));
  assert.equal(a.request.ref, 'CR-0001');
  assert.equal(await ClientRequest.countDocuments(), 1);

  await ClientRequest.updateOne({ _id: a.request._id }, { $set: { status: 'resolved' } });
  const c = await openClientRequest({ type: 'extend', customer, contract, source, title: 'Extend' });
  assert.equal(c.created, false);
  assert.equal(c.request.status, 'resolved');

  // A different type on the same source is a different request.
  const d = await openClientRequest({ type: 'moveout', customer, contract, source, title: 'Move' });
  assert.equal(d.created, true);
  assert.equal(d.request.ref, 'CR-0002');
});

test('routing: team by type, SLA, and sales requests go to the active contract rep', async () => {
  const withRep = await tenant('+971502000002', { salesRep: rep._id });
  const t0 = Date.now();
  const ext = await openClientRequest({ type: 'extend', customer: withRep.customer, contract: withRep.contract, source: { kind: 'CustomerRequest', id: new mongoose.Types.ObjectId() } });
  assert.equal(ext.request.team, 'sales');
  assert.equal(String(ext.request.assignee), String(rep._id));
  assert.deepEqual(ext.request.activity.map((x) => x.kind), ['created', 'assigned']);
  assert.ok(Math.abs(ext.request.dueAt - t0 - 2 * 3_600_000) < 5000);

  const refund = await openClientRequest({ type: 'deposit_refund', customer: withRep.customer, contract: withRep.contract, source: { kind: 'CustomerRequest', id: new mongoose.Types.ObjectId() } });
  assert.equal(refund.request.team, 'accounts');
  assert.equal(refund.request.assignee, null, 'only sales requests follow the rep');

  await User.updateOne({ _id: rep._id }, { $set: { isActive: false } });
  const gone = await openClientRequest({ type: 'moveout', customer: withRep.customer, contract: withRep.contract, source: { kind: 'CustomerRequest', id: new mongoose.Types.ObjectId() } });
  assert.equal(gone.request.assignee, null, 'an inactive rep leaves it in the pool');

  const signup = await openClientRequest({ type: 'new_signup', customer: withRep.customer, source: { kind: 'Customer', id: withRep.customer._id } });
  assert.ok(Math.abs(signup.request.dueAt - Date.now() - 24 * 3_600_000) < 5000);
});

test('visibility by team, counts, and the list contract', async () => {
  const t = await tenant('+971502000003');
  const sr = await ServiceRequest.create({ customer: t.customer._id, contract: t.contract._id, ref: 'SR-0101', type: 'pickup', date: '2030-01-02', slot: '10-12', estimate: { total: 250 } });
  const svc = await onServiceRequestCreated(sr);
  const ext = (await openClientRequest({ type: 'extend', customer: t.customer, contract: t.contract, source: { kind: 'CustomerRequest', id: new mongoose.Types.ObjectId() }, title: 'Extend C-0003' })).request;
  await ClientRequest.updateOne({ _id: ext._id }, { $set: { dueAt: new Date(Date.now() - 60_000) } });

  const opsList = await request(app).get(api('/')).set(as(ops));
  assert.equal(opsList.status, 200);
  assert.deepEqual(opsList.body.items.map((i) => i.type), ['service']);
  const row = opsList.body.items[0];
  assert.deepEqual(Object.keys(row).sort(), ['assignee', 'contract', 'createdAt', 'customer', 'dueAt', 'escalatedAt', 'id', 'overdue', 'priority', 'ref', 'status', 'summary', 'team', 'title', 'type', 'updatedAt'].sort());
  assert.deepEqual(row.contract, { id: String(t.contract._id), contractNo: 'C-0003', units: [t.unit.unitNumber] });
  assert.equal(row.customer.phone, '+971502000003');
  assert.equal(row.title, 'Pickup to storage · SR-0101');

  assert.equal((await request(app).get(api(`/${ext._id}`)).set(as(ops))).status, 403, 'warehouse cannot open a sales request');
  assert.equal((await request(app).get(api('/')).set(as(nobody))).status, 403);
  assert.equal((await request(app).get(api('/')).set({})).status, 401);

  const adminList = await request(app).get(api('/?scope=all')).set(as(admin));
  assert.equal(adminList.body.total, 2);
  assert.equal(adminList.body.items[0].id, String(ext._id), 'overdue first');
  assert.equal(adminList.body.items[0].overdue, true);

  const search = await request(app).get(api('/?scope=all&q=Tenant 0003')).set(as(admin));
  assert.equal(search.body.total, 2, 'q matches the customer name');
  const byRef = await request(app).get(api(`/?scope=all&q=${svc.ref}`)).set(as(admin));
  assert.deepEqual(byRef.body.items.map((i) => i.ref), [svc.ref]);

  const counts = await request(app).get(api('/counts')).set(as(rep));
  assert.deepEqual(counts.body, { mine: 0, team: 1, overdue: 1, byType: { service: 0, extend: 1, moveout: 0, deposit_refund: 0, id_check: 0, booking_review: 0, new_signup: 0 } });
  const adminCounts = await request(app).get(api('/counts')).set(as(admin));
  assert.equal(adminCounts.body.team, 2);
});

test('claim, assign, status and notes', async () => {
  const t = await tenant('+971502000004');
  const r = (await openClientRequest({ type: 'moveout', customer: t.customer, contract: t.contract, source: { kind: 'CustomerRequest', id: new mongoose.Types.ObjectId() } })).request;

  const claimed = await request(app).post(api(`/${r._id}/claim`)).set(as(rep));
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  assert.equal(claimed.body.status, 'in_progress');
  assert.deepEqual(claimed.body.assignee, { id: String(rep._id), name: 'Rep' });
  assert.ok(!claimed.body.actions.includes('claim'), 'already mine');
  assert.ok(!claimed.body.actions.includes('approve'), 'no pending customer request behind it, so nothing to approve');

  const assignees = await request(app).get(api('/assignees?team=sales')).set(as(rep));
  assert.deepEqual(assignees.body.map((u) => u.name), ['Admin', 'Rep']);
  assert.equal((await request(app).get(api('/assignees?team=warehouse')).set(as(rep))).status, 403);

  const wrong = await request(app).post(api(`/${r._id}/assign`)).set(as(rep)).send({ userId: String(ops._id) });
  assert.equal(wrong.status, 400);
  const toAdmin = await request(app).post(api(`/${r._id}/assign`)).set(as(rep)).send({ userId: String(admin._id) });
  assert.equal(toAdmin.body.assignee.name, 'Admin');
  const pool = await request(app).post(api(`/${r._id}/assign`)).set(as(rep)).send({ userId: null });
  assert.equal(pool.body.assignee, null);

  const waiting = await request(app).post(api(`/${r._id}/status`)).set(as(rep)).send({ status: 'waiting_customer' });
  assert.equal(waiting.body.status, 'waiting_customer');
  assert.equal((await request(app).post(api(`/${r._id}/status`)).set(as(rep)).send({ status: 'resolved' })).status, 400);
  const noted = await request(app).post(api(`/${r._id}/note`)).set(as(rep)).send({ text: 'Called, no answer' });
  assert.deepEqual(noted.body.activity.map((a) => a.kind), ['created', 'claimed', 'assigned', 'assigned', 'status', 'note']);
  assert.equal(noted.body.activity.at(-1).byName, 'Rep');
});

test('extend: the app request opens a case, approval extends via the renewal logic and raises the invoice', async () => {
  const t = await tenant('+971502000005', { salesRep: rep._id });
  const auth = await login('+971502000005');
  const asked = await request(app).post(`${storage}/contracts/${t.contract._id}/checkout-change`).set(auth).send({ action: 'extend', months: 6 });
  assert.equal(asked.status, 201, JSON.stringify(asked.body));
  const r = await ClientRequest.findOne({ type: 'extend' });
  assert.ok(r, 'opened by the customer route');
  assert.equal(String(r.assignee), String(rep._id));

  const detail = await request(app).get(api(`/${r._id}`)).set(as(rep));
  assert.equal(detail.body.context.customerRequest.status, 'pending');
  assert.equal(detail.body.context.contract.contractNo, 'C-0005');
  assert.ok(detail.body.context.preview.amount > 0);

  const ok = await request(app).post(api(`/${r._id}/action`)).set(as(rep)).send({ action: 'approve' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, 'resolved');
  assert.equal(ok.body.resolution.outcome, 'approved');
  assert.deepEqual(ok.body.actions, ['note']);

  const contract = await Contract.findById(t.contract._id).lean();
  assert.equal(new Date(contract.endDate).toISOString(), new Date(asked.body.payload.requestedEndDate).toISOString());
  assert.equal(contract.renewalHistory.length, 1);
  assert.ok(contract.timeline.some((l) => /on the tenant's app request/.test(l.text)));
  const renewal = await ContractRenewal.findOne({ contract: t.contract._id }).lean();
  assert.equal(renewal.status, 'applied');
  const invoice = await Invoice.findById(renewal.invoice).lean();
  assert.equal(invoice.total, ok.body.context.preview.amount ?? invoice.total);
  assert.equal(invoice.paymentMade, 0, 'raised as owed — the tenant pays it in the app');
  assert.equal((await CustomerRequest.findById(r.source.id)).status, 'approved');
  assert.ok(await CustomerNotification.exists({ customer: t.customer._id, title: 'Extension approved' }));

  const again = await request(app).post(api(`/${r._id}/action`)).set(as(rep)).send({ action: 'approve' });
  assert.equal(again.status, 409);
});

test('move-out and refund: approve moves the check-out; decline needs a reason; refund is recorded', async () => {
  const t = await tenant('+971502000006');
  const auth = await login('+971502000006');
  const when = new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10);
  await request(app).post(`${storage}/contracts/${t.contract._id}/checkout-change`).set(auth).send({ action: 'move_out_early', date: when });
  const mo = await ClientRequest.findOne({ type: 'moveout' });
  const moved = await request(app).post(api(`/${mo._id}/action`)).set(as(admin)).send({ action: 'approve' });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  const c = await Contract.findById(t.contract._id).lean();
  assert.equal(c.endDate.toISOString().slice(0, 10), when);
  assert.equal(c.renewalIntent, 'not_renewing');
  assert.ok(c.resignNeeded, 'same side effects as a check-out change on the contract page');

  const ended = await tenant('+971502000007', { status: 'ended' });
  const auth2 = await login('+971502000007');
  await request(app).post(`${storage}/contracts/${ended.contract._id}/refund-request`).set(auth2).send({ note: 'IBAN on file' });
  const rf = await ClientRequest.findOne({ type: 'deposit_refund' });
  assert.equal(rf.team, 'accounts');
  assert.equal((await request(app).get(api(`/${rf._id}`)).set(as(rep))).status, 403);
  assert.equal((await request(app).post(api(`/${rf._id}/action`)).set(as(accounts)).send({ action: 'decline' })).status, 400, 'reason required');
  const paid = await request(app).post(api(`/${rf._id}/action`)).set(as(accounts)).send({ action: 'mark_refunded', amount: 500, method: 'bank_transfer', note: 'Ref 123' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.resolution.outcome, 'refunded');
  const cr = await CustomerRequest.findById(rf.source.id).lean();
  assert.equal(cr.status, 'approved');
  assert.equal(cr.payload.refund.amount, 500);
  assert.ok((await Contract.findById(ended.contract._id).lean()).timeline.some((l) => /refunded/.test(l.text)));
});

test('id check: uploads batch into one case; reject asks the customer to upload again', async () => {
  const t = await tenant('+971502000008');
  const mkDoc = (side) => Document.create({ customer: t.customer._id, name: `Emirates ID (${side})`, type: 'emirates_id', side, source: 'customer_app', url: `/uploads/eid-${side}.jpg`, verification: { state: 'pending' } });
  const front = await mkDoc('front');
  const back = await mkDoc('back');
  const a = await onIdentityUpload(front);
  const b = await onIdentityUpload(back);
  assert.equal(String(a._id), String(b._id));
  assert.equal(await ClientRequest.countDocuments({ type: 'id_check' }), 1);

  const detail = await request(app).get(api(`/${a._id}`)).set(as(rep));
  assert.deepEqual(detail.body.context.documents.map((d) => [d.side, d.url, d.verification.state]), [
    ['front', `/api/documents/${front._id}/file`, 'pending'], ['back', `/api/documents/${back._id}/file`, 'pending'],
  ]);
  assert.ok(detail.body.actions.includes('verify') && detail.body.actions.includes('reject'));

  assert.equal((await request(app).post(api(`/${a._id}/action`)).set(as(rep)).send({ action: 'reject' })).status, 400);
  const rej = await request(app).post(api(`/${a._id}/action`)).set(as(rep)).send({ action: 'reject', reason: 'The photo is blurred' });
  assert.equal(rej.status, 200, JSON.stringify(rej.body));
  assert.equal(rej.body.status, 'declined');
  assert.deepEqual(rej.body.context.documents.map((d) => d.verification.state), ['rejected', 'rejected']);
  const note = await CustomerNotification.findOne({ customer: t.customer._id }).lean();
  assert.equal(note.data.route, '/id-upload');
  assert.equal(note.body, 'The photo is blurred');

  // A fresh upload after a rejection is a fresh check.
  const again = await onIdentityUpload(await mkDoc('front'));
  assert.notEqual(String(again._id), String(a._id));
});

test('escalation marks an overdue request once', async () => {
  const t = await tenant('+971502000009');
  const r = (await openClientRequest({ type: 'booking_review', customer: t.customer, source: { kind: 'Quote', id: new mongoose.Types.ObjectId() } })).request;
  const waiting = (await openClientRequest({ type: 'extend', customer: t.customer, source: { kind: 'CustomerRequest', id: new mongoose.Types.ObjectId() } })).request;
  await ClientRequest.updateMany({}, { $set: { dueAt: new Date(Date.now() - 60_000) } });
  await ClientRequest.updateOne({ _id: waiting._id }, { $set: { status: 'waiting_customer' } });

  assert.deepEqual(await escalateOverdue(), { escalated: 1 });
  assert.deepEqual(await escalateOverdue(), { escalated: 0 });
  const after = await ClientRequest.findById(r._id).lean();
  assert.ok(after.escalatedAt);
  assert.equal(after.activity.filter((a) => a.kind === 'escalated').length, 1);
  assert.equal((await ClientRequest.findById(waiting._id).lean()).escalatedAt, null, 'waiting on the customer is not overdue');
});

test('service requests sync from the staff page; new sign-ups become leads; backfill is idempotent', async () => {
  const t = await tenant('+971502000010');
  const sr = await ServiceRequest.create({ customer: t.customer._id, ref: 'SR-0201', type: 'pickup', date: '2030-01-02', slot: '10-12', estimate: { total: 250 } });
  await onServiceRequestCreated(sr);
  await request(app).patch(`/api/service-requests/${sr._id}`).set(as(ops)).send({ status: 'confirmed' });
  assert.equal((await ClientRequest.findOne({ type: 'service' })).status, 'in_progress');
  await request(app).patch(`/api/service-requests/${sr._id}`).set(as(ops)).send({ status: 'completed' });
  const done = await ClientRequest.findOne({ type: 'service' }).lean();
  assert.equal(done.status, 'resolved');
  assert.equal(done.resolution.outcome, 'completed');
  // An unpaid delivery is not a job yet.
  const unpaid = await ServiceRequest.create({ customer: t.customer._id, ref: 'SR-0202', type: 'dropoff', date: '2030-01-02', slot: '10-12', status: 'awaiting_payment' });
  assert.equal(await onServiceRequestCreated(unpaid), null);

  await login('+971502999999');
  const signup = await ClientRequest.findOne({ type: 'new_signup' });
  assert.ok(signup, 'verify-otp for a new number opens a sign-up request');
  const made = await request(app).post(api(`/${signup._id}/action`)).set(as(rep)).send({ action: 'create_lead' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.resolution.outcome, 'lead_created');
  const lead = await Lead.findOne({ phoneNormalized: '971502999999' }).lean();
  assert.equal(lead.source, 'mobile_app');
  assert.equal(String(lead.owner), String(rep._id), 'a rep making it keeps it');
  assert.equal(made.body.context.existingLead.id, String(lead._id));

  await CustomerRequest.create({ customer: t.customer._id, contract: t.contract._id, type: 'refund', payload: { deposit: 500 } });
  const first = await request(app).post(api('/backfill')).set(as(admin));
  assert.equal(first.status, 200);
  assert.equal(first.body.created.deposit_refund, 1);
  const second = await backfillClientRequests();
  assert.equal(second.total, 0);
  assert.equal((await request(app).post(api('/backfill')).set(as(rep))).status, 403);
});
