import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKeyFor, dayRange, previousDay, localHour, orderChats, TZ_OFFSET_HOURS } from './dailyDigest.js';

/* The day boundary. Every figure in the report is scoped by this, so if it is
   wrong the whole page is quietly wrong rather than visibly broken. Dubai is
   UTC+4 unless DIGEST_TZ_OFFSET_HOURS says otherwise. */

test('the offset is Dubai unless told otherwise', () => {
  assert.equal(TZ_OFFSET_HOURS, 4);
});

test('a day runs from local midnight to local midnight', () => {
  const { from, to } = dayRange('2026-08-25');
  // Local midnight on the 25th is 20:00 UTC on the 24th.
  assert.equal(from.toISOString(), '2026-08-24T20:00:00.000Z');
  assert.equal(to.toISOString(), '2026-08-25T20:00:00.000Z');
});

// The case a UTC-based boundary gets wrong: 01:00 Dubai is still 21:00 UTC the
// day before, so a late-evening message would be filed under tomorrow.
test('a message just after local midnight belongs to the new day', () => {
  assert.equal(dayKeyFor(new Date('2026-08-24T20:30:00.000Z')), '2026-08-25');
  assert.equal(dayKeyFor(new Date('2026-08-24T19:30:00.000Z')), '2026-08-24');
});

test('a message late in the local evening stays on that day', () => {
  // 23:30 Dubai on the 25th is 19:30 UTC on the 25th.
  assert.equal(dayKeyFor(new Date('2026-08-25T19:30:00.000Z')), '2026-08-25');
});

test('every moment in a day maps back to that day', () => {
  for (const day of ['2026-01-01', '2026-02-28', '2026-08-25', '2026-12-31']) {
    const { from, to } = dayRange(day);
    assert.equal(dayKeyFor(from), day, `start of ${day}`);
    assert.equal(dayKeyFor(new Date(to.getTime() - 1)), day, `end of ${day}`);
    // One millisecond past the end is the next day, never the same one.
    assert.notEqual(dayKeyFor(to), day);
  }
});

test('the previous day crosses month and year boundaries', () => {
  assert.equal(previousDay('2026-08-01'), '2026-07-31');
  assert.equal(previousDay('2026-01-01'), '2025-12-31');
  assert.equal(previousDay('2026-03-01'), '2026-02-28');
});

test('the local hour is the one the scheduler fires on', () => {
  // 04:00 UTC is 08:00 in Dubai — the hour the digest is built.
  assert.equal(localHour(new Date('2026-08-25T04:00:00.000Z')), 8);
  assert.equal(localHour(new Date('2026-08-25T20:00:00.000Z')), 0);
});

/* The ordering rule is the point of the report: sorted by time it reads like a
   log and buries the one chat nobody answered. */

const chat = (over) => ({ messages: 1, lastAt: '2026-08-25T10:00:00Z', unanswered: false, isNew: false, temperature: '', ...over });

test('unanswered chats come first, longest wait leading', () => {
  const out = orderChats([
    chat({ displayName: 'routine' }),
    chat({ displayName: 'waiting since noon', unanswered: true, lastAt: '2026-08-25T12:00:00Z' }),
    chat({ displayName: 'hot', temperature: 'hot' }),
    chat({ displayName: 'waiting since dawn', unanswered: true, lastAt: '2026-08-25T06:00:00Z' }),
  ]);
  assert.deepEqual(out.map((c) => c.displayName), [
    'waiting since dawn', 'waiting since noon', 'hot', 'routine',
  ]);
});

test('hot beats new, and new beats routine', () => {
  const out = orderChats([
    chat({ displayName: 'routine' }),
    chat({ displayName: 'new', isNew: true }),
    chat({ displayName: 'hot', temperature: 'hot' }),
  ]);
  assert.deepEqual(out.map((c) => c.displayName), ['hot', 'new', 'routine']);
});

test('an unanswered chat outranks a hot one', () => {
  // Someone left waiting is a thing to fix today; a hot lead is a thing to
  // pursue. The fixable one leads.
  const out = orderChats([
    chat({ displayName: 'hot', temperature: 'hot' }),
    chat({ displayName: 'ignored', unanswered: true }),
  ]);
  assert.deepEqual(out.map((c) => c.displayName), ['ignored', 'hot']);
});

test('within the same rank the busiest conversation leads', () => {
  const out = orderChats([
    chat({ displayName: 'quiet', messages: 2 }),
    chat({ displayName: 'busy', messages: 20 }),
  ]);
  assert.deepEqual(out.map((c) => c.displayName), ['busy', 'quiet']);
});

test('ordering does not mutate what it was given', () => {
  const input = [chat({ displayName: 'a' }), chat({ displayName: 'b', unanswered: true })];
  const before = input.map((c) => c.displayName);
  orderChats(input);
  assert.deepEqual(input.map((c) => c.displayName), before);
});

test('an empty day sorts to an empty list rather than throwing', () => {
  assert.deepEqual(orderChats([]), []);
  assert.deepEqual(orderChats(), []);
});
