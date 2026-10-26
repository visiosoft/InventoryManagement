/**
 * The door terminal: a Hikvision DS-K1T321MFWX (face, Mifare card,
 * fingerprint) at the facility, pushing every access event to the CRM through
 * its "HTTP Listening" setting. Read-only: nothing here ever talks back to the
 * door.
 *
 * The device posts one event per request, as JSON, as an XML
 * EventNotificationAlert, or as multipart form data with the JSON in one part
 * and the snapshot in another, depending on firmware. All three are read. It
 * also posts heartbeats, which are dropped, and resends what it stored while
 * the internet was down, which the unique (device, serialNo) index keeps once.
 *
 * Who is who: the device knows a person by the ID they were enrolled under
 * (employeeNo) and a name. The first time a name matches exactly one customer
 * it is linked by itself; anything else waits for an admin to link it, and
 * every later event from that ID carries the customer.
 */

import crypto from 'crypto';
import { Customer, DoorConfig, DoorEvent, DoorPerson } from '../models/index.js';

/*
 * What a code means. Major 5 is an access event. Confirmed against devices
 * in the field: 75 face authentication passed, 21 door unlocked, 22 door
 * locked, 25–28 the door's own state. 1 (card passed) and 38 (fingerprint
 * passed) are Hikvision's long-standing codes for the same family. Anything
 * else is kept as it came — "Event 5/76" — rather than guessed at, and named
 * here once real events show what it is.
 */
const PASSED = { 1: 'card', 38: 'fingerprint', 75: 'face' };
const DOOR = { 21: 'Door unlocked', 22: 'Door locked', 25: 'Door open', 26: 'Door closed', 27: 'Door opened abnormally', 28: 'Door left open too long' };
const METHOD_LABEL = { face: 'Face', card: 'Card', fingerprint: 'Fingerprint', pin: 'PIN' };

/** How someone was checked, from the device's verify mode ("cardOrFace", "fingerPrint"...) or the code. */
export function methodOf(verifyMode = '', sub = 0) {
   if (PASSED[sub]) return PASSED[sub];
   const m = String(verifyMode).toLowerCase();
   if (m.includes('face')) return 'face';
   if (m.includes('finger') || m === 'fp') return 'fingerprint';
   if (m.includes('card')) return 'card';
   if (m.includes('pw') || m.includes('pass') || m.includes('pin')) return 'pin';
   return '';
}

/* ── Reading what the device sent ─────────────────────────────────────────── */

/** The fields of an XML EventNotificationAlert that matter, read without an XML library. */
function fromXml(xml) {
   const tag = (name) => {
      const m = new RegExp(`<${name}>([^<]*)</${name}>`, 'i').exec(xml);
      return m ? m[1].trim() : undefined;
   };
   const ev = {};
   for (const k of ['deviceName', 'majorEventType', 'subEventType', 'name', 'employeeNoString', 'employeeNo', 'cardNo', 'serialNo', 'currentVerifyMode', 'serialNumber']) {
      const v = tag(k);
      if (v !== undefined) ev[k] = v;
   }
   return {
      eventType: tag('eventType'), dateTime: tag('dateTime'), ipAddress: tag('ipAddress'), macAddress: tag('macAddress'),
      AccessControllerEvent: ev,
   };
}

/** One candidate payload (object, JSON text or XML text) as an alert object, or null. */
function asAlert(x) {
   if (!x) return null;
   if (Buffer.isBuffer(x)) x = x.toString('utf8');
   if (typeof x === 'object') return x.eventType || x.AccessControllerEvent ? x : null;
   const t = String(x).trim();
   if (t.startsWith('{')) {
      try { return asAlert(JSON.parse(t)); } catch { return null; }
   }
   if (t.startsWith('<')) return /EventNotificationAlert|AccessControllerEvent/i.test(t) ? fromXml(t) : null;
   return null;
}

/**
 * Every alert in a request: the body itself, or — for multipart — whichever
 * fields and parts hold one. `files` are multer's parts; pictures are skipped.
 */
export function alertsFrom({ body, files = [] } = {}) {
   const out = [];
   const direct = asAlert(body);
   if (direct) out.push(direct);
   else if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      for (const v of Object.values(body)) { const a = asAlert(v); if (a) out.push(a); }
   }
   for (const f of files || []) {
      if (/image\//i.test(f.mimetype || '')) continue;
      const a = asAlert(f.buffer);
      if (a) out.push(a);
   }
   return out;
}

/** An alert as the event we keep, or null for a heartbeat or anything that is not an access event. */
export function normalizeAlert(alert) {
   if (!alert) return null;
   const type = String(alert.eventType || '');
   if (/heart/i.test(type)) return null;
   const ev = alert.AccessControllerEvent || {};
   if (!type && !alert.AccessControllerEvent) return null;
   if (type && !/AccessController/i.test(type)) return null;
   const major = Number(ev.majorEventType) || 0;
   const sub = Number(ev.subEventType) || 0;
   const employeeNo = String(ev.employeeNoString ?? ev.employeeNo ?? '').trim();
   const personName = String(ev.name || '').trim();
   const method = methodOf(ev.currentVerifyMode, sub);
   let kind = 'other';
   let label = `Event ${major}/${sub}`;
   if (major === 5 && PASSED[sub]) { kind = 'granted'; label = `${METHOD_LABEL[PASSED[sub]]} check passed`; }
   else if (major === 5 && DOOR[sub]) { kind = 'door'; label = DOOR[sub]; }
   const at = new Date(alert.dateTime || Date.now());
   return {
      device: String(ev.serialNumber || alert.serialNumber || alert.macAddress || alert.ipAddress || ev.deviceName || 'terminal'),
      at: Number.isNaN(at.getTime()) ? new Date() : at,
      major, sub, kind, method, label,
      employeeNo, personName,
      cardNo: String(ev.cardNo || ''),
      serialNo: Number(ev.serialNo) || 0,
      meta: { ip: alert.ipAddress || '', mac: alert.macAddress || '', name: ev.deviceName || '' },
   };
}

/* ── Who is who ────────────────────────────────────────────────────────────── */

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The one customer whose name is exactly this, or null when none or several are. */
export function matchByName(name, customers = []) {
   const n = norm(name);
   if (!n) return null;
   const hits = customers.filter((c) => norm(c.fullName) === n);
   return hits.length === 1 ? hits[0] : null;
}

/* ── Storing ──────────────────────────────────────────────────────────────── */

/**
 * Keep what the device sent. Returns counts. `deps` lets tests run without a
 * database.
 */
export async function ingestDoorAlerts(alerts, deps = {}) {
   const d = {
      person: (employeeNo) => DoorPerson.findOne({ employeeNo }).lean(),
      customersNamed: (name) => Customer.find({ fullName: new RegExp(`^\\s*${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\s*$`, 'i') }).select('_id fullName').lean(),
      savePerson: (doc) => DoorPerson.updateOne({ employeeNo: doc.employeeNo }, { $set: doc }, { upsert: true }),
      saveEvent: (doc) => DoorEvent.create(doc),
      seen: (meta) => DoorConfig.updateOne({}, { $set: { lastEventAt: new Date(), lastDevice: meta } }, { upsert: true }),
      ...deps,
   };
   const out = { received: alerts.length, saved: 0, duplicates: 0, ignored: 0 };
   for (const alert of alerts) {
      const ev = normalizeAlert(alert);
      if (!ev) { out.ignored += 1; continue; }
      let customer = null;
      if (ev.employeeNo) {
         const person = await d.person(ev.employeeNo);
         customer = person?.customer || null;
         if (!person || (!person.customer && person.name !== ev.personName)) {
            const match = !customer && ev.personName ? matchByName(ev.personName, await d.customersNamed(ev.personName)) : null;
            if (match) customer = match._id;
            await d.savePerson({ employeeNo: ev.employeeNo, name: ev.personName || person?.name || '', ...(match ? { customer: match._id, matchedBy: 'name' } : {}) });
         }
      }
      const { meta, ...doc } = ev;
      try {
         await d.saveEvent({ ...doc, customer, raw: alert });
         out.saved += 1;
      } catch (e) {
         if (e?.code === 11000) { out.duplicates += 1; continue; }
         throw e;
      }
      await d.seen({ device: ev.device, ...meta });
   }
   return out;
}

/** The single settings row, with a push secret made the first time it is asked for. */
export async function doorConfig() {
   let c = await DoorConfig.findOne();
   if (!c) c = await DoorConfig.create({});
   if (!c.secret) { c.secret = crypto.randomBytes(18).toString('base64url'); await c.save(); }
   return c;
}

/** Constant-time check of the secret in the push address. */
export function secretMatches(given, secret) {
   const a = Buffer.from(String(given || ''));
   const b = Buffer.from(String(secret || ''));
   return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
