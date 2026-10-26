import test from 'node:test';
import assert from 'node:assert/strict';
import { routeInboundLead, sweepUnassignedLeads } from './leadRouting.js';

/*
 * Lead distribution end to end: a lead arriving, through the whole decision
 * (config, roster, who is active, today's and this hour's tallies, splits,
 * out of hours), with the database swapped for plain data. The roster is the
 * live one at the time of writing: Randa 3am–6pm and Mahmoud 3pm–10pm.
 */

const RANDA = 'a'.repeat(24);
const MAHMOUD = 'b'.repeat(24);
const EMAD = 'c'.repeat(24);
const ADMIN = 'd'.repeat(24);
const BOSS = 'e'.repeat(24);

const days = (list, start, end) => list.map((day) => ({ day, start, end }));
const ROSTER = [
   { user: RANDA, rosterManaged: true, weeklyShifts: days([0, 1, 2, 4, 5, 6], '03:00', '18:00') },
   { user: MAHMOUD, rosterManaged: true, weeklyShifts: days([0, 1, 2, 3, 4, 5], '15:00', '22:00') },
];
// Dubai wall-clock times (UTC+4).
const at = (iso) => new Date(`${iso}+04:00`);
const MON_10AM = at('2026-10-26T10:00:00');
const MON_4PM = at('2026-10-26T16:20:00');
const MON_11PM = at('2026-10-26T23:00:00');

/** A world to route in. Tallies grow as leads are handed out, as they would in the database. */
function world({ config = {}, rules = ROSTER, inactive = [], random } = {}) {
   const today = {};
   const hour = {};
   const deps = {
      config: async () => ({ enabled: true, timeZone: 'Asia/Dubai', hourSplits: [], outOfHoursUsers: [], ...config }),
      rules: async () => rules,
      activeIds: async (ids) => ids.filter((id) => !inactive.includes(id)),
      counts: async () => ({ ...today }),
      hourCounts: async () => ({ ...hour }),
      ...(random ? { random } : {}),
   };
   const route = async (when) => {
      const d = await routeInboundLead({ at: when, deps });
      if (d.ownerId) { today[d.ownerId] = (today[d.ownerId] || 0) + 1; hour[d.ownerId] = (hour[d.ownerId] || 0) + 1; }
      return d;
   };
   return { route, today, hour, deps };
}

test('distribution off: nobody is assigned', async () => {
   const { route } = world({ config: { enabled: false } });
   const d = await route(MON_10AM);
   assert.equal(d.ownerId, null);
   assert.equal(d.off, true);
});

test('one rep on the roster gets every lead in their hours', async () => {
   const { route } = world();
   for (let i = 0; i < 3; i++) assert.equal((await route(MON_10AM)).ownerId, RANDA);
});

test('two reps on the same hour take turns, one by one', async () => {
   const { route } = world();
   const order = [];
   for (let i = 0; i < 6; i++) order.push((await route(MON_4PM)).ownerId);
   assert.deepEqual(order, [RANDA, MAHMOUD, RANDA, MAHMOUD, RANDA, MAHMOUD]);
});

test('the first lead of an hour goes to whoever has had fewer today', async () => {
   const { route, today } = world();
   today[RANDA] = 12; // a busy morning
   assert.equal((await route(MON_4PM)).ownerId, MAHMOUD);
   assert.equal((await route(MON_4PM)).ownerId, RANDA, 'then turns within the hour');
});

test('an hour with its own split follows the percentages', async () => {
   const splits = [{ day: 1, hour: 16, shares: [{ user: RANDA, pct: 70 }, { user: MAHMOUD, pct: 30 }] }];
   const rolls = [0.1, 0.65, 0.69, 0.71, 0.99];
   let i = 0;
   const { route } = world({ config: { hourSplits: splits }, random: () => rolls[i++] });
   const got = [];
   for (const _ of rolls) got.push((await route(MON_4PM)).ownerId);
   assert.deepEqual(got, [RANDA, RANDA, RANDA, MAHMOUD, MAHMOUD]);
});

test('a split over many leads lands close to its percentages', async () => {
   const splits = [{ day: 1, hour: 16, shares: [{ user: RANDA, pct: 70 }, { user: MAHMOUD, pct: 30 }] }];
   // A fixed, evenly spread sequence of rolls instead of chance.
   let n = 0;
   const { route, today } = world({ config: { hourSplits: splits }, random: () => ((n++ * 0.6180339887) % 1) });
   for (let k = 0; k < 1000; k++) await route(MON_4PM);
   assert.ok(Math.abs(today[RANDA] / 1000 - 0.7) < 0.02, `Randa got ${today[RANDA]} of 1000`);
});

test('a split only applies to its own hour', async () => {
   const splits = [{ day: 1, hour: 15, shares: [{ user: RANDA, pct: 100 }] }];
   const { route } = world({ config: { hourSplits: splits } });
   const d = await route(MON_4PM); // 4pm, not 3pm
   assert.match(d.reason, /taking turns/);
});

test('out of hours with nobody chosen: the lead waits for the next shift', async () => {
   const { route } = world();
   const d = await route(MON_11PM);
   assert.equal(d.ownerId, null);
   assert.equal(d.outOfHours, true);
   assert.match(d.reason, /waits for the next shift/);
});

test('out of hours: the chosen people take turns', async () => {
   const { route } = world({ config: { outOfHoursUsers: [ADMIN, BOSS] } });
   const order = [];
   for (let i = 0; i < 4; i++) {
      const d = await route(MON_11PM);
      assert.equal(d.outOfHours, true);
      order.push(d.ownerId);
   }
   assert.deepEqual(order, [ADMIN, BOSS, ADMIN, BOSS]);
});

test('out of hours people are only used when nobody is on the roster', async () => {
   const { route } = world({ config: { outOfHoursUsers: [ADMIN] } });
   assert.equal((await route(MON_10AM)).ownerId, RANDA);
});

test('the old single out-of-hours person still counts until the list is set', async () => {
   const { route } = world({ config: { outOfHoursMode: 'user', outOfHoursUser: ADMIN } });
   assert.equal((await route(MON_11PM)).ownerId, ADMIN);
});

test('a deactivated user is never given a lead, on the roster or out of hours', async () => {
   const rules = [...ROSTER, { user: EMAD, rosterManaged: true, weeklyShifts: days([1], '09:00', '12:00') }];
   const { route } = world({ rules, inactive: [EMAD, ADMIN], config: { outOfHoursUsers: [ADMIN, BOSS] } });
   for (let i = 0; i < 3; i++) assert.equal((await route(MON_10AM)).ownerId, RANDA);
   assert.equal((await route(MON_11PM)).ownerId, BOSS);
   assert.equal((await route(MON_11PM)).ownerId, BOSS);
});

test('only the roster decides: old shares, absences, caps and the existing-customer setting are ignored', async () => {
   const rules = [
      { ...ROSTER[0], sharePct: 0, status: 'absent', dailyCap: 1, workingHours: { start: '00:00', end: '01:00' } },
      { ...ROSTER[1], sharePct: 100 },
      { user: EMAD, sharePct: 100, status: 'active', workingHours: { start: '00:00', end: '23:59' } }, // no roster hours
   ];
   const { route } = world({ rules, config: { existingCustomerUser: ADMIN, randomize: true } });
   const got = [];
   for (let i = 0; i < 3; i++) got.push((await route(MON_10AM)).ownerId);
   assert.deepEqual(got, [RANDA, RANDA, RANDA]);
});

test('a rep taken off an hour on the calendar gets nothing then', async () => {
   const rules = [{ ...ROSTER[0], weeklyShifts: days([0, 2, 4, 5, 6], '03:00', '18:00') }, ROSTER[1]]; // no Monday
   const { route } = world({ rules });
   assert.equal((await route(MON_10AM)).ownerId, null);
   assert.equal((await route(MON_4PM)).ownerId, MAHMOUD);
});

/* ── the sweep that hands out waiting leads ─────────────────────────────── */

function sweepWorld({ waiting, decide }) {
   const claimed = [];
   const deps = {
      config: async () => ({ enabled: true }),
      waiting: async () => waiting,
      starter: async () => null,
      route: async (lead) => decide(lead),
      claim: async (lead, set, note) => { claimed.push({ id: lead._id, owner: set.owner, note }); return { modifiedCount: 1 }; },
      notify: async () => {},
      leadless: async () => 0,
   };
   return { claimed, deps };
}

test('when a shift starts, waiting leads are handed out by the roster', async () => {
   const owners = [RANDA, MAHMOUD, RANDA];
   const { claimed, deps } = sweepWorld({ waiting: [{ _id: 1 }, { _id: 2 }, { _id: 3 }], decide: async () => ({ ownerId: owners.shift(), reason: 'taking turns' }) });
   const r = await sweepUnassignedLeads({ deps });
   assert.equal(r.assigned, 3);
   assert.deepEqual(claimed.map((c) => c.owner), [RANDA, MAHMOUD, RANDA]);
   assert.match(claimed[0].note, /Assigned by distribution rules — taking turns/);
});

test('the backlog never goes to the out-of-hours people', async () => {
   const { claimed, deps } = sweepWorld({ waiting: [{ _id: 1 }, { _id: 2 }], decide: async () => ({ ownerId: ADMIN, reason: 'out of hours', outOfHours: true }) });
   const r = await sweepUnassignedLeads({ deps });
   assert.equal(r.assigned, 0);
   assert.deepEqual(claimed, []);
});

test('with distribution off the sweep does nothing', async () => {
   const { claimed, deps } = sweepWorld({ waiting: [{ _id: 1 }], decide: async () => ({ ownerId: RANDA }) });
   const r = await sweepUnassignedLeads({ deps: { ...deps, config: async () => ({ enabled: false }) } });
   assert.equal(r.assigned, 0);
   assert.deepEqual(claimed, []);
});
