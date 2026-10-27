import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { CallLog, Contract, Customer, Lead, Payment, Unit, User, WhatsAppMessage } from '../src/models/index.js';
import staffAppRouter, { mergeTimeline } from '../src/routes/staffApp.js';

/* The admin's Today and Team screens, and the one-person profile: counted the
   way the web pages count them, and a rep only sees their own people. */

let mongod, app, rep, other, admin;
const DAY = 86_400_000;

before(async () => {
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'staff_app_test' });
  await Promise.all([User, Lead, Contract, Customer, Payment, Unit, WhatsAppMessage, CallLog].map((m) => m.init()));
  rep = await User.create({ name: 'Rep One', email: 'rep1@test.invalid', passwordHash: 'x', role: 'sales_rep' });
  other = await User.create({ name: 'Rep Two', email: 'rep2@test.invalid', passwordHash: 'x', role: 'sales_rep' });
  admin = await User.create({ name: 'Boss', email: 'boss@test.invalid', passwordHash: 'x', role: 'admin' });
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.headers['x-test-user'];
    if (id) req.user = { id: String(id), role: String(req.headers['x-test-role'] || '') };
    next();
  });
  app.use('/staff-app', staffAppRouter);
}, { timeout: 240000 });

after(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

let seq = 0;
function makeLead(extra = {}) {
  seq += 1;
  const digits = String(seq).padStart(7, '0');
  return Lead.create({ fullName: `Lead ${seq}`, phone: `+97150${digits}`, phoneNormalized: `97150${digits}`, unitsNeeded: 1, owner: rep._id, status: 'contacted', ...extra });
}
const as = (u) => (r) => r.set('x-test-user', String(u._id)).set('x-test-role', u.role);

test('the admin screens are admin only', async () => {
  await as(rep)(request(app).get('/staff-app/admin/today')).expect(403);
  await as(rep)(request(app).get('/staff-app/admin/team')).expect(403);
});

test('team: a missed follow-up is an overdue one with no visit ahead, put against its owner', async () => {
  await makeLead({ followUpAt: new Date(Date.now() - 3 * DAY) });
  await makeLead({ followUpAt: new Date(Date.now() - 3 * DAY), siteVisitAt: new Date(Date.now() + DAY) });
  await makeLead({ followUpAt: new Date(Date.now() - 3 * DAY), status: 'lost' });
  await makeLead({ owner: other._id, followUpAt: new Date(Date.now() - 2 * DAY) });

  const res = await as(admin)(request(app).get('/staff-app/admin/team?period=week')).expect(200);
  const one = res.body.rows.find((r) => r.userId === String(rep._id));
  const two = res.body.rows.find((r) => r.userId === String(other._id));
  assert.equal(one.missedFollowUps, 1, 'the visit-booked and the lost lead are not missed');
  assert.equal(two.missedFollowUps, 1);
  assert.ok(!res.body.rows.some((r) => r.userId === String(admin._id)), 'an admin with nothing on their name is not on the team');
});

test('today: leads in, units booked and cash collected today, against yesterday', async () => {
  const unit = await Unit.create({ unitNumber: 'T-1', sizeSqf: 50, floor: 'F1', status: 'occupied', price: 500 });
  const customer = await Customer.create({ fullName: 'Tenant A', phone: '971509999001' });
  const c = await Contract.create({ contractNo: 'C-T1', customer: customer._id, unit: unit._id, billingPeriod: 'monthly', rate: 500, startDate: new Date(), endDate: new Date(Date.now() + 30 * DAY), status: 'active', salesRep: rep._id, totalQuotation: 1500 });
  await Contract.create({ contractNo: 'C-T2', customer: customer._id, unit: unit._id, billingPeriod: 'monthly', rate: 500, startDate: new Date(), endDate: new Date(Date.now() + 30 * DAY), status: 'cancelled', salesRep: rep._id });
  await Payment.create({ contract: c._id, amount: 525, dueDate: new Date(), paidDate: new Date(), status: 'paid' });

  const res = await as(admin)(request(app).get('/staff-app/admin/today')).expect(200);
  assert.equal(res.body.booked.today, 1, 'a cancelled contract is not a booking');
  assert.equal(res.body.booked.list[0].customer, 'Tenant A');
  assert.equal(res.body.booked.list[0].rep, 'Rep One');
  assert.equal(res.body.collected.today, 525);
  assert.ok(res.body.leads.today >= 4);
  assert.ok(res.body.missedFollowUps >= 2);
});

test('person: a rep sees their own lead with its chats and calls in one timeline, not somebody else’s', async () => {
  const mine = await makeLead({ comments: [{ user: rep._id, userName: 'Rep One', text: 'Wants 50 sqft' }] });
  const theirs = await makeLead({ owner: other._id });
  await WhatsAppMessage.create({ phone: mine.phone, phoneNormalized: mine.phoneNormalized, messageId: 'wamid.p1', direction: 'inbound', type: 'text', text: 'Hi, price?', occurredAt: new Date(Date.now() - 3600_000) });
  await CallLog.create({ user: rep._id, phoneNormalized: mine.phoneNormalized, direction: 'outgoing', startedAt: new Date(), durationSec: 120, deviceCallId: 'call-1' });

  // Found however the number is written.
  const res = await as(rep)(request(app).get(`/staff-app/person?phone=0${mine.phoneNormalized.slice(3)}`)).expect(200);
  assert.equal(res.body.leads[0]._id, String(mine._id));
  for (const kind of ['call', 'whatsapp', 'note']) assert.ok(res.body.timeline.some((t) => t.kind === kind), `${kind} is in the timeline`);
  assert.equal(res.body.timeline[0].kind, 'call', 'newest first');
  assert.equal(res.body.lastMessage.mine, false);

  await as(rep)(request(app).get(`/staff-app/person?leadId=${theirs._id}`)).expect(403);
  await as(admin)(request(app).get(`/staff-app/person?leadId=${theirs._id}`)).expect(200);
});

test('person: a tenant is visible to any rep, with contracts and what they owe', async () => {
  const customer = await Customer.create({ fullName: 'Tenant B', phone: '050 999 9002' });
  const unit = await Unit.create({ unitNumber: 'T-2', sizeSqf: 25, floor: 'F1', status: 'occupied', price: 300 });
  const c = await Contract.create({ contractNo: 'C-T3', customer: customer._id, unit: unit._id, billingPeriod: 'monthly', rate: 300, startDate: new Date(Date.now() - 40 * DAY), endDate: new Date(Date.now() + 20 * DAY), status: 'active' });
  await Payment.create({ contract: c._id, amount: 315, dueDate: new Date(Date.now() - 5 * DAY), status: 'pending' });

  const res = await as(other)(request(app).get(`/staff-app/person?customerId=${customer._id}`)).expect(200);
  assert.equal(res.body.customer.fullName, 'Tenant B');
  assert.equal(res.body.contracts[0].unitNumber, 'T-2');
  assert.equal(res.body.money.overdue, 315, 'a pending payment past its date is overdue');
});

test('the timeline says what a media message was and drops empty rows', () => {
  const out = mergeTimeline({
    messages: [{ occurredAt: new Date(2), direction: 'inbound', type: 'image', text: '' }],
    calls: [{ startedAt: new Date(3), direction: 'missed' }],
    leads: [{ timeline: [{ at: new Date(1), text: '' }] }],
  });
  assert.deepEqual(out.map((i) => i.text), ['Missed call', '[Photo]']);
});
