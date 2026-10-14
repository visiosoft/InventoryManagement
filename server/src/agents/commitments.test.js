import test from 'node:test';
import assert from 'node:assert/strict';
import { worthReading, validFollowUpDay, normalise, dubaiDay } from './commitments.js';

const NOW = new Date('2026-10-14T08:00:00Z'); // 12:00 Dubai

test('messages with a time, a decision-maker or a reason are worth reading; chit-chat is not', () => {
    assert.equal(worthReading('please call me in 2 weeks'), true);
    assert.equal(worthReading('I need to ask my wife first'), true);
    assert.equal(worthReading('we are moving flats and need space'), true);
    assert.equal(worthReading('بعد رمضان ان شاء الله'), true);
    assert.equal(worthReading('ok'), false);
    assert.equal(worthReading('thanks'), false);
});

test('reason and decision cues are skipped once the lead already has them', () => {
    assert.equal(worthReading('because we are moving', { needWhy: false, needDecision: false }), false);
});

test('a follow-up day must be a real future day within about a year', () => {
    assert.equal(validFollowUpDay('2026-10-28', NOW), '2026-10-28');
    assert.equal(validFollowUpDay('2026-10-14', NOW), '', 'today is not a follow-up');
    assert.equal(validFollowUpDay('2026-10-01', NOW), '');
    assert.equal(validFollowUpDay('2028-01-01', NOW), '');
    assert.equal(validFollowUpDay('soon', NOW), '');
    assert.equal(dubaiDay(new Date('2026-10-14T21:00:00Z')), '2026-10-15', 'after 20:00 UTC it is already tomorrow in Dubai');
});

test('normalise keeps only complete, quoted proposals', () => {
    const out = normalise({
        followUp: { date: '2026-10-28', reason: 'decide on 35 sqft', quote: 'call me in two weeks' },
        decisionMaker: { name: 'his wife', quote: '' },
        why: { text: 'moving flats', quote: 'we are moving flats' },
    }, NOW);
    assert.equal(out.followUp.date, '2026-10-28');
    assert.equal(out.decisionMaker, null, 'no quote means no proposal');
    assert.equal(out.why.text, 'moving flats');
    assert.deepEqual(normalise(null, NOW), { followUp: null, decisionMaker: null, why: null });
});
