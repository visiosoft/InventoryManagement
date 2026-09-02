import test from 'node:test';
import assert from 'node:assert/strict';
import {
   availability, isAbsent, minutesInDay, parseClock, pickOwner, targetShares, weekdayIn, withinWorkingHours,
} from './leadRouting.js';

const rep = (id, sharePct, extra = {}) => ({ user: id, sharePct, status: 'active', dailyCap: 0, ...extra });

/** Hand out n leads, tallying as it goes, and report who got how many. */
function distribute(rules, n, at = new Date('2026-09-02T09:00:00Z')) {
   const counts = {};
   const order = [];
   for (let i = 0; i < n; i++) {
      const { ownerId } = pickOwner({ rules, counts, at });
      if (!ownerId) { order.push(null); continue; }
      counts[ownerId] = (counts[ownerId] || 0) + 1;
      order.push(ownerId);
   }
   return { counts, order };
}

// ── the share actually holds ────────────────────────────────────────────────

test('a 50/25/25 split comes out 50/25/25 over twenty leads', () => {
   const rules = [rep('ahmed', 50), rep('sara', 25), rep('bilal', 25)];
   const { counts } = distribute(rules, 20);
   assert.deepEqual(counts, { ahmed: 10, sara: 5, bilal: 5 });
});

test('it holds over four leads too, which is where random would not', () => {
   // The point of weighting rather than rolling a die: a small day still
   // lands on the right ratio.
   const { counts } = distribute([rep('ahmed', 50), rep('sara', 25), rep('bilal', 25)], 4);
   assert.deepEqual(counts, { ahmed: 2, sara: 1, bilal: 1 });
});

test('the biggest share gets the first lead of the day', () => {
   const { order } = distribute([rep('sara', 25), rep('ahmed', 50), rep('bilal', 25)], 1);
   assert.equal(order[0], 'ahmed');
});

test('an uneven split still lands close', () => {
   const { counts } = distribute([rep('a', 70), rep('b', 30)], 10);
   assert.deepEqual(counts, { a: 7, b: 3 });
});

// ── somebody goes away ──────────────────────────────────────────────────────

test('an absent rep’s share is spread in proportion, keeping the ratio', () => {
   /* Ahmed 50, Sara 25, Bilal 25. With Bilal away the other two stay 2:1,
      so twelve leads go 8 and 4 rather than 6 and 3 with three left over. */
   const rules = [rep('ahmed', 50), rep('sara', 25), rep('bilal', 25, { status: 'absent' })];
   const { counts } = distribute(rules, 12);
   assert.deepEqual(counts, { ahmed: 8, sara: 4 });
});

test('a named stand-in takes the whole share instead', () => {
   const rules = [
      rep('ahmed', 50), rep('sara', 25),
      rep('bilal', 25, { status: 'absent', fallbackMode: 'user', fallbackUser: 'sara' }),
   ];
   const { counts } = distribute(rules, 8);
   // Sara covers Bilal, so 50/50 rather than 66/33.
   assert.deepEqual(counts, { ahmed: 4, sara: 4 });
});

test('a stand-in who is also away hands the share on rather than stranding it', () => {
   const rules = [
      rep('ahmed', 50),
      rep('sara', 25, { status: 'absent' }),
      rep('bilal', 25, { status: 'absent', fallbackMode: 'user', fallbackUser: 'sara' }),
   ];
   const { counts } = distribute(rules, 5);
   assert.deepEqual(counts, { ahmed: 5 });
});

test('two reps naming each other as stand-in does not hang', () => {
   const rules = [
      rep('ahmed', 50),
      rep('sara', 25, { status: 'absent', fallbackMode: 'user', fallbackUser: 'bilal' }),
      rep('bilal', 25, { status: 'absent', fallbackMode: 'user', fallbackUser: 'sara' }),
   ];
   const { counts } = distribute(rules, 4);
   assert.deepEqual(counts, { ahmed: 4 });
});

test('a rep who was away catches up on their own once back', () => {
   const rules = [rep('ahmed', 50), rep('sara', 50)];
   // Ahmed took the morning on his own while Sara was out.
   const counts = { ahmed: 6, sara: 0 };
   const picks = [];
   for (let i = 0; i < 6; i++) {
      const { ownerId } = pickOwner({ rules, counts, at: new Date('2026-09-02T09:00:00Z') });
      counts[ownerId] = (counts[ownerId] || 0) + 1;
      picks.push(ownerId);
   }
   assert.deepEqual(picks, ['sara', 'sara', 'sara', 'sara', 'sara', 'sara'],
      'the one who is behind should take the next several without anybody adjusting anything');
});

// ── absence dates ───────────────────────────────────────────────────────────

test('an absence with dates ends by itself', () => {
   const r = rep('bilal', 25, { status: 'absent', absentFrom: new Date('2026-09-01'), absentTo: new Date('2026-09-10') });
   assert.equal(isAbsent(r, new Date('2026-09-05')), true);
   assert.equal(isAbsent(r, new Date('2026-09-11')), false, 'back on the 11th without anybody remembering');
   assert.equal(isAbsent(r, new Date('2026-08-30')), false, 'not away before it starts');
});

test('absent with no dates stays absent until somebody says otherwise', () => {
   assert.equal(isAbsent(rep('x', 10, { status: 'absent' }), new Date()), true);
});

test('paused counts as unavailable whatever the dates say', () => {
   assert.equal(isAbsent(rep('x', 10, { status: 'paused' }), new Date()), true);
});

// ── working hours ───────────────────────────────────────────────────────────

test('clock strings are read, and rubbish is ignored rather than guessed', () => {
   assert.equal(parseClock('09:00'), 540);
   assert.equal(parseClock('9:30'), 570);
   assert.equal(parseClock(''), null);
   assert.equal(parseClock('nine'), null);
   assert.equal(parseClock('25:00'), null);
});

test('no working hours set means always on shift', () => {
   assert.equal(withinWorkingHours({}, new Date()), true);
   assert.equal(withinWorkingHours({ workingHours: {} }, new Date()), true);
});

test('a shift is judged in Dubai time, not the server’s', () => {
   const rule = { workingHours: { start: '09:00', end: '18:00' } };
   // 06:00 UTC is 10:00 in Dubai — on shift — and 19:00 UTC is 23:00, off.
   assert.equal(withinWorkingHours(rule, new Date('2026-09-02T06:00:00Z')), true);
   assert.equal(withinWorkingHours(rule, new Date('2026-09-02T19:00:00Z')), false);
});

test('a shift that runs past midnight is understood', () => {
   const night = { workingHours: { start: '22:00', end: '06:00' } };
   assert.equal(withinWorkingHours(night, new Date('2026-09-02T20:00:00Z')), true);   // 00:00 Dubai
   assert.equal(withinWorkingHours(night, new Date('2026-09-02T10:00:00Z')), false);  // 14:00 Dubai
});

test('days off are respected', () => {
   const rule = { workingHours: { days: [1, 2, 3, 4, 5], start: '00:00', end: '23:59' } };
   const sunday = new Date('2026-09-06T08:00:00Z');
   assert.equal(weekdayIn(sunday), 0);
   assert.equal(withinWorkingHours(rule, sunday), false);
   assert.equal(withinWorkingHours(rule, new Date('2026-09-02T08:00:00Z')), true);
});

test('minutes are counted in the shop timezone', () => {
   assert.equal(minutesInDay(new Date('2026-09-02T06:30:00Z')), 10 * 60 + 30);
});

// ── caps ────────────────────────────────────────────────────────────────────

test('a daily cap stops a rep even when the share says otherwise', () => {
   const rules = [rep('ahmed', 50), rep('sara', 50, { dailyCap: 2 })];
   const { counts } = distribute(rules, 8);
   assert.equal(counts.sara, 2, 'never more than her cap');
   assert.equal(counts.ahmed, 6, 'the rest go to whoever is left');
});

test('a cap of zero means no ceiling, not no leads', () => {
   const { counts } = distribute([rep('ahmed', 100, { dailyCap: 0 })], 3);
   assert.equal(counts.ahmed, 3);
});

// ── nobody available ────────────────────────────────────────────────────────

test('when everybody is capped or away it says so instead of guessing', () => {
   const rules = [rep('ahmed', 50, { dailyCap: 1 }), rep('sara', 50, { status: 'absent' })];
   const r = pickOwner({ rules, counts: { ahmed: 1 } });
   assert.equal(r.ownerId, null);
   assert.match(r.reason, /nobody is available/);
   assert.deepEqual(r.excluded.map((e) => e.reason).sort(), ['absent', 'daily cap of 1 reached']);
});

test('no rules at all is reported as such, not as an absence', () => {
   const r = pickOwner({ rules: [] });
   assert.equal(r.ownerId, null);
   assert.match(r.reason, /no distribution rules/);
});

test('the decision carries a reason worth reading later', () => {
   const r = pickOwner({ rules: [rep('ahmed', 50), rep('sara', 50)], counts: { ahmed: 3, sara: 1 } });
   assert.equal(r.ownerId, 'sara');
   assert.match(r.reason, /50% share, 1 of 4 today/);
});

// ── shares that do not add to 100 ───────────────────────────────────────────

test('shares that do not sum to 100 are treated as proportions', () => {
   // 2:1, however it is written down.
   const { counts } = distribute([rep('a', 2), rep('b', 1)], 9);
   assert.deepEqual(counts, { a: 6, b: 3 });
});

test('everyone on zero still gets an even split rather than nobody being picked', () => {
   const { counts } = distribute([rep('a', 0), rep('b', 0)], 4);
   assert.deepEqual(counts, { a: 2, b: 2 });
});

test('a rep on 0% among others on a share gets nothing', () => {
   const { counts } = distribute([rep('a', 100), rep('b', 0)], 5);
   assert.deepEqual(counts, { a: 5 });
});

// ── availability reporting ──────────────────────────────────────────────────

test('availability explains every exclusion', () => {
   const at = new Date('2026-09-02T19:00:00Z');  // 23:00 Dubai
   const { available, excluded } = availability({
      rules: [
         rep('onshift', 50),
         rep('offshift', 25, { workingHours: { start: '09:00', end: '18:00' } }),
         rep('away', 25, { status: 'absent' }),
      ],
      counts: {},
      at,
   });
   assert.deepEqual(available.map((a) => a.id), ['onshift']);
   assert.deepEqual(excluded, [{ id: 'offshift', reason: 'off shift' }, { id: 'away', reason: 'absent' }]);
});

test('targetShares hands an absent share on and leaves the rest alone', () => {
   const rules = [rep('a', 50), rep('b', 25), rep('c', 25, { status: 'absent' })];
   const { available } = availability({ rules, counts: {} });
   const shares = targetShares({ rules, available });
   assert.equal(Math.round(shares.get('a')), 67);
   assert.equal(Math.round(shares.get('b')), 33);
   assert.equal(shares.has('c'), false);
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
