import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { WhatsAppMessage } from '../src/models/index.js';
import whatsappRouter from '../src/routes/whatsapp.js';

let mongod, app, realFetch;
const sentToMeta = [];
// What Meta's template list says right now; a test deletes from it.
let metaTemplates = [];

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-number';
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
  process.env.WHATSAPP_WABA_ID = 'test-waba';
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'whatsapp_window_test' });
  await WhatsAppMessage.init();
  app = express();
  app.use(express.json());
  app.use('/api/whatsapp', whatsappRouter);

  // Meta itself is never reached; what matters is whether we tried.
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/message_templates')) {
      return new Response(JSON.stringify({ data: metaTemplates }), { status: 200 });
    }
    if (String(url).startsWith('https://graph.facebook.com/')) {
      sentToMeta.push(JSON.parse(init?.body || '{}'));
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${sentToMeta.length}` }] }), { status: 200 });
    }
    return realFetch(url, init);
  };
}, { timeout: 240000 });

after(async () => {
  globalThis.fetch = realFetch;
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  sentToMeta.length = 0;
  metaTemplates = [
    { name: 'storage_promo_check_in', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hi! Are you still looking?' }] },
    { name: 'old_promo', language: 'en', status: 'PAUSED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Old' }] },
  ];
  await WhatsAppMessage.deleteMany({});
});

const PHONE = '971501234567';
const inboundHoursAgo = (hours) => WhatsAppMessage.create({
  messageId: `in-${hours}`, phone: PHONE, phoneNormalized: PHONE, direction: 'inbound',
  type: 'text', text: 'hi', occurredAt: new Date(Date.now() - hours * 3600_000),
});

test('typed text after 24 hours is refused before it reaches Meta', async () => {
  await inboundHoursAgo(30);
  const r = await request(app).post('/api/whatsapp/send').send({ to: `+${PHONE}`, body: 'Just following up' });
  assert.equal(r.status, 409);
  assert.equal(r.body.windowClosed, true);
  assert.match(r.body.error, /template/i);
  assert.equal(sentToMeta.length, 0);
  assert.equal(await WhatsAppMessage.countDocuments({ direction: 'outbound' }), 0, 'no failed message left in the thread');
});

test('a quick reply after 24 hours is refused the same way', async () => {
  await inboundHoursAgo(30);
  const r = await request(app).post('/api/whatsapp/send-quick-reply').send({ to: PHONE, templateId: new mongoose.Types.ObjectId() });
  assert.equal(r.status, 409);
  assert.equal(sentToMeta.length, 0);
});

test('inside the window, typed text still goes out', async () => {
  await inboundHoursAgo(30);
  await inboundHoursAgo(2);
  const r = await request(app).post('/api/whatsapp/send').send({ to: PHONE, body: 'Thanks!' });
  assert.equal(r.status, 200);
  assert.equal(sentToMeta.length, 1);
  assert.equal(sentToMeta[0].type, 'text');
});

test('no inbound history on record: left to Meta rather than guessed', async () => {
  const r = await request(app).post('/api/whatsapp/send').send({ to: PHONE, body: 'Hello' });
  assert.equal(r.status, 200);
  assert.equal(sentToMeta.length, 1);
});

test('an approved template still goes out after 24 hours', async () => {
  await inboundHoursAgo(30);
  const r = await request(app).post('/api/whatsapp/send-template').send({ to: PHONE, name: 'storage_promo_check_in', language: 'en', variables: [] });
  assert.equal(r.status, 200);
  assert.equal(sentToMeta.at(-1).type, 'template');
});

test('the console lists only approved templates, and a deleted one drops out', async () => {
  let r = await request(app).get('/api/whatsapp/templates?refresh=1');
  assert.deepEqual(r.body.templates.map((t) => t.name), ['storage_promo_check_in'], 'paused one is not listed');

  metaTemplates = metaTemplates.filter((t) => t.name !== 'storage_promo_check_in');
  r = await request(app).get('/api/whatsapp/templates?refresh=1');
  assert.deepEqual(r.body.templates, []);
});

test('a template deleted in Meta is refused on send, though the cached list still has it', async () => {
  await request(app).get('/api/whatsapp/templates?refresh=1'); // cached while it still exists
  metaTemplates = metaTemplates.filter((t) => t.name !== 'storage_promo_check_in');
  const before = sentToMeta.length;
  const r = await request(app).post('/api/whatsapp/send-template').send({ to: PHONE, name: 'storage_promo_check_in', language: 'en', variables: [] });
  assert.equal(r.status, 410);
  assert.equal(r.body.templateGone, true);
  assert.equal(sentToMeta.length, before);
});

test('sending a template that is no longer approved is refused', async () => {
  const r = await request(app).post('/api/whatsapp/send-template').send({ to: PHONE, name: 'old_promo', language: 'en', variables: [] });
  assert.equal(r.status, 400);
  assert.equal(r.body.templateGone, true);
});
