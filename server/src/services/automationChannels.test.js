import test from 'node:test';
import assert from 'node:assert/strict';
import { pickChannels, templateFor, dubaiDayRange, sentCutoff, unreachableReason } from './automationEngine.js';

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

/* ── the same-day guard's day boundary ──────────────────────────────────────
   alreadySentToday() (services/automationEngine.js) reuses this range to
   decide "did this contract already get this rule, on this channel, today" —
   this is the part of that decision that can be tested without a database:
   does "today" actually mean the Dubai day, not a UTC one. */

test('a run just after Dubai midnight is inside today\'s range, not still in yesterday\'s', () => {
  // 2026-03-05 00:05 Dubai time = 2026-03-04 20:05 UTC.
  const justAfterMidnight = new Date('2026-03-04T20:05:00.000Z');
  const { start, end } = dubaiDayRange(justAfterMidnight);
  assert.ok(justAfterMidnight >= start && justAfterMidnight < end);
  // Dubai midnight itself is 20:00 UTC the day before.
  assert.equal(start.toISOString(), '2026-03-04T20:00:00.000Z');
});

test('a run just before Dubai midnight is inside today\'s range, not already tomorrow\'s', () => {
  // 2026-03-05 23:55 Dubai time = 2026-03-05 19:55 UTC.
  const justBeforeMidnight = new Date('2026-03-05T19:55:00.000Z');
  const { start, end } = dubaiDayRange(justBeforeMidnight);
  assert.ok(justBeforeMidnight >= start && justBeforeMidnight < end);
  assert.equal(end.toISOString(), '2026-03-05T20:00:00.000Z');
});

test('the range is exactly one day wide, so a second run 6 hours later is still caught', () => {
  const { start, end } = dubaiDayRange(new Date('2026-03-05T08:00:00.000Z'));
  assert.equal(end.getTime() - start.getTime(), 24 * 60 * 60 * 1000);
});

/* ── sentCutoff: "start fresh" resets vs. a recurring window ────────────────
   alreadySent() uses this to decide how far back a log still blocks a step.
   Getting "both must hold" wrong in either direction either lets a reset
   silently un-block a send nobody asked to reset, or leaves a reset unable
   to do anything at all — both are the kind of bug that only shows up as an
   unexplained double-send or a permanently stuck queue. */

test('neither recurring nor reset: no bound, so any past send blocks forever', () => {
  assert.equal(sentCutoff({ recurring: { enabled: false, everyDays: 3 }, remindersResetAt: null }), null);
});

test('a reset with no recurring window: the cutoff is exactly the reset moment', () => {
  const resetAt = new Date('2026-03-01T00:00:00.000Z');
  const cutoff = sentCutoff({ recurring: { enabled: false, everyDays: 3 }, remindersResetAt: resetAt });
  assert.equal(cutoff.getTime(), resetAt.getTime());
});

test('recurring with no reset: the cutoff is everyDays back from now', () => {
  const now = new Date('2026-03-10T00:00:00.000Z');
  const cutoff = sentCutoff({ recurring: { enabled: true, everyDays: 5 }, remindersResetAt: null, now });
  assert.equal(cutoff.getTime(), now.getTime() - 5 * 24 * 60 * 60 * 1000);
});

test('a reset older than the recurring window changes nothing — the window still wins', () => {
  const now = new Date('2026-03-10T00:00:00.000Z');
  const oldReset = new Date('2026-01-01T00:00:00.000Z');
  const cutoff = sentCutoff({ recurring: { enabled: true, everyDays: 5 }, remindersResetAt: oldReset, now });
  assert.equal(cutoff.getTime(), now.getTime() - 5 * 24 * 60 * 60 * 1000);
});

test('a reset newer than the recurring window wins — the whole point of resetting', () => {
  const now = new Date('2026-03-10T00:00:00.000Z');
  const freshReset = new Date('2026-03-09T00:00:00.000Z');
  const cutoff = sentCutoff({ recurring: { enabled: true, everyDays: 5 }, remindersResetAt: freshReset, now });
  assert.equal(cutoff.getTime(), freshReset.getTime());
});

test('an approved contract that gets no message says why, in words an admin can act on', () => {
    const rule = { emailEnabled: true, whatsappEnabled: false };
    assert.equal(unreachableReason({ rule, waAllowed: true, waConfigured: true, mailReady: true, phone: '', email: '' }), 'no email address on the customer');
    assert.equal(unreachableReason({ rule, waAllowed: true, waConfigured: true, mailReady: false, phone: '', email: 'a@b.ae' }), 'email is not configured — connect Gmail in Settings');
    assert.equal(unreachableReason({ rule: { emailEnabled: true, whatsappEnabled: true }, waAllowed: false, waConfigured: true, mailReady: true, phone: '9715', email: '' }),
        'no email address on the customer; WhatsApp automation is switched off');
    assert.equal(unreachableReason({ rule: { emailEnabled: false, whatsappEnabled: false }, waAllowed: true, waConfigured: true, mailReady: true, phone: '9715', email: 'a@b.ae' }),
        'both channels are switched off on this rule');
});
