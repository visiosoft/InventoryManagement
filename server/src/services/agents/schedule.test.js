import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDue } from './schedule.js';

/* 07:00 Dubai is 03:00 UTC. Monday 7 September 2026. */
const MONDAY_0700 = new Date('2026-09-07T03:00:00.000Z');
const MONDAY_0800 = new Date('2026-09-07T04:00:00.000Z');
const TUESDAY_0700 = new Date('2026-09-08T03:00:00.000Z');

const agent = (over = {}) => ({
   enabled: true,
   schedule: { mode: 'daily', hour: 7, weekday: 1 },
   lastScheduledDay: '',
   ...over,
});

test('a schedule is off until somebody turns it on', () => {
   // The autoSummarise choice: nothing sweeps every conversation on its own
   // before anybody has looked at what it produces.
   assert.equal(isDue(agent({ schedule: { mode: 'off', hour: 7 } }), { now: MONDAY_0700 }), false);
});

test('a disabled agent does not run however it is scheduled', () => {
   assert.equal(isDue(agent({ enabled: false }), { now: MONDAY_0700 }), false);
});

test('daily fires at its hour and not at any other', () => {
   assert.equal(isDue(agent(), { now: MONDAY_0700 }), true);
   assert.equal(isDue(agent(), { now: MONDAY_0800 }), false);
});

test('having run today, it will not run again', () => {
   // The tick is every minute; without this it would start sixty times.
   assert.equal(isDue(agent({ lastScheduledDay: '2026-09-07' }), { now: MONDAY_0700 }), false);
   // And a restart the next morning is a new day, so it runs.
   assert.equal(isDue(agent({ lastScheduledDay: '2026-09-07' }), { now: TUESDAY_0700 }), true);
});

test('weekly fires on its local weekday only', () => {
   const weekly = agent({ schedule: { mode: 'weekly', hour: 7, weekday: 1 } });
   assert.equal(isDue(weekly, { now: MONDAY_0700 }), true);
   assert.equal(isDue(weekly, { now: TUESDAY_0700 }), false);
});

test('a weekday is read in Dubai time, not UTC', () => {
   // 21:00 UTC Sunday is already Monday 01:00 in Dubai. A schedule set to
   // Monday should mean Monday here, not wherever the server happens to run.
   const sundayLateUtc = new Date('2026-09-06T21:00:00.000Z');
   const weekly = agent({ schedule: { mode: 'weekly', hour: 1, weekday: 1 } });
   assert.equal(isDue(weekly, { now: sundayLateUtc }), true);
});
