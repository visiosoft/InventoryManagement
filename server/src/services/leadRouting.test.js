import test from 'node:test';
import assert from 'node:assert/strict';
import {
   addRepToRotation, availability, coverageNow, coverageSignal, minutesInDay, onShift, outOfHoursIds, parseClock, pickOutOfHours, pickOwner,
} from './leadRouting.js';

const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '00:00', end: '24:00' }));
/** A rep on the roster around the clock unless given other shifts. */
const rep = (id, extra = {}) => ({ user: id, status: 'active', rosterManaged: true, weeklyShifts: ALL_WEEK, ...extra });

// ── the roster is the only rule ─────────────────────────────────────────────

test('only the roster decides: no shifts is off, whatever else a rule says', () => {
   const at = new Date('2026-09-02T06:00:00Z');
   assert.equal(onShift({ weeklyShifts: [] }, at), false);
   assert.equal(onShift({ workingHours: { start: '00:00', end: '23:59' } }, at), false, 'the old working hours no longer count');
   assert.equal(onShift(rep('a'), at), true);
   // Old shares, caps and absences are ignored: on the roster means on.
   const { available } = availability({ rules: [rep('a', { sharePct: 0, dailyCap: 1, status: 'absent' })], counts: { a: 9 }, at });
   assert.deepEqual(available.map((a) => a.id), ['a']);
   assert.match(pickOwner({ rules: [], at }).reason, /nobody is on the roster/);
});

test('out of hours: the chosen people take turns, and none chosen means it waits', () => {
   assert.equal(pickOutOfHours({ userIds: [] }), null);
   assert.equal(pickOutOfHours({ userIds: ['admin'] }).ownerId, 'admin');
   assert.equal(pickOutOfHours({ userIds: ['admin', 'boss'], hourCounts: { admin: 1 } }).ownerId, 'boss');
   assert.equal(pickOutOfHours({ userIds: ['admin', 'boss'], counts: { admin: 3, boss: 1 } }).ownerId, 'boss');
   assert.deepEqual(outOfHoursIds({ outOfHoursUsers: ['a', 'b'] }), ['a', 'b']);
   assert.deepEqual(outOfHoursIds({ outOfHoursMode: 'user', outOfHoursUser: 'x' }), ['x'], 'the old single person still counts');
   assert.deepEqual(outOfHoursIds({ outOfHoursMode: 'ai' }), []);
});

test('a new sales rep joins the roster with no hours, so no leads yet', async () => {
   const created = [];
   const Rule = {
      findOne: () => ({ select: () => ({ lean: async () => null }) }),
      create: async (doc) => { created.push(doc); return doc; },
   };
   const rule = await addRepToRotation('u1', { Rule });
   assert.deepEqual(created, [{ user: 'u1', status: 'active', rosterManaged: true, weeklyShifts: [] }]);
   assert.equal(onShift(rule, new Date('2026-09-02T06:00:00Z')), false);
});

test('weekly roster: the coverage calendar decides who is on', async () => {
   const { onRosterShift, cleanWeeklyShifts, pickOwner: pick } = await import('./leadRouting.js');
   const days = (list, start, end) => list.map((day) => ({ day, start, end }));
   const emad = { user: 'emad', status: 'active', weeklyShifts: days([1, 2, 3, 4, 5, 6], '08:00', '16:00') };
   const randa = { user: 'randa', status: 'active', weeklyShifts: days([0, 1, 2, 4, 5, 6], '10:00', '18:00') };
   const mahmoud = { user: 'mahmoud', status: 'active', weeklyShifts: days([0, 1, 2, 3, 4, 5], '15:00', '22:00') };
   const rules = [emad, randa, mahmoud];
   // Dubai is UTC+4: these are Dubai wall-clock times.
   const at = (iso) => new Date(`${iso}+04:00`);
   const who = (iso) => pick({ rules, at: at(iso) }).ownerId;
   const onNow = (iso) => availability({ rules, at: at(iso) }).available.map((a) => a.id).sort();

   assert.deepEqual(onNow('2026-10-19T09:00:00'), ['emad']);                     // Monday 9am
   assert.deepEqual(onNow('2026-10-19T15:30:00'), ['emad', 'mahmoud', 'randa']); // Monday 3pm: all three
   assert.deepEqual(onNow('2026-10-21T12:00:00'), ['emad']);                     // Wednesday: no Randa
   assert.deepEqual(onNow('2026-10-24T19:00:00'), []);                           // Saturday 7pm: the gap
   assert.deepEqual(onNow('2026-10-25T09:00:00'), []);                           // Sunday 9am: gap
   assert.deepEqual(onNow('2026-10-25T16:00:00'), ['mahmoud', 'randa']);         // Sunday 4pm
   assert.equal(who('2026-10-19T23:00:00'), null);                               // overnight gap
   assert.equal(onRosterShift([{ day: 6, start: '22:00', end: '06:00' }], 0, 120), true);   // past midnight
   assert.deepEqual(cleanWeeklyShifts([{ day: 1, start: '08:00', end: '16:00' }, { day: 9, start: '08:00', end: '16:00' }, { day: 2, start: 'x', end: '16:00' }]),
      [{ day: 1, start: '08:00', end: '16:00' }]);
});

test('coverage now: who is on, until when, and who comes on next', () => {
   // Wednesday 2026-09-02, 12:00 in Dubai (08:00 UTC).
   const at = new Date('2026-09-02T08:00:00Z');
   const shifts = (start, end) => [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start, end }));
   const rules = [
      rep('e', { user: { _id: 'e', name: 'Emad' }, rosterManaged: true, weeklyShifts: shifts('08:00', '16:00') }),
      rep('m', { user: { _id: 'm', name: 'Mahmoud' }, rosterManaged: true, weeklyShifts: shifts('15:00', '22:00') }),
      rep('x', { user: { _id: 'x', name: 'Xena' }, rosterManaged: true, weeklyShifts: [] }),
   ];
   const c = coverageNow({ rules, at, activity: { e: { repliesToday: 4, waiting: 1 } } });
   const by = Object.fromEntries(c.reps.map((r) => [r.name, r]));
   assert.equal(by.Emad.on, true);
   assert.equal(by.Emad.until, '16:00');
   assert.equal(by.Emad.repliesToday, 4);
   assert.equal(by.Mahmoud.on, false);
   assert.equal(by.Mahmoud.nextOn, '15:00');
   assert.equal(by.Xena.nextOn, null);
   assert.equal(c.reps[0].name, 'Emad');
   assert.deepEqual(c.handovers.slice(0, 2).map((h) => [h.label, h.joins, h.leaves]), [['15:00', ['m'], []], ['16:00', [], ['e']]]);
   assert.equal(c.nobodyOn, false);
});

test('roster hours: reps on the same hour take turns one by one', async () => {
   const { pickOwner: pick } = await import('./leadRouting.js');
   const rules = [rep('ahmed'), rep('sara'), rep('omar')];
   const at = new Date('2026-10-26T11:20:00Z'); // Monday 3:20pm in Dubai
   const counts = {};
   const hour = {};
   const order = [];
   for (let i = 0; i < 6; i++) {
      const d = pick({ rules, counts, hourCounts: hour, at, splits: [] });
      order.push(d.ownerId);
      counts[d.ownerId] = (counts[d.ownerId] || 0) + 1;
      hour[d.ownerId] = (hour[d.ownerId] || 0) + 1;
   }
   assert.deepEqual(order, ['ahmed', 'sara', 'omar', 'ahmed', 'sara', 'omar']);
   // The first lead of an hour goes to whoever has had fewer today.
   assert.equal(pick({ rules, counts: { ahmed: 5, sara: 2, omar: 4 }, hourCounts: {}, at, splits: [] }).ownerId, 'sara');
});

test('roster hours: an hour with its own split follows the percentages', async () => {
   const { pickOwner: pick, cleanHourSplits } = await import('./leadRouting.js');
   const ids = { ahmed: 'a'.repeat(24), sara: 'b'.repeat(24), omar: 'c'.repeat(24) };
   const rules = Object.values(ids).map((id) => rep(id));
   const splits = cleanHourSplits([{ day: 1, hour: 15, shares: [{ user: ids.ahmed, pct: 70 }, { user: ids.sara, pct: 15 }, { user: ids.omar, pct: 15 }] }]);
   const at = new Date('2026-10-26T11:20:00Z'); // Monday 3pm hour in Dubai
   assert.equal(pick({ rules, at, splits, random: () => 0.5 }).ownerId, ids.ahmed);  // 0–70
   assert.equal(pick({ rules, at, splits, random: () => 0.75 }).ownerId, ids.sara);  // 70–85
   assert.equal(pick({ rules, at, splits, random: () => 0.95 }).ownerId, ids.omar);  // 85–100
   assert.match(pick({ rules, at, splits, random: () => 0.5 }).reason, /70% of this hour/);
   // Another hour has no split: turns.
   assert.match(pick({ rules, at: new Date('2026-10-26T12:20:00Z'), splits }).reason, /taking turns/);
   // Somebody in the split who is off shift is left out, and the rest share it.
   const offOmar = rules.map((r) => (r.user === ids.omar ? { ...r, weeklyShifts: [] } : r));
   assert.equal(pick({ rules: offOmar, at, splits, random: () => 0.99 }).ownerId, ids.sara);
});

test('roster hours: splits are cleaned', async () => {
   const { cleanHourSplits } = await import('./leadRouting.js');
   const id = 'a'.repeat(24);
   assert.deepEqual(cleanHourSplits([
      { day: 1, hour: 15, shares: [{ user: id, pct: 70 }, { user: 'x', pct: 30 }, { user: id, pct: 0 }] },
      { day: 9, hour: 15, shares: [{ user: id, pct: 50 }] },
      { day: 2, hour: 3, shares: [] },
   ]), [{ day: 1, hour: 15, shares: [{ user: id, pct: 70 }] }]);
   assert.deepEqual(cleanHourSplits('nope'), []);
});

test('clock strings are read, and rubbish is ignored rather than guessed', () => {
   assert.equal(parseClock('09:00'), 540);
   assert.equal(parseClock('9:30'), 570);
   assert.equal(parseClock(''), null);
   assert.equal(parseClock('nine'), null);
   assert.equal(parseClock('25:00'), null);
});

test('minutes are counted in the shop timezone', () => {
   assert.equal(minutesInDay(new Date('2026-09-02T06:30:00Z')), 10 * 60 + 30);
});

test('the day starts at midnight where the shop is, not where the server is', async () => {
   const { startOfDayIn } = await import('./leadRouting.js');
   // 21:00 UTC on the 2nd is 01:00 on the 3rd in Dubai, so it belongs to the 3rd.
   const late = startOfDayIn(new Date('2026-09-02T21:00:00Z'));
   assert.equal(late.toISOString(), '2026-09-02T20:00:00.000Z');
   // and 06:00 UTC on the 3rd is 10:00 the same day, so the same boundary.
   assert.equal(startOfDayIn(new Date('2026-09-03T06:00:00Z')).toISOString(), '2026-09-02T20:00:00.000Z');
   // A zone that observes daylight saving is measured, not assumed.
   const london = startOfDayIn(new Date('2026-07-15T12:00:00Z'), 'Europe/London');
   assert.equal(london.toISOString(), '2026-07-14T23:00:00.000Z');
});

test('a number is matched however it was written down', async () => {
   const { digitTail } = await import('./leadRouting.js');
   // The same person, typed five ways, as they actually appear in the data.
   const same = ['+971 52 130 2290', '971521302290', '0521302290', '+971521302290', '971-52-130-2290'];
   const tails = same.map(digitTail);
   assert.equal(new Set(tails).size, 1, `these should all be one person: ${tails.join(', ')}`);
   assert.equal(tails[0], '521302290');
   assert.equal(digitTail('12345'), '', 'too short to identify anybody');
   assert.equal(digitTail(''), '');
   assert.equal(digitTail(null), '');
});

test('somebody already in the rotation, or taken out of it, is left alone', async () => {
   let made = false;
   const Rule = {
      findOne: () => ({ select: () => ({ lean: async () => ({ _id: 'r1' }) }) }),
      create: async () => { made = true; },
   };
   assert.equal(await addRepToRotation('u1', { Rule }), null);
   assert.equal(made, false);
});

test('the traffic light: green with a rep on, amber when only the AI answers, red when nobody does', () => {
   assert.equal(coverageSignal({ nobodyOn: false, aiAnswering: true }), 'green');
   assert.equal(coverageSignal({ nobodyOn: false, aiAnswering: false }), 'green');
   assert.equal(coverageSignal({ nobodyOn: true, aiAnswering: true }), 'amber');
   assert.equal(coverageSignal({ nobodyOn: true, aiAnswering: false }), 'red');
});
