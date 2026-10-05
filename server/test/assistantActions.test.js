import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Lead, User } from '../src/models/index.js';
import leadsRouter from '../src/routes/leads.js';

// The two new low-risk assistant tools self-call the app's own API — a real
// fetch() to http://127.0.0.1:<PORT>/api/... — the same thing the confirmed-
// proposal executor does. So this test runs a real listening server on a
// throwaway port rather than mocking fetch: it proves the tool actually
// reaches the real route, not a stand-in for it.
const TEST_PORT = 5099;
process.env.PORT = String(TEST_PORT);

let mongod, server, rep, otherRep, toolByName;

before(async () => {
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'assistant_actions_test' });
  await Promise.all([User, Lead].map((m) => m.init()));
  rep = await User.create({ name: 'Sara Rep', email: 'sara@test.invalid', passwordHash: 'x', role: 'sales_rep' });
  otherRep = await User.create({ name: 'Other Rep', email: 'other@test.invalid', passwordHash: 'x', role: 'sales_rep' });

  const app = express();
  app.use(express.json());
  // selfCall() only ever sends an Authorization header (exactly like the real
  // requireAuth middleware expects a JWT there) — so the test's stand-in
  // reads req.user back out of that same header, JSON-encoded instead of a
  // signed token, rather than a side-channel header selfCall never sends.
  app.use((req, _res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token) { try { req.user = JSON.parse(token); } catch { /* not for this test */ } }
    next();
  });
  app.use('/api/leads', leadsRouter);
  server = await new Promise((resolve) => {
    const s = app.listen(TEST_PORT, () => resolve(s));
  });

  // Registers create_lead/schedule_follow_up into tools.js's registry.
  const [{ toolByName: byName }] = await Promise.all([import('../src/services/assistant/tools.js'), import('../src/services/assistant/actions.js')]);
  toolByName = byName;
}, { timeout: 240000 });

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await mongod?.stop();
});

// A stand-in for a signed JWT: just enough for the test server's own shim
// above to read req.user back out, so the self-call lands authenticated as
// this specific rep — exactly the point being tested.
const authAs = (user) => `Bearer ${JSON.stringify({ id: String(user._id), role: 'sales_rep' })}`;

test('create_lead creates a real lead owned by the asking rep, through the real route', async () => {
  const tool = toolByName('create_lead');
  const out = await tool.run(
    { fullName: 'Ali Hassan', phone: '0501234567', storageSizeValue: 75, durationValue: 6, durationUnit: 'month', notes: 'Al Quoz, moving from JVC' },
    { user: { id: String(rep._id), name: rep.name }, authHeader: authAs(rep) },
  );
  assert.equal(out.error, undefined, out.error);
  assert.ok(out.ok);
  assert.equal(out.name, 'Ali Hassan');
  const saved = await Lead.findById(out.leadId).lean();
  assert.equal(saved.phone, '0501234567');
  assert.equal(String(saved.owner), String(rep._id));
  assert.equal(saved.storageSizeValue, 75);
  assert.equal(saved.notes, 'Al Quoz, moving from JVC');
});

test('create_lead refuses without a name or phone, before ever calling the API', async () => {
  const tool = toolByName('create_lead');
  const out = await tool.run({ fullName: '', phone: '' }, { user: { id: String(rep._id) }, authHeader: authAs(rep) });
  assert.ok(out.error);
});

test('schedule_follow_up finds an existing lead by name and moves its follow-up date', async () => {
  const created = await Lead.create({ fullName: 'Sarah Ahmed', phone: '0509998887', phoneNormalized: '9509998887', unitsNeeded: 1, owner: rep._id });
  const tool = toolByName('schedule_follow_up');
  const out = await tool.run(
    { query: 'Sarah Ahmed', followUpAt: '2030-01-15', note: 'Check if she reserved' },
    { user: { id: String(rep._id) }, authHeader: authAs(rep) },
  );
  assert.equal(out.error, undefined, out.error);
  assert.ok(out.ok);
  const saved = await Lead.findById(created._id).lean();
  assert.equal(new Date(saved.followUpAt).toISOString().slice(0, 10), '2030-01-15');
  assert.equal(saved.followUpNote, 'Check if she reserved');
});

test('schedule_follow_up reports a clear error for a lead nobody can find', async () => {
  const tool = toolByName('schedule_follow_up');
  const out = await tool.run({ query: 'Nobody At All', followUpAt: '2030-01-01' }, { user: { id: String(rep._id) }, authHeader: authAs(rep) });
  assert.match(out.error, /No lead found/);
});

test('schedule_follow_up cannot move a follow-up on a lead owned by a different rep', async () => {
  const created = await Lead.create({ fullName: 'Owned By Other', phone: '0507776655', phoneNormalized: '9507776655', unitsNeeded: 1, owner: otherRep._id });
  const tool = toolByName('schedule_follow_up');
  const out = await tool.run({ query: 'Owned By Other', followUpAt: '2030-02-01' }, { user: { id: String(rep._id) }, authHeader: authAs(rep) });
  assert.ok(out.error);
  const saved = await Lead.findById(created._id).lean();
  assert.equal(saved.followUpAt, null);
});
