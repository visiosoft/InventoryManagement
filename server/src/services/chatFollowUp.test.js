import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remindAt, wentQuiet, quietDays, QUIET_DAYS } from './chatFollowUp.js';

// 10:00 Dubai on a Thursday.
const NOW = new Date('2026-09-03T06:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 864e5);
const dubai = (d) => new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Dubai' });

test('a preset falls due in the morning, on the right local day', () => {
   // 09:00 Dubai is 05:00 UTC.
   assert.equal(remindAt('tomorrow', NOW).toISOString(), '2026-09-04T05:00:00.000Z');
   assert.equal(remindAt('three_days', NOW).toISOString(), '2026-09-06T05:00:00.000Z');
   assert.equal(remindAt('next_week', NOW).toISOString(), '2026-09-10T05:00:00.000Z');
   assert.match(dubai(remindAt('tomorrow', NOW)), /04\/09\/2026, 09:00/);
});

test('late at night, tomorrow is still tomorrow where the rep is', () => {
   /* 23:30 Dubai is 19:30 UTC the same day, so a server working in UTC and a
      rep working in Dubai agree here — but at 02:00 Dubai they do not: that is
      22:00 UTC the previous day, and "tomorrow" computed in UTC would land on
      the day the rep calls today. */
   const lateNight = new Date('2026-09-03T22:00:00.000Z');   // 02:00 Dubai, the 4th
   assert.match(dubai(remindAt('tomorrow', lateNight)), /05\/09\/2026, 09:00/);
});

test('a picked day is taken as a day, not a moment', () => {
   assert.match(dubai(remindAt('2026-12-25', NOW)), /25\/12\/2026, 09:00/);
   assert.equal(remindAt('not a date', NOW), null);
});

test('a chat is quiet only when we were the last to speak', () => {
   const base = { leadStatus: 'contacted', now: NOW };
   assert.equal(wentQuiet({ ...base, lastOutboundAt: daysAgo(4), lastInboundAt: daysAgo(5) }), true);

   // They spoke last: owed a reply, which is the other queue and more urgent.
   assert.equal(wentQuiet({ ...base, lastOutboundAt: daysAgo(5), lastInboundAt: daysAgo(4) }), false);

   // Nothing was ever sent.
   assert.equal(wentQuiet({ ...base, lastOutboundAt: null, lastInboundAt: daysAgo(4) }), false);
});

test('three days, not two', () => {
   const base = { leadStatus: 'contacted', lastInboundAt: daysAgo(9), now: NOW };
   assert.equal(wentQuiet({ ...base, lastOutboundAt: daysAgo(2) }), false);
   assert.equal(wentQuiet({ ...base, lastOutboundAt: daysAgo(QUIET_DAYS) }), true);
   assert.equal(wentQuiet({ ...base, lastOutboundAt: daysAgo(8) }), true);
});

test('a finished lead is not a neglected one', () => {
   const base = { lastOutboundAt: daysAgo(9), lastInboundAt: daysAgo(10), now: NOW };
   assert.equal(wentQuiet({ ...base, leadStatus: 'won' }), false);
   assert.equal(wentQuiet({ ...base, leadStatus: 'lost' }), false);
   // No lead behind the chat at all: nothing to chase.
   assert.equal(wentQuiet({ ...base, leadStatus: '' }), false);
});

test('setting a reminder takes it off the list', () => {
   const base = { leadStatus: 'contacted', lastOutboundAt: daysAgo(9), lastInboundAt: daysAgo(10), now: NOW };
   // Somebody has already dealt with this; listing it would punish them for
   // using the feature.
   assert.equal(wentQuiet({ ...base, followUpAt: new Date(NOW.getTime() + 2 * 864e5) }), false);
   // A reminder that has already come and gone is not a plan any more.
   assert.equal(wentQuiet({ ...base, followUpAt: daysAgo(1) }), true);
});

test('how long it has been silent', () => {
   assert.equal(quietDays(daysAgo(4), NOW), 4);
   assert.equal(quietDays(null, NOW), 0);
});
