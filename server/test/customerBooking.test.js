import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Contract, Customer, CustomerOtp, Document, Invoice, Payment, Quote, Unit } from '../src/models/index.js';
import customerAuthRouter from '../src/routes/customerAuth.js';
import customerBookingRouter from '../src/routes/customerBooking.js';
import { finalizePaidBooking } from '../src/services/appBooking.js';

let mongod, app;
const MODELS = () => [Contract, Customer, CustomerOtp, Document, Invoice, Payment, Quote, Unit];
const BASE = '/api/customer-portal/booking';
const today = () => new Date().toISOString().slice(0, 10);

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret';
  delete process.env.STRIPE_SECRET_KEY;
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'customer_booking_test' });
  await Promise.all(MODELS().map((m) => m.init()));
  app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/customer-auth', customerAuthRouter);
  app.use(BASE, customerBookingRouter);
}, { timeout: 240000 });

after(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all(MODELS().map((m) => m.deleteMany({})));
});

async function login(phone, profile = { fullName: 'Sara Ali', email: 'sara@example.com' }) {
  const otp = await request(app).post('/api/customer-auth/request-otp').send({ phone });
  const res = await request(app).post('/api/customer-auth/verify-otp').send({ phone, code: otp.body.code });
  assert.equal(res.status, 200);
  if (profile) await Customer.updateOne({ _id: res.body.customer.id }, profile);
  return { auth: { Authorization: `Bearer ${res.body.token}` }, id: res.body.customer.id };
}

const seedUnits = (n, extra = {}) => Unit.insertMany(
  Array.from({ length: n }, (_, i) => ({ unitNumber: `S-${i + 1}`, sizeSqf: 50, price: 950, discountPct: 20, status: 'available', ...extra })),
);

test('sizes: lists only what is free, with the amount payable today', async () => {
  await seedUnits(2);
  await Unit.create({ unitNumber: 'M-1', sizeSqf: 100, price: 1600, discountPct: 0, status: 'maintenance' });
  const { auth } = await login('+971501000001');
  const res = await request(app).get(`${BASE}/sizes?startDate=${today()}&months=1`).set(auth);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1, 'the unit under maintenance is not offered');
  assert.equal(res.body[0].sizeSqf, 50);
  assert.equal(res.body[0].available, 2);
  // rent 950 less 20% = 760, refundable advance 950, VAT 5% on the rent only = 38
  assert.equal(res.body[0].payToday, 1748);
});

test('reserve: holds a unit, prices it, and refuses bad input', async () => {
  await seedUnits(1);
  const { auth } = await login('+971501000002');

  const past = await request(app).post(`${BASE}/reserve`).set(auth).send({ sizeSqf: 50, startDate: '2020-01-01', months: 1 });
  assert.equal(past.status, 400);
  const badTerm = await request(app).post(`${BASE}/reserve`).set(auth).send({ sizeSqf: 50, startDate: today(), months: 2 });
  assert.equal(badTerm.status, 400);

  const ok = await request(app).post(`${BASE}/reserve`).set(auth).send({ sizeSqf: 50, startDate: today(), months: 1 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.state, 'held');
  assert.equal(ok.body.pricing.total, 1748);
  assert.equal(ok.body.pricing.cardFee, 52.44);
  assert.equal((await Unit.findOne({ unitNumber: 'S-1' })).status, 'reserved');

  const other = await login('+971501000003');
  const gone = await request(app).post(`${BASE}/reserve`).set(other.auth).send({ sizeSqf: 50, startDate: today(), months: 1 });
  assert.equal(gone.status, 409);
  assert.equal(gone.body.code, 'unavailable');
});

test('reserve: needs a real name and email first', async () => {
  await seedUnits(1);
  const { auth } = await login('+971501000004', null); // name is just the phone number
  const res = await request(app).post(`${BASE}/reserve`).set(auth).send({ sizeSqf: 50, startDate: today(), months: 1 });
  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'profile_incomplete');
  assert.deepEqual(res.body.gaps, { name: true, email: true });
  assert.equal((await Unit.findOne({ unitNumber: 'S-1' })).status, 'available', 'nothing is held for an incomplete profile');
});

test('starting again releases the customer’s earlier unpaid hold', async () => {
  await seedUnits(2);
  const { auth } = await login('+971501000005');
  const first = await request(app).post(`${BASE}/reserve`).set(auth).send({ sizeSqf: 50, startDate: today(), months: 1 });
  const second = await request(app).post(`${BASE}/reserve`).set(auth).send({ sizeSqf: 50, startDate: today(), months: 3 });
  assert.equal(second.status, 201);
  assert.equal((await request(app).get(`${BASE}/${first.body.bookingId}`).set(auth)).body.state, 'expired');
  assert.equal(await Unit.countDocuments({ status: 'reserved' }), 1);
});

test('pay: refuses when Stripe is not configured, and another customer cannot see the booking', async () => {
  await seedUnits(1);
  const { auth } = await login('+971501000006');
  const b = await request(app).post(`${BASE}/reserve`).set(auth).send({ sizeSqf: 50, startDate: today(), months: 1 });
  assert.equal((await request(app).post(`${BASE}/${b.body.bookingId}/pay`).set(auth)).status, 503);

  const stranger = await login('+971501000007');
  assert.equal((await request(app).get(`${BASE}/${b.body.bookingId}`).set(stranger.auth)).status, 404);
  assert.equal((await request(app).post(`${BASE}/${b.body.bookingId}/sign`).set(stranger.auth).send({ signerName: 'X' })).status, 404);
});

test('unpaid bookings cannot be signed', async () => {
  await seedUnits(1);
  const { auth } = await login('+971501000008');
  const b = await request(app).post(`${BASE}/reserve`).set(auth).send({ sizeSqf: 50, startDate: today(), months: 1 });
  const res = await request(app).post(`${BASE}/${b.body.bookingId}/sign`).set(auth).send({ signerName: 'Sara Ali' });
  assert.equal(res.status, 409);
});

test('paid -> contract + invoice -> signed -> active, with no staff step', async () => {
  await seedUnits(1);
  const { auth, id } = await login('+971501000009');
  const b = await request(app).post(`${BASE}/reserve`).set(auth).send({ sizeSqf: 50, startDate: today(), months: 1 });
  const quote = await Quote.findById(b.body.bookingId);

  // What the Stripe webhook does when the card clears.
  quote.stripePaidAt = new Date();
  quote.status = 'accepted';
  await quote.save();
  const done = await finalizePaidBooking(await Quote.findById(quote._id), { sessionId: 'cs_test_1', amount: 1748 });
  assert.ok(done, 'a contract was made');

  const state = await request(app).get(`${BASE}/${quote._id}`).set(auth);
  assert.equal(state.body.state, 'ready_to_sign');
  const resume = await request(app).get(`${BASE}/current`).set(auth);
  assert.equal(resume.body.bookingId, String(quote._id), 'a paid, unsigned booking can be resumed');

  const contract = await Contract.findOne({ customer: id });
  assert.equal(contract.status, 'draft');
  assert.equal(contract.approvalStatus, 'not_required');
  assert.equal((await Unit.findOne({ unitNumber: 'S-1' })).status, 'reserved', 'still ours while unsigned');

  const invoice = await Invoice.findOne({ customer: id });
  assert.equal(invoice.total, 1748);
  assert.equal(invoice.status, 'paid');
  assert.equal(invoice.paymentMade, 1748);
  const rows = await Payment.find({ contract: contract._id });
  assert.ok(rows.length >= 2 && rows.every((p) => p.status === 'paid'), 'schedule rows are all settled');

  // Paying twice (a repeated webhook) must not make a second contract.
  assert.equal(await finalizePaidBooking(await Quote.findById(quote._id), { sessionId: 'cs_test_1', amount: 1748 }), null);
  assert.equal(await Contract.countDocuments({ customer: id }), 1);

  const pdf = await request(app).get(`${BASE}/${quote._id}/contract.pdf`).set(auth);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers['content-type'], /pdf/);

  const noName = await request(app).post(`${BASE}/${quote._id}/sign`).set(auth).send({});
  assert.equal(noName.status, 400);

  const signed = await request(app).post(`${BASE}/${quote._id}/sign`).set(auth).send({ signerName: 'Sara Ali', signMode: 'typed' });
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.equal((await Contract.findById(contract._id)).status, 'active');
  assert.equal((await Unit.findOne({ unitNumber: 'S-1' })).status, 'occupied');
  assert.equal((await request(app).get(`${BASE}/${quote._id}`).set(auth)).body.state, 'active');
  assert.equal((await request(app).get(`${BASE}/current`).set(auth)).body, null, 'nothing left to resume once signed');
}, { timeout: 60000 });

test('paid but the unit was taken meanwhile: flagged for staff, no contract', async () => {
  await seedUnits(1);
  const { auth, id } = await login('+971501000010');
  const b = await request(app).post(`${BASE}/reserve`).set(auth).send({ sizeSqf: 50, startDate: today(), months: 1 });
  const quote = await Quote.findById(b.body.bookingId);
  const unit = await Unit.findOne({ unitNumber: 'S-1' });
  const rival = await Customer.create({ fullName: 'Rival', phone: '+971509999999', phones: ['+971509999999'] });
  await Contract.create({
    contractNo: 'RIVAL-1', customer: rival._id, unit: unit._id, billingPeriod: 'monthly', rate: 950,
    startDate: new Date(), endDate: new Date(Date.now() + 60 * 86_400_000), status: 'active',
  });
  quote.stripePaidAt = new Date();
  quote.status = 'accepted';
  await quote.save();

  assert.equal(await finalizePaidBooking(await Quote.findById(quote._id), { sessionId: 'cs_test_2', amount: 1748 }), null);
  assert.equal(await Contract.countDocuments({ customer: id }), 0);
  const state = await request(app).get(`${BASE}/${quote._id}`).set(auth);
  assert.equal(state.body.state, 'needs_review');
  assert.match(state.body.message, /no longer free/);
});

test('webhook and status check finishing the same payment at once make one contract', async () => {
  await seedUnits(1);
  const { auth, id } = await login('+971501000011');
  const b = await request(app).post(`${BASE}/reserve`).set(auth).send({ sizeSqf: 50, startDate: today(), months: 1 });
  await Quote.updateOne({ _id: b.body.bookingId }, { stripePaidAt: new Date(), status: 'accepted' });
  const [q1, q2] = await Promise.all([Quote.findById(b.body.bookingId), Quote.findById(b.body.bookingId)]);
  const results = await Promise.all([
    finalizePaidBooking(q1, { sessionId: 'cs_race', amount: 1748 }),
    finalizePaidBooking(q2, { sessionId: 'cs_race', amount: 1748 }),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await Contract.countDocuments({ customer: id }), 1);
  assert.equal(await Invoice.countDocuments({ customer: id }), 1);
  const invoice = await Invoice.findOne({ customer: id });
  assert.equal(invoice.paymentMade, 1748, 'the payment is recorded once');
});
