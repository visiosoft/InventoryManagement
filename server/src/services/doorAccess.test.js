import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import { alertsFrom, ingestDoorAlerts, matchByName, methodOf, normalizeAlert, secretMatches } from './doorAccess.js';

// What the terminal sends for a face check that passed (ISAPI JSON).
const FACE = {
   ipAddress: '192.168.1.64', macAddress: 'bc:5e:33:aa:bb:cc', dateTime: '2026-10-26T18:48:03+04:00',
   eventType: 'AccessControllerEvent', eventState: 'active',
   AccessControllerEvent: {
      deviceName: 'Access Controller', majorEventType: 5, subEventType: 75, name: 'Whetu Seymour',
      employeeNoString: '12', serialNo: 1041, currentVerifyMode: 'cardOrFaceOrFp', userType: 'normal',
   },
};
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert version="2.0">
<ipAddress>192.168.1.64</ipAddress><macAddress>bc:5e:33:aa:bb:cc</macAddress>
<dateTime>2026-10-26T18:50:00+04:00</dateTime><eventType>AccessControllerEvent</eventType>
<AccessControllerEvent><deviceName>Access Controller</deviceName><majorEventType>5</majorEventType>
<subEventType>38</subEventType><name>Whetu Seymour</name><employeeNoString>12</employeeNoString>
<serialNo>1042</serialNo><currentVerifyMode>fingerPrint</currentVerifyMode></AccessControllerEvent>
</EventNotificationAlert>`;

test('a face check that passed is read as granted, with who and when', () => {
   const e = normalizeAlert(FACE);
   assert.equal(e.kind, 'granted');
   assert.equal(e.method, 'face');
   assert.equal(e.label, 'Face check passed');
   assert.equal(e.employeeNo, '12');
   assert.equal(e.personName, 'Whetu Seymour');
   assert.equal(e.serialNo, 1041);
   assert.equal(e.at.toISOString(), '2026-10-26T14:48:03.000Z');
   assert.equal(e.device, 'bc:5e:33:aa:bb:cc');
});

test('the XML form of an event is read the same way', () => {
   const [a] = alertsFrom({ body: XML });
   const e = normalizeAlert(a);
   assert.equal(e.kind, 'granted');
   assert.equal(e.method, 'fingerprint');
   assert.equal(e.employeeNo, '12');
   assert.equal(e.serialNo, 1042);
});

test('door events, heartbeats and codes not yet known', () => {
   assert.equal(normalizeAlert({ ...FACE, AccessControllerEvent: { majorEventType: 5, subEventType: 21, serialNo: 9 } }).label, 'Door unlocked');
   assert.equal(normalizeAlert({ eventType: 'heartBeat', dateTime: '2026-10-26T18:00:00+04:00' }), null);
   assert.equal(normalizeAlert({ eventType: 'videoloss' }), null);
   const unknown = normalizeAlert({ ...FACE, AccessControllerEvent: { majorEventType: 5, subEventType: 76, employeeNoString: '12' } });
   assert.equal(unknown.kind, 'other');
   assert.equal(unknown.label, 'Event 5/76', 'kept as it came, not guessed at');
   assert.equal(normalizeAlert({ eventType: 'AccessControllerEvent', AccessControllerEvent: { majorEventType: 5, subEventType: 1, cardNo: '3891' } }).method, 'card');
});

test('how someone was checked, from the verify mode', () => {
   assert.equal(methodOf('cardOrFace'), 'face');
   assert.equal(methodOf('fingerPrint'), 'fingerprint');
   assert.equal(methodOf('card'), 'card');
   assert.equal(methodOf('cardAndPw'), 'card');
   assert.equal(methodOf('pw'), 'pin');
   assert.equal(methodOf('', 0), '');
});

test('the request body: JSON, a multipart field, or a JSON file part — pictures skipped', () => {
   assert.equal(alertsFrom({ body: FACE }).length, 1);
   assert.equal(alertsFrom({ body: { event_log: JSON.stringify(FACE) } }).length, 1);
   assert.equal(alertsFrom({ body: {}, files: [{ mimetype: 'application/json', buffer: Buffer.from(JSON.stringify(FACE)) }, { mimetype: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8]) }] }).length, 1);
   assert.equal(alertsFrom({ body: {} }).length, 0);
   assert.equal(alertsFrom({ body: 'not an event' }).length, 0);
});

test('a real multipart push, as the terminal sends it with its snapshot, is read', async () => {
   const app = express();
   let got = null;
   app.post('/push', multer({ storage: multer.memoryStorage() }).any(), (req, res) => { got = alertsFrom({ body: req.body, files: req.files }); res.json({ ok: true }); });
   await request(app).post('/push')
      .field('event_log', JSON.stringify(FACE))
      .attach('Picture', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { filename: 'face.jpg', contentType: 'image/jpeg' })
      .expect(200);
   assert.equal(got.length, 1);
   assert.equal(normalizeAlert(got[0]).employeeNo, '12');
});

test('a name matches a customer only when exactly one has it', () => {
   const customers = [{ _id: 'c1', fullName: 'Whetu  Seymour' }, { _id: 'c2', fullName: 'Ali Khan' }, { _id: 'c3', fullName: 'ali khan' }];
   assert.equal(matchByName('whetu seymour', customers)?._id, 'c1');
   assert.equal(matchByName('Ali Khan', customers), null, 'two customers share it: an admin decides');
   assert.equal(matchByName('', customers), null);
});

function store({ people = {}, customers = [] } = {}) {
   const events = [];
   const keys = new Set();
   const deps = {
      person: async (no) => people[no] || null,
      customersNamed: async (name) => customers.filter((c) => c.fullName.toLowerCase() === name.toLowerCase()),
      savePerson: async (doc) => { people[doc.employeeNo] = { ...(people[doc.employeeNo] || {}), ...doc }; },
      saveEvent: async (doc) => {
         const k = `${doc.device}:${doc.serialNo}`;
         if (doc.serialNo && keys.has(k)) { const e = new Error('dup'); e.code = 11000; throw e; }
         keys.add(k); events.push(doc);
      },
      seen: async () => {},
   };
   return { events, people, deps };
}

test('events are stored, linked to the customer by name the first time, and kept once', async () => {
   const { events, people, deps } = store({ customers: [{ _id: 'c1', fullName: 'Whetu Seymour' }] });
   const r = await ingestDoorAlerts([FACE, FACE, { eventType: 'heartBeat' }], deps);
   assert.deepEqual(r, { received: 3, saved: 1, duplicates: 1, ignored: 1 });
   assert.equal(events[0].customer, 'c1');
   assert.equal(events[0].label, 'Face check passed');
   assert.deepEqual(people['12'], { employeeNo: '12', name: 'Whetu Seymour', customer: 'c1', matchedBy: 'name' });
});

test('a person an admin linked keeps that customer on every new event', async () => {
   const { events, deps } = store({ people: { 12: { employeeNo: '12', name: 'W. Seymour', customer: 'c9', matchedBy: 'admin' } } });
   await ingestDoorAlerts([FACE], deps);
   assert.equal(events[0].customer, 'c9');
});

test('nobody matching leaves the event unlinked, waiting for an admin', async () => {
   const { events, people, deps } = store({ customers: [] });
   await ingestDoorAlerts([FACE], deps);
   assert.equal(events[0].customer, null);
   assert.equal(people['12'].customer, undefined);
   assert.equal(people['12'].name, 'Whetu Seymour');
});

test('the push address only works with its secret', () => {
   assert.equal(secretMatches('abc123', 'abc123'), true);
   assert.equal(secretMatches('abc124', 'abc123'), false);
   assert.equal(secretMatches('', ''), false);
   assert.equal(secretMatches('abc', 'abc123'), false);
});
