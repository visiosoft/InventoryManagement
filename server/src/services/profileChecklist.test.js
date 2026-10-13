import test from 'node:test';
import assert from 'node:assert/strict';
import { profileChecklist, whatsappNumberFor, validEmail } from './profileChecklist.js';

test('a brand-new customer has everything still to do', () => {
  const r = profileChecklist({ phone: '+971501234567' }, { hasContract: false });
  assert.equal(r.done, 0);
  assert.equal(r.percent, 0);
  assert.ok(!r.items.some((i) => i.key === 'access'), 'no access-people step before there is a contract');
});

test('logging in with a code verifies the phone; email only counts once verified', () => {
  const r = profileChecklist({ phoneVerifiedAt: new Date(), email: 'a@b.ae' }, {});
  assert.equal(r.items.find((i) => i.key === 'phone').done, true);
  assert.equal(r.items.find((i) => i.key === 'email').done, false);
  const v = profileChecklist({ phoneVerifiedAt: new Date(), email: 'a@b.ae', emailVerifiedAt: new Date() }, {});
  assert.equal(v.items.find((i) => i.key === 'email').done, true);
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
