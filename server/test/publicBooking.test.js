import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Unit, Customer, Lead, Quote } from '../src/models/index.js';
import publicBookingRouter from '../src/routes/publicBooking.js';

let mongod, app;

before(async () => {
  process.env.NODE_ENV = 'test'; // bypasses the rate limiter — see its own test below
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'public_booking_test' });
  await Promise.all([Unit, Customer, Lead, Quote].map((m) => m.init()));
  app = express();
  app.use(express.json());
  app.use('/bookings', publicBookingRouter);
}, { timeout: 240000 });

after(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all([Unit, Customer, Lead, Quote].map((m) => m.deleteMany({})));
});

let seq = 0;
function customer(extra = {}) {
  seq += 1;
  return { firstName: 'Test', lastName: `Customer${seq}`, phone: `+9715${String(seq).padStart(7, '0')}`, email: `t${seq}@test.invalid`, sizeSqf: 50, ...extra };
}

test('books the only unit of that size and writes a real Lead + Quote', async () => {
  const unit = await Unit.create({ unitNumber: 'F1-01', sizeSqf: 50, price: 650, status: 'available' });
  const body = customer();

  const res = await request(app).post('/bookings').send(body).expect(201);
  assert.equal(res.body.unitNumber, 'F1-01');
  assert.equal(res.body.sizeSqf, 50);
  assert.equal(res.body.expiresInMinutes, 15);
  assert.ok(res.body.confirmToken);

  const saved = await Unit.findById(unit._id);
  assert.equal(saved.status, 'reserved');

  const lead = await Lead.findOne({ phone: body.phone });
  assert.ok(lead, 'a Lead was created');
  assert.equal(lead.fullName, `${body.firstName} ${body.lastName}`);
  assert.equal(lead.tags?.includes('website_booking'), true);

  const quote = await Quote.findById(res.body.bookingId);
  assert.equal(quote.status, 'sent');
  assert.equal(quote.units[0].unitNumber, 'F1-01');
  assert.equal(quote.publicBooking.token, res.body.confirmToken);
  assert.ok(quote.expiryDate.getTime() > Date.now() && quote.expiryDate.getTime() <= Date.now() + 16 * 60_000);
});

test('reuses an existing customer and lead by phone instead of duplicating them', async () => {
  await Unit.create({ unitNumber: 'F1-02', sizeSqf: 25, price: 350, status: 'available' });
  const body = customer({ sizeSqf: 25 });
  await Customer.create({ fullName: 'Already Here', phone: body.phone, phones: [body.phone] });
  await Lead.create({ firstName: 'Already', lastName: 'Here', fullName: 'Already Here', phone: body.phone, phoneNormalized: body.phone.replace(/\D/g, ''), status: 'new' });

  await request(app).post('/bookings').send(body).expect(201);

  assert.equal(await Customer.countDocuments({ phone: body.phone }), 1);
  assert.equal(await Lead.countDocuments({ phone: body.phone }), 1);
});

test('says plainly when nothing of that size is free, without erroring', async () => {
  await Unit.create({ unitNumber: 'F1-03', sizeSqf: 100, price: 900, status: 'occupied' });
  const res = await request(app).post('/bookings').send(customer({ sizeSqf: 100 })).expect(200);
  assert.equal(res.body.available, false);
  assert.match(res.body.message, /no unit available/i);
});

test('rejects a request missing the required fields', async () => {
  const res = await request(app).post('/bookings').send({ sizeSqf: 25 }).expect(400);
  assert.match(res.body.error, /required/i);
  const res2 = await request(app).post('/bookings').send(customer({ sizeSqf: 0 })).expect(400);
  assert.match(res2.body.error, /sizeSqf/i);
});

test('two concurrent requests for the same single unit never both win it', async () => {
  await Unit.create({ unitNumber: 'F1-04', sizeSqf: 75, price: 800, status: 'available' });
  const [a, b] = await Promise.all([
    request(app).post('/bookings').send(customer({ sizeSqf: 75 })),
    request(app).post('/bookings').send(customer({ sizeSqf: 75 })),
  ]);
  const results = [a, b];
  const won = results.filter((r) => r.status === 201);
  const lost = results.filter((r) => r.status === 200 && r.body.available === false);
  assert.equal(won.length, 1, 'exactly one request claims the unit');
  assert.equal(lost.length, 1, 'the other is told nothing is free, not given the same unit');
});

test('confirm-payment with the right token marks the quote accepted and keeps the unit held', async () => {
  const unit = await Unit.create({ unitNumber: 'F1-05', sizeSqf: 30, price: 400, status: 'available' });
  const created = await request(app).post('/bookings').send(customer({ sizeSqf: 30 })).expect(201);

  const res = await request(app).post(`/bookings/${created.body.bookingId}/confirm-payment`)
    .send({ token: created.body.confirmToken, externalReference: 'pi_test_123' }).expect(200);
  assert.equal(res.body.ok, true);

  const quote = await Quote.findById(created.body.bookingId);
  assert.equal(quote.status, 'accepted');
  assert.ok(quote.publicBooking.confirmedAt);
  assert.equal(quote.publicBooking.externalReference, 'pi_test_123');
  assert.ok(quote.expiryDate.getTime() > Date.now() + 20 * 86_400_000, 'expiry pushed out well past the 15-minute hold');

  const savedUnit = await Unit.findById(unit._id);
  assert.equal(savedUnit.status, 'reserved', 'still held now that it is a real, paid booking');
});

test('confirm-payment with the wrong token is rejected, and the booking is untouched', async () => {
  await Unit.create({ unitNumber: 'F1-06', sizeSqf: 40, price: 500, status: 'available' });
  const created = await request(app).post('/bookings').send(customer({ sizeSqf: 40 })).expect(201);

  await request(app).post(`/bookings/${created.body.bookingId}/confirm-payment`).send({ token: 'not-the-right-token' }).expect(401);

  const quote = await Quote.findById(created.body.bookingId);
  assert.equal(quote.status, 'sent');
  assert.equal(quote.publicBooking.confirmedAt, null);
});

test('confirm-payment after the hold has expired is refused', async () => {
  await Unit.create({ unitNumber: 'F1-07', sizeSqf: 60, price: 700, status: 'available' });
  const created = await request(app).post('/bookings').send(customer({ sizeSqf: 60 })).expect(201);
  await Quote.updateOne({ _id: created.body.bookingId }, { $set: { expiryDate: new Date(Date.now() - 60_000) } });

  const res = await request(app).post(`/bookings/${created.body.bookingId}/confirm-payment`).send({ token: created.body.confirmToken }).expect(410);
  assert.match(res.body.error, /expired/i);
});

test('confirming twice with the right token is harmless, not an error', async () => {
  await Unit.create({ unitNumber: 'F1-08', sizeSqf: 20, price: 300, status: 'available' });
  const created = await request(app).post('/bookings').send(customer({ sizeSqf: 20 })).expect(201);
  await request(app).post(`/bookings/${created.body.bookingId}/confirm-payment`).send({ token: created.body.confirmToken }).expect(200);
  await request(app).post(`/bookings/${created.body.bookingId}/confirm-payment`).send({ token: created.body.confirmToken }).expect(200);
});

test('a made-up booking id is a plain 404, not a crash', async () => {
  await request(app).post(`/bookings/${new mongoose.Types.ObjectId()}/confirm-payment`).send({ token: 'x' }).expect(404);
});

test('the per-IP rate limit kicks in outside the test environment', async () => {
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await Unit.create({ unitNumber: 'F1-09', sizeSqf: 999, price: 1, status: 'available' });
    const attempts = await Promise.all(Array.from({ length: 12 }, () => request(app).post('/bookings').send(customer({ sizeSqf: 999 }))));
    assert.ok(attempts.some((r) => r.status === 429), 'at least one of 12 rapid requests is throttled');
  } finally {
    process.env.NODE_ENV = prevEnv;
  }
});
