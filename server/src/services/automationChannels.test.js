import test from 'node:test';
import assert from 'node:assert/strict';
import { pickChannels } from './automationEngine.js';

// The rule as the built-in Contract Expiry rule actually ships: WhatsApp on,
// email off. Turning this rule on to get its email is what once put messages
// on a channel nobody had asked for.
const SHIPPED_RULE = { whatsappEnabled: true, emailEnabled: false };
const BOTH_ON = { whatsappEnabled: true, emailEnabled: true };

const ready = {
  waConfigured: true,
  mailReady: true,
  phone: '971500000000',
  email: 'tenant@example.com',
};

test('the gate off means no WhatsApp, however the rule is set', () => {
  assert.deepEqual(
    pickChannels({ ...ready, rule: SHIPPED_RULE, waAllowed: false }),
    [],
  );
});

test('the gate off still lets email through', () => {
  assert.deepEqual(
    pickChannels({ ...ready, rule: BOTH_ON, waAllowed: false }),
    ['email'],
  );
});

test('the gate on restores WhatsApp for a rule that wants it', () => {
  assert.deepEqual(
    pickChannels({ ...ready, rule: SHIPPED_RULE, waAllowed: true }),
    ['whatsapp'],
  );
});

test('the gate on does not override a rule with WhatsApp switched off', () => {
  assert.deepEqual(
    pickChannels({ ...ready, rule: { whatsappEnabled: false, emailEnabled: true }, waAllowed: true }),
    ['email'],
  );
});

test('the gate is not a substitute for a configured account', () => {
  assert.deepEqual(
    pickChannels({ ...ready, rule: BOTH_ON, waAllowed: true, waConfigured: false }),
    ['email'],
  );
  assert.deepEqual(
    pickChannels({ ...ready, rule: BOTH_ON, waAllowed: true, mailReady: false }),
    ['whatsapp'],
  );
});

test('a tenant with no phone or no email is not messaged there', () => {
  assert.deepEqual(
    pickChannels({ ...ready, rule: BOTH_ON, waAllowed: true, phone: '' }),
    ['email'],
  );
  assert.deepEqual(
    pickChannels({ ...ready, rule: BOTH_ON, waAllowed: true, email: '' }),
    ['whatsapp'],
  );
});

test('both channels only when the gate, the rule and the account all agree', () => {
  assert.deepEqual(
    pickChannels({ ...ready, rule: BOTH_ON, waAllowed: true }),
    ['whatsapp', 'email'],
  );
});
