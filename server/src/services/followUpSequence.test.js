import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOutcome, nextStep, nextDateFor, sequenceState, stepCount, DEFAULT_STEPS,
} from './followUpSequence.js';

const PLAN = { steps: DEFAULT_STEPS };
// 2026-08-26 09:00 UTC is 13:00 in Dubai — comfortably mid-afternoon.
const NOW = new Date('2026-08-26T09:00:00.000Z');

const lead = (over = {}) => ({ attempts: [], followUpAt: null, sequenceExhaustedAt: null, ...over });

test('the default plan is three steps', () => {
  assert.equal(stepCount(PLAN), 3);
});

test('the first step is what you do before any attempt has been made', () => {
  assert.equal(nextStep(PLAN, 0).channel, 'whatsapp');
  assert.equal(nextStep(PLAN, 1).channel, 'call');
  assert.equal(nextStep(PLAN, 2).channel, 'voice_note');
});

test('there is no fourth step', () => {
  assert.equal(nextStep(PLAN, 3), null);
  assert.equal(nextStep(PLAN, 9), null);
});

test('an empty plan has no steps to give', () => {
  assert.equal(nextStep({ steps: [] }, 0), null);
  assert.equal(nextStep({}, 0), null);
});

test('the gap counts from today, in Dubai days', () => {
  // One attempt made, so the next is step 2: +2 days.
  assert.equal(nextDateFor(PLAN, 1, NOW), '2026-08-28');
  // Two made, so step 3: +5 days.
  assert.equal(nextDateFor(PLAN, 2, NOW), '2026-08-31');
});

test('a same-day step is today, not tomorrow', () => {
  assert.equal(nextDateFor(PLAN, 0, NOW), '2026-08-26');
});

test('late evening in Dubai still schedules from the local day', () => {
  // 21:00 UTC is 01:00 the next day in Dubai, so "today" is the 27th.
  const lateNight = new Date('2026-08-26T21:00:00.000Z');
  assert.equal(nextDateFor(PLAN, 1, lateNight), '2026-08-29');
});

test('a gap can cross a month boundary', () => {
  const endOfMonth = new Date('2026-08-30T09:00:00.000Z');
  assert.equal(nextDateFor(PLAN, 2, endOfMonth), '2026-09-04');
});

test('a spent plan has no date to offer', () => {
  assert.equal(nextDateFor(PLAN, 3, NOW), '');
});

test('an attempt is numbered from one and records who did what', () => {
  const l = lead();
  const { attempt } = applyOutcome(l, PLAN, { channel: 'call', outcome: 'no_answer', note: 'Rang twice', userId: 'u1', now: NOW });
  assert.equal(attempt.no, 1);
  assert.equal(attempt.channel, 'call');
  assert.equal(attempt.note, 'Rang twice');
  assert.equal(attempt.user, 'u1');
  assert.equal(l.attempts.length, 1);
});

test('no answer books the next attempt from the plan', () => {
  const l = lead();
  const out = applyOutcome(l, PLAN, { outcome: 'no_answer', now: NOW });
  assert.equal(out.exhausted, false);
  // The attempt just made was step 1, so the next is step 2 — +2 days.
  assert.equal(l.followUpAt.toISOString().slice(0, 10), '2026-08-28');
  assert.equal(l.followUpKind, 'date');
});

test('a date the rep picked beats the plan', () => {
  const l = lead();
  applyOutcome(l, PLAN, { outcome: 'no_answer', nextAt: '2026-09-15', now: NOW });
  assert.equal(l.followUpAt.toISOString().slice(0, 10), '2026-09-15');
});

test('moving the date re-arms the reminder', () => {
  const l = lead({ followUpNotifiedAt: new Date('2026-08-01') });
  applyOutcome(l, PLAN, { outcome: 'no_answer', now: NOW });
  assert.equal(l.followUpNotifiedAt, null);
});

test('reaching them ends the chase and suggests Contacted', () => {
  const l = lead({ attempts: [{ no: 1, outcome: 'no_answer' }], followUpAt: new Date('2026-09-01') });
  const out = applyOutcome(l, PLAN, { outcome: 'reached', now: NOW });
  assert.equal(out.suggestStatus, 'contacted');
  assert.equal(l.followUpAt, null);
  assert.equal(out.exhausted, false);
});

test('not interested ends it and suggests Lost', () => {
  const l = lead();
  assert.equal(applyOutcome(l, PLAN, { outcome: 'not_interested', now: NOW }).suggestStatus, 'lost');
  assert.equal(l.followUpAt, null);
});

test('a wrong number is not somebody to keep chasing', () => {
  const l = lead();
  assert.equal(applyOutcome(l, PLAN, { outcome: 'wrong_number', now: NOW }).suggestStatus, 'lost');
});

test('the third silent attempt exhausts the plan rather than closing the lead', () => {
  const l = lead();
  applyOutcome(l, PLAN, { outcome: 'no_answer', now: NOW });
  applyOutcome(l, PLAN, { outcome: 'no_reply', now: NOW });
  const third = applyOutcome(l, PLAN, { outcome: 'no_answer', now: NOW });

  assert.equal(l.attempts.length, 3);
  assert.deepEqual(l.attempts.map((a) => a.no), [1, 2, 3]);
  assert.equal(third.exhausted, true);
  assert.equal(third.suggestStatus, '', 'exhaustion suggests nothing — a person decides');
  assert.equal(l.followUpAt, null);
  assert.equal(l.sequenceExhaustedAt, NOW);
});

test('answering after the plan is spent clears the prompt', () => {
  const l = lead({ attempts: [{ no: 1 }, { no: 2 }, { no: 3 }], sequenceExhaustedAt: NOW });
  applyOutcome(l, PLAN, { outcome: 'reached', now: NOW });
  assert.equal(l.sequenceExhaustedAt, null);
});

test('giving it one more past the end still records the attempt', () => {
  const l = lead({ attempts: [{ no: 1 }, { no: 2 }, { no: 3 }] });
  const out = applyOutcome(l, PLAN, { outcome: 'no_answer', nextAt: '2026-09-20', now: NOW });
  assert.equal(out.attempt.no, 4);
  assert.equal(out.exhausted, false);
  assert.equal(l.followUpAt.toISOString().slice(0, 10), '2026-09-20');
});

test('a very long note is trimmed rather than refused', () => {
  const l = lead();
  const { attempt } = applyOutcome(l, PLAN, { outcome: 'no_answer', note: 'x'.repeat(5000), now: NOW });
  assert.equal(attempt.note.length, 2000);
});

test('the label counts the attempt about to be made', () => {
  assert.equal(sequenceState(lead(), PLAN).label, 'Attempt 1 of 3');
  assert.equal(sequenceState(lead({ attempts: [{ no: 1 }] }), PLAN).label, 'Attempt 2 of 3');
});

test('the label does not run past the end of the plan', () => {
  const l = lead({ attempts: [{ no: 1 }, { no: 2 }, { no: 3 }] });
  assert.equal(sequenceState(l, PLAN).label, 'Attempt 3 of 3');
});

test('the state says what the next attempt should be', () => {
  assert.equal(sequenceState(lead(), PLAN).nextChannel, 'whatsapp');
  assert.equal(sequenceState(lead({ attempts: [{ no: 1 }] }), PLAN).nextChannel, 'call');
  assert.equal(sequenceState(lead({ attempts: [{ no: 1 }, { no: 2 }, { no: 3 }] }), PLAN).nextChannel, '');
});

test('an exhausted sequence says so', () => {
  assert.equal(sequenceState(lead({ sequenceExhaustedAt: NOW }), PLAN).exhausted, true);
  assert.equal(sequenceState(lead(), PLAN).exhausted, false);
});
