import test from 'node:test';
import assert from 'node:assert/strict';
import { pickChannels, templateFor } from './automationEngine.js';

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

/* ── the approved template ──────────────────────────────────────────────────
   Meta matches parameters by position, so the order of whatsappTemplateVars is
   the order of {{1}}, {{2}} … Getting it wrong sends a customer somebody
   else's contract number, which is why it is checked here rather than trusted. */

const EXPIRY_TPL = {
  key: 'contract_expiring',
  whatsappTemplate: 'contract_expiry_notification',
  whatsappTemplateVars: ['name', 'contractNo', 'unit', 'endDate'],
};
const STEP = { template: 'Contract Expiring Reminder' };
const VARS = {
  name: 'Zulfiqar khan',
  contractNo: 'PB-2026-0346',
  unit: 'Testing Unit - Zul',
  endDate: '31 Aug 2026',
  rate: '450.00',
};

test('a step with no template sends free text, as before', () => {
  assert.deepEqual(templateFor({}, null, VARS), {});
  assert.deepEqual(templateFor({ whatsappTemplate: '   ' }, null, VARS), {});
});

test('the variables fill the placeholders in the order they are named', () => {
  const out = templateFor(STEP, EXPIRY_TPL, VARS);
  assert.equal(out.whatsappTemplate, 'contract_expiry_notification');
  assert.deepEqual(out.whatsappTemplateVars, [
    'Zulfiqar khan', 'PB-2026-0346', 'Testing Unit - Zul', '31 Aug 2026',
  ]);
});

test('language defaults to en rather than to nothing', () => {
  assert.equal(templateFor(STEP, EXPIRY_TPL, VARS).whatsappTemplateLang, 'en');
  assert.equal(templateFor(STEP, { ...EXPIRY_TPL, whatsappTemplateLang: 'ar' }, VARS).whatsappTemplateLang, 'ar');
  assert.equal(templateFor(STEP, { ...EXPIRY_TPL, whatsappTemplateLang: '  ' }, VARS).whatsappTemplateLang, 'en');
});

test('a variable with nothing behind it sends empty, never its own name', () => {
  const out = templateFor(STEP, { ...EXPIRY_TPL, whatsappTemplateVars: ['name', 'missing'] }, VARS);
  assert.deepEqual(out.whatsappTemplateVars, ['Zulfiqar khan', '']);
});

test('a template with no variables is still a template', () => {
  const out = templateFor({}, { whatsappTemplate: 'plain_notice' }, VARS);
  assert.equal(out.whatsappTemplate, 'plain_notice');
  assert.deepEqual(out.whatsappTemplateVars, []);
});

test('every placeholder in the approved body has a variable behind it', () => {
  // Hello {{1}}, your contract *{{2}}* ({{3}}) expires on {{4}}.
  assert.equal(EXPIRY_TPL.whatsappTemplateVars.length, 4);
  const filled = templateFor(STEP, EXPIRY_TPL, VARS).whatsappTemplateVars;
  assert.equal(filled.filter(Boolean).length, 4, 'a placeholder would have gone out blank');
});

test('a step may override the template it was built from', () => {
  const out = templateFor(
    { whatsappTemplate: 'urgent_expiry', whatsappTemplateVars: ['contractNo'] },
    EXPIRY_TPL,
    VARS,
  );
  assert.equal(out.whatsappTemplate, 'urgent_expiry');
  assert.deepEqual(out.whatsappTemplateVars, ['PB-2026-0346']);
});

test('with neither, it stays free text — the behaviour every other trigger keeps', () => {
  assert.deepEqual(templateFor({}, { key: 'welcome' }, VARS), {});
});
