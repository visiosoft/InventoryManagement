import test from 'node:test';
import assert from 'node:assert/strict';
import { dubaiDayStart, tallyTeam } from './followUpTeam.js';

test('the day starts at midnight in Dubai, not UTC', () => {
    // 21:30 UTC on the 17th is 01:30 on the 18th in Dubai.
    assert.equal(dubaiDayStart(new Date('2026-10-17T21:30:00Z')).toISOString(), '2026-10-17T20:00:00.000Z');
});

test('per rep: sent today, and sent / replied over the week', () => {
    const now = new Date('2026-10-18T10:00:00Z');
    const reps = tallyTeam([
        { sentBy: 'a', sentByName: 'Emad', status: 'sent', sentAt: '2026-10-18T05:00:00Z', repliedAt: '2026-10-18T06:00:00Z' },
        { sentBy: 'a', sentByName: 'Emad', status: 'sent', sentAt: '2026-10-15T05:00:00Z', repliedAt: null },
        { sentBy: 'b', sentByName: 'Randa', status: 'sent', sentAt: '2026-10-17T21:00:00Z', repliedAt: null },
        { sentBy: 'b', sentByName: 'Randa', status: 'failed', sentAt: '2026-10-18T05:00:00Z' },
        { sentBy: null, status: 'sent', sentAt: '2026-10-18T05:00:00Z' },
    ], now);
    assert.deepEqual(reps, [
        { ownerId: 'a', name: 'Emad', sentToday: 1, sentWeek: 2, repliedWeek: 1 },
        { ownerId: 'b', name: 'Randa', sentToday: 1, sentWeek: 1, repliedWeek: 0 },
    ]);
});
