import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Lead, User } from '../src/models/index.js';
import leadsRouter from '../src/routes/leads.js';

let mongod, admin, repA, repB, inactiveRep, app;

before(async () => {
  // Never reads .env or connects to an existing database.
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'leads_integration_test' });
  await Promise.all([User, Lead].map((m) => m.init()));
  admin = await User.create({ name: 'Admin', email: 'admin@test.invalid', passwordHash: 'x', role: 'admin' });
  repA = await User.create({ name: 'Rep A', email: 'repa@test.invalid', passwordHash: 'x', role: 'sales_rep' });
  repB = await User.create({ name: 'Rep B', email: 'repb@test.invalid', passwordHash: 'x', role: 'sales_rep' });
  inactiveRep = await User.create({ name: 'Rep C', email: 'repc@test.invalid', passwordHash: 'x', role: 'sales_rep', isActive: false });
  app = express();
  app.use(express.json());
  // Stands in for requireAuth's JWT decode: same req.user shape (id, role),
  // set directly from test headers instead of a real token.
  app.use((req, _res, next) => {
    const id = req.headers['x-test-user'];
    if (id) req.user = { id: String(id), role: String(req.headers['x-test-role'] || '') };
    next();
  });
  app.use('/leads', leadsRouter);
}, { timeout: 240000 });

after(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

let seq = 0;
function makeLead(owner, extra = {}) {
  seq += 1;
  const digits = String(seq).padStart(7, '0');
  return Lead.create({
    fullName: `Test Lead ${seq}`,
    phone: `+9715${digits}`,
    phoneNormalized: `9715${digits}`,
    unitsNeeded: 1,
    owner,
    ...extra,
  });
}

const asAdmin = () => request(app).post('/leads/reassign').set('x-test-user', String(admin._id)).set('x-test-role', 'admin');

test('only an admin may bulk reassign', async () => {
  await request(app).post('/leads/reassign')
    .set('x-test-user', String(repA._id)).set('x-test-role', 'sales_rep')
    .send({ fromOwner: String(repA._id), toOwner: String(repB._id) })
    .expect(403);
});

test('reassigns every one of a rep’s leads and resets the hand-off fields, without touching anyone else’s', async () => {
  const moved1 = await makeLead(repA._id, { assignedAt: new Date('2020-01-01'), ownerSeenAt: new Date(), firstResponseAt: new Date(), autoAssigned: true });
  const moved2 = await makeLead(repA._id);
  const stays = await makeLead(admin._id);

  const res = await asAdmin().send({ fromOwner: String(repA._id), toOwner: String(repB._id) }).expect(200);
  assert.equal(res.body.reassigned, 2);

  const saved1 = await Lead.findById(moved1._id);
  assert.equal(String(saved1.owner), String(repB._id));
  assert.equal(saved1.ownerSeenAt, null);
  assert.equal(saved1.firstResponseAt, null);
  assert.equal(saved1.autoAssigned, false);
  assert.equal(String(saved1.assignedBy), String(admin._id));
  assert.ok(saved1.assignedAt && saved1.assignedAt.getTime() > Date.now() - 10_000);
  assert.match(saved1.timeline.at(-1).text, /Reassigned by/);

  const saved2 = await Lead.findById(moved2._id);
  assert.equal(String(saved2.owner), String(repB._id));

  const untouched = await Lead.findById(stays._id);
  assert.equal(String(untouched.owner), String(admin._id));
});

test('an empty toOwner unassigns the whole batch instead of transferring it', async () => {
  const lead = await makeLead(repA._id);
  const res = await asAdmin().send({ fromOwner: String(repA._id) }).expect(200);
  assert.ok(res.body.reassigned >= 1);
  const saved = await Lead.findById(lead._id);
  assert.equal(saved.owner, null);
  assert.equal(saved.assignedAt, null);
  assert.match(saved.timeline.at(-1).text, /Left unassigned by/);
});

test('a status filter narrows the batch instead of moving the rep’s whole book', async () => {
  const won = await makeLead(repA._id, { status: 'won' });
  const fresh = await makeLead(repA._id, { status: 'new' });
  await asAdmin().send({ fromOwner: String(repA._id), toOwner: String(repB._id), status: 'won' }).expect(200);
  assert.equal(String((await Lead.findById(won._id)).owner), String(repB._id));
  assert.equal(String((await Lead.findById(fresh._id)).owner), String(repA._id));
});

test('rejects a missing fromOwner, an unknown toOwner, the same rep on both sides, and an inactive receiving rep', async () => {
  await asAdmin().send({ toOwner: String(repB._id) }).expect(400);
  await asAdmin().send({ fromOwner: String(repA._id), toOwner: String(repA._id) }).expect(400);
  await asAdmin().send({ fromOwner: String(repA._id), toOwner: new mongoose.Types.ObjectId().toString() }).expect(400);
  await asAdmin().send({ fromOwner: String(repA._id), toOwner: String(inactiveRep._id) }).expect(400);
});

test('a rep with no matching leads reassigns zero without erroring', async () => {
  const lonely = await User.create({ name: 'Nobody’s rep', email: 'lonely@test.invalid', passwordHash: 'x', role: 'sales_rep' });
  const res = await asAdmin().send({ fromOwner: String(lonely._id), toOwner: String(repB._id) }).expect(200);
  assert.equal(res.body.reassigned, 0);
});
