import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDue, describeSchedule, dubaiParts } from './jobs.js';

// 03:00 UTC is 07:00 in Dubai (UTC+4). Saturday 26 Sep 2026.
const SEVEN_DUBAI = new Date('2026-09-26T03:00:00.000Z');
const EIGHT_DUBAI = new Date('2026-09-26T04:00:00.000Z');
const daily = { kind: 'scheduled', mode: 'shadow', schedule: { cadence: 'daily', hour: 7 }, lastRunDay: '' };

test('the clock reads Dubai time, not the server\'s', () => {
    const p = dubaiParts(SEVEN_DUBAI);
    assert.equal(p.hour, 7);
    assert.equal(p.dayKey, '2026-09-26');
    assert.equal(p.dayOfWeek, 6, 'Saturday');
});

test('a daily agent is due at its hour, once, and not again that day', () => {
    assert.equal(isDue(daily, SEVEN_DUBAI), true);
    assert.equal(isDue(daily, EIGHT_DUBAI), false, 'the hour has passed');
    assert.equal(isDue({ ...daily, lastRunDay: '2026-09-26' }, SEVEN_DUBAI), false, 'already ran today');
    assert.equal(isDue({ ...daily, lastRunDay: '2026-09-25' }, SEVEN_DUBAI), true, 'ran yesterday, due again');
});

test('off duty, on request, or a conversational agent is never due', () => {
    assert.equal(isDue({ ...daily, mode: 'off' }, SEVEN_DUBAI), false);
    assert.equal(isDue({ ...daily, schedule: { cadence: 'on_request' } }, SEVEN_DUBAI), false);
    assert.equal(isDue({ ...daily, kind: 'conversational' }, SEVEN_DUBAI), false);
});

test('weekly and monthly agents wait for their day', () => {
    assert.equal(isDue({ ...daily, schedule: { cadence: 'weekly', hour: 7, dayOfWeek: 6 } }, SEVEN_DUBAI), true, 'Saturday');
    assert.equal(isDue({ ...daily, schedule: { cadence: 'weekly', hour: 7, dayOfWeek: 1 } }, SEVEN_DUBAI), false, 'not Monday');
    assert.equal(isDue({ ...daily, schedule: { cadence: 'monthly', hour: 7, dayOfMonth: 26 } }, SEVEN_DUBAI), true);
    assert.equal(isDue({ ...daily, schedule: { cadence: 'monthly', hour: 7, dayOfMonth: 1 } }, SEVEN_DUBAI), false);
});

test('a schedule reads the way a person would say it', () => {
    assert.equal(describeSchedule({ cadence: 'daily', hour: 7 }), 'runs daily at 07:00');
    assert.equal(describeSchedule({ cadence: 'weekly', hour: 9, dayOfWeek: 1 }), 'runs every Monday at 09:00');
    assert.equal(describeSchedule({ cadence: 'monthly', hour: 8, dayOfMonth: 1 }), 'runs on the 1st of every month at 08:00');
    assert.equal(describeSchedule({ cadence: 'on_request' }), 'runs on request');
    assert.equal(describeSchedule(null), 'runs on request');
});
