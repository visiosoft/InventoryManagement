import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCall, attemptOutcome, callLine, ingestCalls, summariseCalls } from './callLog.js';

test('a call from the phone is normalised; junk is dropped', () => {
    const c = cleanCall({ id: 'a1', number: '050 281 4305', type: 'OUTGOING', timestamp: Date.parse('2026-10-23T08:00:00Z'), duration: 125 });
    assert.equal(c.phoneNormalized, '971502814305');
    assert.equal(c.direction, 'outgoing');
    assert.equal(c.durationSec, 125);
    assert.equal(cleanCall({ number: '123', type: 'outgoing', timestamp: Date.now() }), null);
    assert.equal(cleanCall({ number: '0502814305', type: 'voicemail', timestamp: Date.now() }), null);
});

test('a short outgoing call is no answer; a real one is reached', () => {
    assert.equal(attemptOutcome({ durationSec: 4 }), 'no_answer');
    assert.equal(attemptOutcome({ durationSec: 95 }), 'reached');
    assert.equal(callLine({ direction: 'outgoing', durationSec: 192 }, 'Randa'), '📞 Randa called — answered, 3m 12s');
    assert.equal(callLine({ direction: 'missed', durationSec: 0 }, 'Randa'), '📞 Missed call to Randa');
});

test('personal calls are never stored; lead calls are, once, and outgoing ones count as attempts', async () => {
    const saved = [];
    const attempts = [];
    const lead = { _id: 'L1', timeline: [], save: async () => {} };
    const deps = {
        findLead: async (p) => (p === '971502814305' ? lead : null),
        isCustomer: async () => false,
        exists: async (id) => saved.some((s) => s.deviceCallId === id),
        save: async (doc) => saved.push(doc),
        attempt: async (l, c) => attempts.push(c.direction),
        repName: async () => 'Randa',
    };
    const t = Date.parse('2026-10-23T08:00:00Z');
    const r = await ingestCalls('U1', [
        { id: '1', number: '0502814305', type: 'outgoing', timestamp: t, duration: 60 },
        { id: '2', number: '0509999999', type: 'outgoing', timestamp: t, duration: 300 }, // personal
        { id: '3', number: '0502814305', type: 'missed', timestamp: t + 1000, duration: 0 },
    ], deps);
    assert.deepEqual({ saved: r.saved, ignored: r.ignored, attempts: r.attempts }, { saved: 2, ignored: 1, attempts: 1 });
    assert.ok(!saved.some((s) => s.phoneNormalized === '971509999999'), 'the personal call is not stored');
    assert.equal(lead.timeline.length, 2);
    const again = await ingestCalls('U1', [{ id: '1', number: '0502814305', type: 'outgoing', timestamp: t, duration: 60 }], deps);
    assert.equal(again.duplicates, 1);
});

test('the summary per rep', () => {
    const rows = [
        { user: { _id: 'a', name: 'Emad' }, direction: 'outgoing', durationSec: 120, lead: 'L1' },
        { user: { _id: 'a', name: 'Emad' }, direction: 'outgoing', durationSec: 3, lead: 'L2' },
        { user: { _id: 'a', name: 'Emad' }, direction: 'missed', durationSec: 0, lead: 'L1' },
    ];
    assert.deepEqual(summariseCalls(rows)[0], { userId: 'a', name: 'Emad', made: 2, answered: 1, talkSec: 123, incoming: 0, missed: 1, leads: 2 });
});
