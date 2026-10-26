import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Lead, Task, User, WhatsAppMessage } from '../src/models/index.js';
import leadsRouter from '../src/routes/leads.js';
import { resolveFollowUpOnReply } from '../src/services/followUps.js';

/* A follow-up is done when a person writes to the customer, and the
   follow-up list says why a row is there — the two halves of "the app says
   7 days overdue but I've been chatting with them". */

let mongod, rep, app;
const DAY = 86_400_000;

before(async () => {
  // Never reads .env or connects to an existing database.
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'followup_reply_test' });
  await Promise.all([User, Lead, Task, WhatsAppMessage].map((m) => m.init()));
  rep = await User.create({ name: 'Rep', email: 'rep@test.invalid', passwordHash: 'x', role: 'sales_rep' });
  app = express();
  app.use(express.json());
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
function makeLead(extra = {}) {
  seq += 1;
  const digits = String(seq).padStart(7, '0');
  return Lead.create({
    // A real-length UAE mobile: 971 50 xxx xxxx.
    fullName: `Lead ${seq}`, phone: `+97150${digits}`, phoneNormalized: `97150${digits}`,
    unitsNeeded: 1, owner: rep._id, status: 'contacted', ...extra,
  });
}

test('replying clears a follow-up that was due, matched however the number is written', async () => {
  const lead = await makeLead({ followUpAt: new Date(Date.now() - 2 * DAY) });
  // The same number the local way: 050… instead of 97150….
  const cleared = await resolveFollowUpOnReply(`0${lead.phoneNormalized.slice(3)}`);
  assert.equal(cleared, 1);
  const saved = await Lead.findById(lead._id).lean();
  assert.equal(saved.followUpAt, null);
  assert.match(saved.timeline.at(-1).text, /replied on WhatsApp/);
});

test('a follow-up booked for a later day is a deliberate reminder and is left alone', async () => {
  const later = new Date(Date.now() + 3 * DAY);
  const lead = await makeLead({ followUpAt: later });
  assert.equal(await resolveFollowUpOnReply(lead.phoneNormalized), 0);
  const saved = await Lead.findById(lead._id).lean();
  assert.equal(new Date(saved.followUpAt).getTime(), later.getTime());
});

test('a closed lead is not touched', async () => {
  const lead = await makeLead({ status: 'won', followUpAt: new Date(Date.now() - DAY) });
  assert.equal(await resolveFollowUpOnReply(lead.phoneNormalized), 0);
});

test('the follow-up list leaves out a lead whose site visit is still ahead, and says who wrote last', async () => {
  const visitAhead = await makeLead({ followUpAt: new Date(Date.now() - 3 * DAY), siteVisitAt: new Date(Date.now() + DAY) });
  const late = await makeLead({ followUpAt: new Date(Date.now() - 3 * DAY) });
  await WhatsAppMessage.create({ phone: late.phone, phoneNormalized: late.phoneNormalized, messageId: 'wamid.out1', direction: 'outbound', type: 'text', text: 'Hi', occurredAt: new Date(Date.now() - 2 * DAY) });
  await WhatsAppMessage.create({ phone: late.phone, phoneNormalized: late.phoneNormalized, messageId: 'wamid.in1', direction: 'inbound', type: 'text', text: 'Ok', occurredAt: new Date(Date.now() - DAY) });

  const res = await request(app).get('/leads/follow-ups')
    .set('x-test-user', String(rep._id)).set('x-test-role', 'sales_rep').expect(200);
  const ids = res.body.overdue.map((r) => r._id);
  assert.ok(!ids.includes(String(visitAhead._id)), 'a booked visit is the next step, not an overdue chase');
  const row = res.body.overdue.find((r) => r._id === String(late._id));
  assert.ok(row, 'the genuinely late one is still listed');
  assert.equal(row.lastMessageMine, false, 'the customer wrote last');
  assert.ok(row.lastMessageAt);
});
