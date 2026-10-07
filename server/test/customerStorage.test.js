import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Contract, Customer, CustomerOtp, CustomerRequest, Invoice, Payment, Unit } from '../src/models/index.js';
import customerAuthRouter from '../src/routes/customerAuth.js';
import customerStorageRouter from '../src/routes/customerStorage.js';
import { requireAuth } from '../src/middleware/auth.js';

let mongod, app;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret';
  delete process.env.WHATSAPP_OTP_TEMPLATE;
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'customer_storage_test' });
  await Promise.all([Contract, Customer, CustomerOtp, CustomerRequest, Invoice, Payment, Unit].map((m) => m.init()));
  app = express();
  app.use(express.json());
  app.use('/api/customer-auth', customerAuthRouter);
  app.use('/api/customer-portal/storage', customerStorageRouter);
  app.get('/api/staff-only', requireAuth, (req, res) => res.json({ ok: true }));
}, { timeout: 240000 });

after(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all([Contract, Customer, CustomerOtp, CustomerRequest, Invoice, Payment, Unit].map((m) => m.deleteMany({})));
});

async function login(phone, fullName) {
  const otp = await request(app).post('/api/customer-auth/request-otp').send({ phone });
  assert.equal(otp.status, 200);
  assert.match(otp.body.code, /^\d{6}$/, 'dev mode returns a 6-digit code');
  const res = await request(app).post('/api/customer-auth/verify-otp').send({ phone, code: otp.body.code, fullName });
  assert.equal(res.status, 200);
  return res.body;
}

async function seedTenant(phone, contractNo) {
  const customer = await Customer.create({ fullName: `Tenant ${contractNo}`, phone, phones: [phone], stage: 'customer' });
  const unit = await Unit.create({ unitNumber: `U-${contractNo}`, sizeSqf: 100 });
  const start = new Date(Date.now() - 40 * 86_400_000);
  const end = new Date(Date.now() + 200 * 86_400_000);
  const contract = await Contract.create({
    contractNo, customer: customer._id, unit: unit._id, billingPeriod: 'monthly', rate: 1000,
    startDate: start, endDate: end, status: 'active', notes: 'INTERNAL NOTE', approvalNote: 'INTERNAL APPROVAL',
  });
  const invoice = await Invoice.create({
    invoiceNo: `INV-${contractNo}`, customer: customer._id, dueDate: end, total: 1000, subTotal: 1000, status: 'sent',
    zohoBooksSyncId: 'SECRET-ZOHO',
  });
  const payment = await Payment.create({ contract: contract._id, invoice: invoice._id, amount: 500, dueDate: start, paidDate: start, status: 'paid', method: 'card' });
  return { customer, unit, contract, invoice, payment };
}

test('login: wrong code is rejected and attempts are capped', async () => {
  const otp = await request(app).post('/api/customer-auth/request-otp').send({ phone: '+971501110000' });
  const wrong = otp.body.code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i += 1) {
    const r = await request(app).post('/api/customer-auth/verify-otp').send({ phone: '+971501110000', code: wrong });
    assert.equal(r.status, 401);
  }
  // Sixth try — even the correct code no longer works.
  const locked = await request(app).post('/api/customer-auth/verify-otp').send({ phone: '+971501110000', code: otp.body.code });
  assert.equal(locked.status, 429);
});

test('login: the email on file logs the tenant straight into their units', async () => {
  const t = await seedTenant('+971506663333', 'C-8');
  await Customer.updateOne({ _id: t.customer._id }, { email: 'Eight@Example.com' });

  const otp = await request(app).post('/api/customer-auth/request-otp').send({ identifier: 'eight@example.com' });
  assert.equal(otp.status, 200);
  assert.equal(otp.body.channel, 'email');
  assert.match(otp.body.sentTo, /^Ei•+@Example\.com$/);

  // A phone code can't answer an email login.
  const asPhone = await request(app).post('/api/customer-auth/verify-otp').send({ phone: '+971506663333', code: otp.body.code });
  assert.equal(asPhone.status, 401);

  const res = await request(app).post('/api/customer-auth/verify-otp').send({ identifier: 'EIGHT@example.com', code: otp.body.code });
  assert.equal(res.status, 200);
  assert.equal(res.body.isNew, false);
  assert.equal(String(res.body.customer.id), String(t.customer._id));

  const contracts = await request(app).get('/api/customer-portal/storage/contracts').set({ Authorization: `Bearer ${res.body.token}` });
  assert.deepEqual(contracts.body.map((c) => c.contractNo), ['C-8']);
});

test('login: an email we do not hold is turned away, and creates nobody', async () => {
  const r = await request(app).post('/api/customer-auth/request-otp').send({ identifier: 'nobody@example.com' });
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'unknown_email');
  assert.equal(await Customer.countDocuments(), 0);
});

test('login: a phone shared with a prospect record opens the tenant', async () => {
  await Customer.create({ fullName: 'Old prospect', phone: '+971506664444', phones: ['+971506664444'], stage: 'prospect' });
  const t = await seedTenant('0506664444', 'C-9');
  const a = await login('+971506664444');
  assert.equal(String(a.customer.id), String(t.customer._id));
});

test('login: a number staff typed with spaces or dashes is still recognised', async () => {
  const t = await seedTenant('050-666 5555', 'C-10');
  const a = await login('+971506665555');
  assert.equal(a.isNew, false);
  assert.equal(String(a.customer.id), String(t.customer._id));
  // Same last digits, different country: not the same person.
  const other = await login('+447506665555');
  assert.equal(other.isNew, true);
});

test('login: a doubled +971 or stray spaces still reach the tenant, and create nobody', async () => {
  const t = await seedTenant('+971 50 666 4444', 'C-11');
  for (const typed of ['  +971 50 666 4444  ', '+971 +971 50 666 4444', '+971971506664444', '+971 0506664444']) {
    await CustomerOtp.deleteMany({});
    const a = await login(typed);
    assert.equal(a.isNew, false, `${JSON.stringify(typed)} finds the tenant`);
    assert.equal(String(a.customer.id), String(t.customer._id));
  }
  assert.equal(await Customer.countDocuments(), 1);
});

test('me: a login stuck on an empty record moves onto the tenant renting on that number', async () => {
  // Signed in before the stored spelling was recognised: an empty record with a token for it.
  const stray = await Customer.create({ fullName: 'Zed', phone: '+971506667777', phones: ['+971506667777'], stage: 'prospect' });
  const { signCustomerToken } = await import('../src/routes/customerAuth.js');
  const oldToken = signCustomerToken(stray);
  const t = await seedTenant('+971 50 666 7777', 'C-11');

  const me = await request(app).get('/api/customer-auth/me').set({ Authorization: `Bearer ${oldToken}` });
  assert.equal(me.status, 200);
  assert.equal(String(me.body.customer.id), String(t.customer._id));
  assert.ok(me.body.token);
  const contracts = await request(app).get('/api/customer-portal/storage/contracts').set({ Authorization: `Bearer ${me.body.token}` });
  assert.deepEqual(contracts.body.map((c) => c.contractNo), ['C-11']);

  // The number now belongs to the tenant alone, so the next login goes straight there.
  assert.equal((await Customer.findById(stray._id)).phone, '');
  const again = await login('+971506667777');
  assert.equal(String(again.customer.id), String(t.customer._id));
});

test('me: a phone typed in after Google sign-in proves nothing and moves nobody', async () => {
  const g = await Customer.create({ fullName: 'G', phone: '+971506668888', googleId: 'g-1', stage: 'prospect' });
  await seedTenant('+971506668888', 'C-12');
  const { signCustomerToken } = await import('../src/routes/customerAuth.js');
  const me = await request(app).get('/api/customer-auth/me').set({ Authorization: `Bearer ${signCustomerToken(g)}` });
  assert.equal(String(me.body.customer.id), String(g._id));
  assert.equal(me.body.token, undefined);
});

test('login: a stored number with a stray leading space, plus an empty record from an earlier login', async () => {
  // As found in the CRM: phone " 0501402556", no phones list.
  const t = await seedTenant('0501402556', 'C-13');
  await Customer.collection.updateOne({ _id: t.customer._id }, { $set: { phone: ' 0501402556', phones: [] } });
  // The empty record an earlier login made when the space hid the match.
  await Customer.create({ fullName: '+971501402556', phone: '+971501402556', phones: ['+971501402556'], stage: 'prospect' });

  const otp = await request(app).post('/api/customer-auth/request-otp').send({ identifier: '+971501402556' });
  const res = await request(app).post('/api/customer-auth/verify-otp').send({ identifier: '+971501402556', code: otp.body.code });
  assert.equal(res.status, 200);
  assert.equal(res.body.customer.fullName, 'Tenant C-13');
});

test('login: spelling variants of one number reach the same customer', async () => {
  await seedTenant('0501234567', 'C-1');
  const a = await login('+971 50 123 4567');
  assert.equal(a.isNew, false);
  assert.equal(await Customer.countDocuments(), 1);
});

test('login: resend inside the cooldown is refused', async () => {
  await request(app).post('/api/customer-auth/request-otp').send({ phone: '+971501110001' });
  const again = await request(app).post('/api/customer-auth/request-otp').send({ phone: '+971501110001' });
  assert.equal(again.status, 429);
});

test('a customer token cannot use staff routes', async () => {
  const { token } = await login('+971501110002');
  const res = await request(app).get('/api/staff-only').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 403);
});

test('home and views never leak internal fields', async () => {
  await seedTenant('+971502220000', 'C-2');
  const { token } = await login('+971502220000');
  const auth = { Authorization: `Bearer ${token}` };

  const home = await request(app).get('/api/customer-portal/storage/home').set(auth);
  assert.equal(home.status, 200);
  assert.equal(home.body.primaryContract.contractNo, 'C-2');
  assert.equal(home.body.outstanding.total, 1000);
  const raw = JSON.stringify(home.body);
  for (const secret of ['INTERNAL NOTE', 'INTERNAL APPROVAL', 'SECRET-ZOHO', 'approvalNote', 'zohoBooks']) {
    assert.ok(!raw.includes(secret), `leaked ${secret}`);
  }
  assert.ok(home.body.primaryContract.nextPaymentDate, 'next payment is computed');
});

test('a customer cannot read another customer’s contract, invoice, receipt or pay for them', async () => {
  const a = await seedTenant('+971503330000', 'C-A');
  await seedTenant('+971504440000', 'C-B');
  const { token } = await login('+971504440000');
  const auth = { Authorization: `Bearer ${token}` };
  const base = '/api/customer-portal/storage';

  for (const path of [
    `/contracts/${a.contract._id}`, `/contracts/${a.contract._id}/pdf`,
    `/invoices/${a.invoice._id}`, `/invoices/${a.invoice._id}/pdf`,
    `/payments/${a.payment._id}/receipt`,
  ]) {
    const r = await request(app).get(`${base}${path}`).set(auth);
    assert.equal(r.status, 404, `${path} should be hidden`);
  }
  const pay = await request(app).post(`${base}/invoices/${a.invoice._id}/pay`).set(auth);
  assert.ok([404, 503].includes(pay.status), 'cannot start a payment for someone else');
  const change = await request(app).post(`${base}/contracts/${a.contract._id}/checkout-change`).set(auth).send({ action: 'extend', months: 6 });
  assert.equal(change.status, 404);

  const list = await request(app).get(`${base}/invoices`).set(auth);
  assert.deepEqual(list.body.map((i) => i.invoiceNo), ['INV-C-B']);
  const docs = await request(app).get(`${base}/documents`).set(auth);
  assert.deepEqual(docs.body.agreements.map((d) => d.title), ['C-B']);
  assert.equal(docs.body.receipts.length, 1);
});

test('check-out change: validates, records a pending request and blocks duplicates', async () => {
  const t = await seedTenant('+971505550000', 'C-3');
  const { token } = await login('+971505550000');
  const auth = { Authorization: `Bearer ${token}` };
  const url = `/api/customer-portal/storage/contracts/${t.contract._id}/checkout-change`;

  assert.equal((await request(app).post(url).set(auth).send({ action: 'extend', months: 5 })).status, 400);
  assert.equal((await request(app).post(url).set(auth).send({ action: 'move_out_early', date: '2000-01-01' })).status, 400);
  const farFuture = new Date(Date.now() + 900 * 86_400_000).toISOString();
  assert.equal((await request(app).post(url).set(auth).send({ action: 'move_out_early', date: farFuture })).status, 400);

  const ok = await request(app).post(url).set(auth).send({ action: 'extend', months: 6 });
  assert.equal(ok.status, 201);
  assert.equal(await CustomerRequest.countDocuments({ status: 'pending' }), 1);
  const refreshed = await Contract.findById(t.contract._id);
  assert.ok(refreshed.timeline.some((e) => e.text.includes('Tenant requested via app')));
  assert.equal(new Date(refreshed.endDate).getTime(), new Date(t.contract.endDate).getTime(), 'end date is not changed by a request');

  const dup = await request(app).post(url).set(auth).send({ action: 'extend', months: 12 });
  assert.equal(dup.status, 409);
});

test('link-unit: code goes to the agreement’s phone and moves the login to the tenant', async () => {
  const t = await seedTenant('+971506660000', 'C-4');
  const { token } = await login('+971507770000', 'Visitor'); // a different number, brand-new prospect
  const auth = { Authorization: `Bearer ${token}` };
  const base = '/api/customer-portal/storage/link-unit';

  const missing = await request(app).post(`${base}/request`).set(auth).send({ contractNo: 'NOPE' });
  assert.equal(missing.status, 404);

  const req1 = await request(app).post(`${base}/request`).set(auth).send({ contractNo: 'C-4' });
  assert.equal(req1.status, 200);
  assert.equal(req1.body.maskedPhone, '••• 000');

  const bad = await request(app).post(`${base}/confirm`).set(auth).send({ contractNo: 'C-4', code: '999999' === req1.body.code ? '123456' : '999999' });
  assert.equal(bad.status, 401);

  const done = await request(app).post(`${base}/confirm`).set(auth).send({ contractNo: 'C-4', code: req1.body.code });
  assert.equal(done.status, 200);
  assert.equal(String(done.body.customer.id), String(t.customer._id));

  // The visitor's number now resolves to exactly one customer: the tenant.
  const again = await login('+971507770000');
  assert.equal(again.isNew, false);
  assert.equal(String(again.customer.id), String(t.customer._id));
  const owner = await request(app).get('/api/customer-portal/storage/contracts').set({ Authorization: `Bearer ${again.token}` });
  assert.deepEqual(owner.body.map((c) => c.contractNo), ['C-4']);
});

test('link-unit: the tenant’s phone on file finds their account', async () => {
  const t = await seedTenant('0506661111', 'C-6');
  const { token } = await login('+971507771111', 'Visitor');
  const auth = { Authorization: `Bearer ${token}` };
  const base = '/api/customer-portal/storage/link-unit';

  const unknown = await request(app).post(`${base}/request`).set(auth).send({ identifier: '+971500000000' });
  assert.equal(unknown.status, 404);

  const r = await request(app).post(`${base}/request`).set(auth).send({ identifier: '+971 50 666 1111' });
  assert.equal(r.status, 200);
  assert.equal(r.body.channel, 'phone');
  assert.equal(r.body.sentTo, '••• 111');

  const done = await request(app).post(`${base}/confirm`).set(auth).send({ identifier: '+971 50 666 1111', code: r.body.code });
  assert.equal(done.status, 200);
  assert.equal(String(done.body.customer.id), String(t.customer._id));
});

test('link-unit: the tenant’s email on file finds their account, case-insensitively', async () => {
  const t = await seedTenant('+971506662222', 'C-7');
  await Customer.updateOne({ _id: t.customer._id }, { email: 'Tenant.Seven@Example.com' });
  // A prospect sharing the email but renting nothing must not be picked.
  await Customer.create({ fullName: 'Dup', email: 'tenant.seven@example.com', phone: '', stage: 'prospect' });
  const { token } = await login('+971507772222', 'Visitor');
  const auth = { Authorization: `Bearer ${token}` };
  const base = '/api/customer-portal/storage/link-unit';

  const r = await request(app).post(`${base}/request`).set(auth).send({ identifier: 'tenant.seven@example.com' });
  assert.equal(r.status, 200);
  assert.equal(r.body.channel, 'email');
  assert.match(r.body.sentTo, /^Te•+@Example\.com$/);

  const wrong = await request(app).post(`${base}/confirm`).set(auth).send({ identifier: 'tenant.seven@example.com', code: r.body.code === '000000' ? '111111' : '000000' });
  assert.equal(wrong.status, 401);
  const done = await request(app).post(`${base}/confirm`).set(auth).send({ identifier: 'TENANT.SEVEN@example.com', code: r.body.code });
  assert.equal(done.status, 200);
  assert.equal(String(done.body.customer.id), String(t.customer._id));
});

test('link-unit: an agreement already on your account is a conflict', async () => {
  await seedTenant('+971508880000', 'C-5');
  const { token } = await login('+971508880000');
  const r = await request(app).post('/api/customer-portal/storage/link-unit/request').set({ Authorization: `Bearer ${token}` }).send({ contractNo: 'C-5' });
  assert.equal(r.status, 409);
});
