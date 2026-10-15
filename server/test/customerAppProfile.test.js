import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Contract, Customer, CustomerOtp, Document, Invoice, Unit } from '../src/models/index.js';
import customerAuthRouter from '../src/routes/customerAuth.js';
import customerProfileRouter from '../src/routes/customerProfile.js';
import customerFilesRouter from '../src/routes/customerFiles.js';
import customerAutopayRouter from '../src/routes/customerAutopay.js';
import { settleInvoiceFromIntent } from '../src/services/cardPayments.js';

/**
 * The customer app's "Complete your profile", authorised persons, ID uploads and saved-card / auto-pay settings.
 * Stripe is never called: cards are faked straight onto the customer record, and Stripe's webhook payload is faked
 * where a payment is credited.
 */
let mongod, app;
const MODELS = [Contract, Customer, CustomerOtp, Document, Invoice, Unit];

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret';
  delete process.env.WHATSAPP_OTP_TEMPLATE;
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'customer_app_profile_test' });
  await Promise.all(MODELS.map((m) => m.init()));
  app = express();
  app.use(express.json());
  app.use('/api/customer-auth', customerAuthRouter);
  app.use('/api/customer-portal/storage', customerFilesRouter);
  app.use('/api/customer-portal/profile', customerProfileRouter);
  app.use('/api/customer-portal/autopay', customerAutopayRouter);
}, { timeout: 240000 });

after(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all(MODELS.map((m) => m.deleteMany({})));
});

async function login(phone) {
  const otp = await request(app).post('/api/customer-auth/request-otp').send({ phone });
  const res = await request(app).post('/api/customer-auth/verify-otp').send({ phone, code: otp.body.code });
  assert.equal(res.status, 200);
  return { token: res.body.token, id: res.body.customer.id };
}
const as = (token) => ({ Authorization: `Bearer ${token}` });

async function seedContract(customerId, no = 'C-1') {
  const unit = await Unit.create({ unitNumber: `U-${no}`, sizeSqf: 50 });
  return Contract.create({
    contractNo: no, customer: customerId, unit: unit._id, billingPeriod: 'monthly', rate: 1000,
    startDate: new Date(Date.now() - 10 * 86_400_000), endDate: new Date(Date.now() + 200 * 86_400_000), status: 'active',
  });
}

test('logging in with a code marks the phone verified and the checklist starts low', async () => {
  const { token } = await login('+971501110001');
  const r = await request(app).get('/api/customer-portal/profile').set(as(token));
  assert.equal(r.status, 200);
  assert.equal(r.body.customer.phoneVerified, true);
  assert.equal(r.body.checklist.items.find((i) => i.key === 'phone').done, true);
  assert.equal(r.body.checklist.items.find((i) => i.key === 'email').done, false);
  assert.ok(r.body.checklist.percent < 50);
});

test('an existing tenant sees what the office holds as done, and is only asked for what is missing', async () => {
  // A tenant staff set up in the CRM: email, ID filed against the contract, no app activity yet.
  const tenant = await Customer.create({
    fullName: 'Layla Haddad', phone: '+971501110009', phones: ['+971501110009'], email: 'layla@example.ae',
    nationality: 'UAE', address: 'Villa 7, Jumeirah 1', stage: 'customer',
  });
  const contract = await seedContract(tenant._id, 'C-CRM');
  await Document.create({ contract: contract._id, name: 'EID', type: 'id_proof', source: 'staff', url: 'x' });
  const { token } = await login('+971501110009');

  const r = await request(app).get('/api/customer-portal/profile').set(as(token));
  assert.equal(r.status, 200);
  const todo = r.body.checklist.items.filter((i) => !i.done).map((i) => i.key);
  assert.deepEqual(todo, ['access', 'emergency'], 'email, WhatsApp and ID come from the office record');
  assert.equal(r.body.customer.email, 'layla@example.ae', 'the app form opens with what we hold');
});

test('email: a code sent to the address verifies it; a wrong code does not', async () => {
  const { token, id } = await login('+971501110002');
  const ask = await request(app).post('/api/customer-portal/profile/email/request').set(as(token)).send({ email: 'Sara@Example.com' });
  assert.equal(ask.status, 200);
  assert.match(ask.body.code, /^\d{6}$/);

  const wrong = await request(app).post('/api/customer-portal/profile/email/verify').set(as(token)).send({ email: 'sara@example.com', code: ask.body.code === '000000' ? '111111' : '000000' });
  assert.equal(wrong.status, 401);

  const ok = await request(app).post('/api/customer-portal/profile/email/verify').set(as(token)).send({ email: 'sara@example.com', code: ask.body.code });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.customer.email, 'sara@example.com');
  assert.equal(ok.body.customer.emailVerified, true);
  const stored = await Customer.findById(id).lean();
  assert.equal(stored.emailFromApp, false, 'a verified email may be used to match Zoho invoices');
});

test('email: an invalid address is refused before any code is sent', async () => {
  const { token } = await login('+971501110003');
  const r = await request(app).post('/api/customer-portal/profile/email/request').set(as(token)).send({ email: 'nope' });
  assert.equal(r.status, 400);
});

test('WhatsApp: "same number" records the opt-in; another number needs its own code', async () => {
  const { token, id } = await login('+971501110004');
  const same = await request(app).post('/api/customer-portal/profile/whatsapp/same').set(as(token)).send({});
  assert.equal(same.body.customer.whatsapp.optedIn, true);
  assert.equal(same.body.customer.whatsapp.sameAsPhone, true);

  const ask = await request(app).post('/api/customer-portal/profile/whatsapp/request').set(as(token)).send({ phone: '+971 55 222 3333' });
  assert.equal(ask.status, 200);
  const bad = await request(app).post('/api/customer-portal/profile/whatsapp/verify').set(as(token)).send({ phone: '+971552223333', code: ask.body.code === '000000' ? '111111' : '000000' });
  assert.equal(bad.status, 401);
  const ok = await request(app).post('/api/customer-portal/profile/whatsapp/verify').set(as(token)).send({ phone: '+971552223333', code: ask.body.code });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.customer.whatsapp.sameAsPhone, false);
  assert.equal(ok.body.customer.whatsapp.phone, '+971552223333');
  assert.equal((await Customer.findById(id).lean()).whatsappOptIn.source, 'app');
});

test('details: emergency contact, nationality and address are saved', async () => {
  const { token } = await login('+971501110005');
  const r = await request(app).patch('/api/customer-portal/profile/details').set(as(token)).send({ emergencyNumber: '0501234567', nationality: 'UAE', address: 'Al Quoz, Dubai' });
  assert.equal(r.status, 200);
  assert.equal(r.body.customer.emergencyNumber, '+971501234567');
  assert.equal(r.body.checklist.items.find((i) => i.key === 'details').done, true);
});

test('access: add, refuse a duplicate, list, remove; and nobody else can touch the contract', async () => {
  const a = await login('+971501110006');
  const contract = await seedContract(a.id);
  const url = `/api/customer-portal/storage/contracts/${contract._id}/access`;

  const add = await request(app).post(url).set(as(a.token)).send({ name: 'Omar Khan', phone: '0559998888', relation: 'Driver', idType: 'Emirates ID', idNumber: '784-1990-1234567-1' });
  assert.equal(add.status, 201);
  assert.equal(add.body.people.length, 1);
  assert.equal(add.body.people[0].phone, '+971559998888');
  assert.equal(add.body.people[0].idNumber.startsWith('•••'), true, 'the full ID number is never sent back');

  const dupe = await request(app).post(url).set(as(a.token)).send({ name: 'Omar again', phone: '+971 55 999 8888' });
  assert.equal(dupe.status, 409);

  const b = await login('+971501110007');
  assert.equal((await request(app).get(url).set(as(b.token))).status, 404);
  assert.equal((await request(app).delete(`${url}/0`).set(as(b.token))).status, 404);

  const del = await request(app).delete(`${url}/0`).set(as(a.token));
  assert.equal(del.status, 200);
  assert.equal(del.body.people.length, 0);
  const stored = await Contract.findById(contract._id).lean();
  assert.ok(stored.timeline.some((t) => /added Omar Khan/.test(t.text)) && stored.timeline.some((t) => /removed Omar Khan/.test(t.text)), 'both changes are in the contract history');
});

test('identity: front and back make the ID complete, and it is copied onto the contract', async () => {
  const a = await login('+971501110008');
  const contract = await seedContract(a.id, 'C-2');
  const post = (type, side) => request(app).post('/api/customer-portal/storage/identity').set(as(a.token))
    .field('type', type).field('side', side).attach('file', Buffer.from('fake-image'), { filename: 'id.jpg', contentType: 'image/jpeg' });

  const front = await post('emirates_id', 'front');
  assert.equal(front.status, 201);
  assert.equal(front.body.complete, false);
  const back = await post('emirates_id', 'back');
  assert.equal(back.body.complete, true);
  assert.equal(back.body.attachedToContracts, 1);

  const onContract = await Document.find({ contract: contract._id, type: 'emirates_id' }).lean();
  assert.equal(onContract.length, 2, 'both sides appear on the contract');

  const list = await request(app).get('/api/customer-portal/storage/identity').set(as(a.token));
  assert.equal(list.body.complete, true);
  assert.equal(list.body.documents.filter((d) => d.type === 'emirates_id').length, 2, 'one current file per side, not duplicates from the contract copies');
});

test('identity: only photos and PDFs are accepted', async () => {
  const a = await login('+971501110009');
  const r = await request(app).post('/api/customer-portal/storage/identity').set(as(a.token))
    .field('type', 'passport').field('side', 'page').attach('file', Buffer.from('MZ'), { filename: 'x.exe', contentType: 'application/x-msdownload' });
  assert.equal(r.status, 400);
});

test('auto-pay: needs a saved card, and an explicit consent to switch on', async () => {
  const a = await login('+971501110010');
  const url = '/api/customer-portal/autopay';
  const none = await request(app).get(url).set(as(a.token));
  assert.equal(none.body.card, null);
  assert.equal(none.body.enabled, false);

  const noCard = await request(app).patch(url).set(as(a.token)).send({ enabled: true, consent: true });
  assert.equal(noCard.status, 400);

  await Customer.updateOne({ _id: a.id }, { stripeCustomerId: 'cus_test', 'autopay.paymentMethodId': 'pm_test', 'autopay.brand': 'visa', 'autopay.last4': '4242' });
  const noConsent = await request(app).patch(url).set(as(a.token)).send({ enabled: true });
  assert.equal(noConsent.status, 400);

  const on = await request(app).patch(url).set(as(a.token)).send({ enabled: true, consent: true });
  assert.equal(on.body.enabled, true);
  assert.equal(on.body.card.last4, '4242');
  const stored = await Customer.findById(a.id).lean();
  assert.ok(stored.autopay.consentAt, 'the consent is recorded');
  assert.ok(stored.autopay.consentVersion);

  const off = await request(app).patch(url).set(as(a.token)).send({ enabled: false });
  assert.equal(off.body.enabled, false);
  assert.equal(off.body.card.last4, '4242', 'turning it off keeps the card');

  const gone = await request(app).delete(`${url}/card`).set(as(a.token));
  assert.equal(gone.body.card, null);
});

test('a succeeded PaymentIntent credits the invoice once, even if Stripe delivers it twice', async () => {
  const customer = await Customer.create({ fullName: 'Pay Er', phone: '+971501110011', stage: 'customer', stripeCustomerId: 'cus_x', autopay: { enabled: true, paymentMethodId: 'pm_x', failureCount: 2 } });
  const invoice = await Invoice.create({ invoiceNo: 'INV-T1', customer: customer._id, dueDate: new Date(), total: 1000, subTotal: 1000, status: 'sent', cardFeeEnabled: true, cardFeePct: 3 });
  const intent = { id: 'pi_test_1', amount: 103_000, metadata: { storageInvoiceId: String(invoice._id), invoiceNo: 'INV-T1', amountFils: '100000', feeFils: '3000', feePct: '3', autopay: '1', purpleboxCustomerId: String(customer._id) } };

  await settleInvoiceFromIntent(intent);
  await settleInvoiceFromIntent(intent);

  const paid = await Invoice.findById(invoice._id).lean();
  assert.equal(paid.paymentMade, 1000, 'only what was owed is credited, not the card fee, and not twice');
  assert.equal(paid.status, 'paid');
  assert.equal(paid.paymentHistory.length, 1);
  assert.match(paid.paymentHistory[0].notes, /automatically by saved card/);
  assert.equal((await Customer.findById(customer._id).lean()).autopay.failureCount, 0, 'a successful charge resets the failure count');
});
