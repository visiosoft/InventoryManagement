import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Lead, MovingLead } from '../src/models/index.js';
import { publicLeadRouter } from '../src/routes/movingLeads.js';

let mongod, app;

before(async () => {
  process.env.NODE_ENV = 'test'; // bypasses the rate limiter, same as publicBooking.test.js
  mongod = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri(), { dbName: 'moving_leads_public_test' });
  await Promise.all([Lead, MovingLead].map((m) => m.init()));
  app = express();
  // Real requests arrive as application/x-www-form-urlencoded (WordPress's
  // admin-ajax.php) — mirror the actual mount in index.js, not express.json().
  app.use(express.urlencoded({ extended: true }));
  app.use('/leads/public', publicLeadRouter);
}, { timeout: 240000 });

after(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all([Lead, MovingLead].map((m) => m.deleteMany({})));
});

// The exact field names and shape from the real purplebox.ae landing page's
// admin-ajax.php POST (action=pbx_submit_reservation).
function landingBody(extra = {}) {
  return {
    action: 'pbx_submit_reservation',
    nonce: '',
    source_page_name: 'Landing - Local Storage Dubai',
    source_page: 'https://purplebox.ae/local-self-storage-units-in-dubai',
    full_name: 'zulfiqar',
    mobile: '+97156464654654',
    email: '',
    emirate: 'Dubai',
    storing_for: 'Local Storage Inquiry',
    move_in_date: 'this-week',
    unit_size: 'locker',
    unit_label: 'Landing Inquiry',
    monthly_rent: '0',
    promo_code: '',
    supplies_total: '0',
    due_today: '0',
    supplies_text: 'No supplies selected',
    summary_text: 'Landing lead submitted\nName: zulfiqar\nPhone: +97156464654654\nStorage size: locker\nTiming: this-week',
    ...extra,
  };
}

test('a landing-page submission creates a real Lead, not a MovingLead', async () => {
  const res = await request(app).post('/leads/public').type('form').send(landingBody()).expect(201);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.id);

  const lead = await Lead.findById(res.body.id);
  assert.ok(lead, 'Lead was created');
  assert.equal(lead.fullName, 'zulfiqar');
  assert.equal(lead.firstName, 'zulfiqar');
  assert.equal(lead.lastName, '');
  assert.equal(lead.phone, '+97156464654654');
  assert.equal(lead.phoneNormalized, '97156464654654');
  assert.equal(lead.source, 'website');
  assert.equal(lead.status, 'new');
  assert.equal(lead.unitsNeeded, 1);
  assert.ok(lead.tags.includes('website'));
  assert.match(lead.notes, /Requested size: locker/);
  assert.match(lead.notes, /Timing: this-week/);
  assert.match(lead.notes, /Emirate: Dubai/);
  assert.equal(lead.timeline.length, 1);
  assert.match(lead.timeline[0].text, /Landing - Local Storage Dubai/);

  assert.equal(await MovingLead.countDocuments(), 0, 'must not also create a MovingLead');
});

test('splits a two-word name into first and last', async () => {
  const res = await request(app).post('/leads/public').type('form').send(landingBody({ full_name: 'Zulfiqar Ali', mobile: '+971500000021' })).expect(201);
  const lead = await Lead.findById(res.body.id);
  assert.equal(lead.firstName, 'Zulfiqar');
  assert.equal(lead.lastName, 'Ali');
  assert.equal(lead.fullName, 'Zulfiqar Ali');
});

test('rejects a submission with no name or no phone', async () => {
  const noName = await request(app).post('/leads/public').type('form').send(landingBody({ full_name: '', mobile: '+971500000022' })).expect(400);
  assert.match(noName.body.error, /full_name/);

  const noPhone = await request(app).post('/leads/public').type('form').send(landingBody({ mobile: '' })).expect(400);
  assert.match(noPhone.body.error, /mobile/);
});

test('the same phone submitting twice reuses the lead instead of duplicating it', async () => {
  const body = landingBody({ mobile: '+971500000023' });
  const first = await request(app).post('/leads/public').type('form').send(body).expect(201);
  assert.equal(first.body.merged, undefined);

  const second = await request(app).post('/leads/public').type('form').send(body).expect(200);
  assert.equal(second.body.merged, true);
  assert.equal(second.body.id, first.body.id);

  assert.equal(await Lead.countDocuments({ phoneNormalized: '971500000023' }), 1);
  const lead = await Lead.findById(first.body.id);
  assert.equal(lead.timeline.length, 2, 'the repeat visit is noted, not silently dropped');
});
