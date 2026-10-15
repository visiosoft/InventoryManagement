import test from 'node:test';
import assert from 'node:assert/strict';
import { profileChecklist, whatsappNumberFor, validEmail } from './profileChecklist.js';

test('a brand-new customer has everything still to do', () => {
  const r = profileChecklist({ phone: '+971501234567' }, { hasContract: false });
  assert.equal(r.done, 0);
  assert.equal(r.percent, 0);
  assert.ok(!r.items.some((i) => i.key === 'access'), 'no access-people step before there is a contract');
});

test('logging in with a code verifies the phone; an email typed in the app only counts once verified', () => {
  const r = profileChecklist({ phoneVerifiedAt: new Date(), email: 'a@b.ae', emailFromApp: true }, {});
  assert.equal(r.items.find((i) => i.key === 'phone').done, true);
  assert.equal(r.items.find((i) => i.key === 'email').done, false);
  const v = profileChecklist({ phoneVerifiedAt: new Date(), email: 'a@b.ae', emailFromApp: true, emailVerifiedAt: new Date() }, {});
  assert.equal(v.items.find((i) => i.key === 'email').done, true);
});

test('a tenant the office already holds starts complete: nothing they gave us is asked for again', () => {
  const crm = {
    phone: '+971501234567', email: 'layla@example.ae', emailFromApp: false, emiratesId: '784-1990-1234567-1',
    emergencyNumber: '+971509999999', nationality: 'UAE', address: 'Villa 7, Jumeirah 1',
  };
  const r = profileChecklist(crm, { isTenant: true, hasContract: true, accessCount: 1 });
  assert.deepEqual(r.items.filter((i) => !i.done).map((i) => i.key), []);
  assert.equal(r.percent, 100);
});

test('for a tenant, only what the office is missing is left to do', () => {
  const r = profileChecklist({ phone: '+971501234567' }, { isTenant: true, hasContract: true });
  assert.deepEqual(r.items.filter((i) => !i.done).map((i) => i.key), ['email', 'identity', 'access', 'emergency', 'details']);
});

test('ID on file counts however it got there: a staff upload, or the number on the customer record', () => {
  const id = (c, ctx) => profileChecklist(c, ctx).items.find((i) => i.key === 'identity').done;
  assert.equal(id({}, {}), false);
  assert.equal(id({}, { idOnFile: true }), true);
  assert.equal(id({ passportNumber: 'N1234567' }, {}), true);
  assert.equal(id({}, { idComplete: true }), true);
});

test('people allowed into the unit count from the customer record too', () => {
  const r = profileChecklist({ accessPersons: [{ name: 'Sam' }] }, { hasContract: true, accessCount: 0 });
  assert.equal(r.items.find((i) => i.key === 'access').done, true);
});

test('a new app customer is not treated as a tenant: their phone needs the login code', () => {
  assert.equal(profileChecklist({ phone: '+971501234567' }, { isTenant: false }).items.find((i) => i.key === 'phone').done, false);
});

test('the access step appears for tenants and completes with one person', () => {
  assert.equal(profileChecklist({}, { hasContract: true, accessCount: 0 }).items.find((i) => i.key === 'access').done, false);
  assert.equal(profileChecklist({}, { hasContract: true, accessCount: 1 }).items.find((i) => i.key === 'access').done, true);
});

test('percent rounds from done over total', () => {
  const r = profileChecklist({ phoneVerifiedAt: new Date(), whatsappOptIn: { at: new Date() }, emergencyNumber: '+97150' }, { idComplete: true });
  assert.equal(r.done, 4);
  assert.equal(r.percent, Math.round((4 / r.total) * 100));
});

test('WhatsApp goes to the chosen number only when they said it differs', () => {
  assert.equal(whatsappNumberFor({ phone: '+971501', whatsappSameAsPhone: true, whatsappPhone: '+971502' }), '+971501');
  assert.equal(whatsappNumberFor({ phone: '+971501', whatsappSameAsPhone: false, whatsappPhone: '+971502' }), '+971502');
  assert.equal(whatsappNumberFor({ phone: '+971501', whatsappSameAsPhone: false, whatsappPhone: '' }), '+971501');
});

test('email check', () => {
  assert.equal(validEmail('a@b.ae'), true);
  assert.equal(validEmail('nope'), false);
});
