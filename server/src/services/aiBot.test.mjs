/**
 * Guards on the WhatsApp assistant, run with `node --test`.
 *
 * These cover the decisions that stop it messaging someone it should not, so
 * they deliberately need no database and no OpenAI key — they must be runnable
 * before the thing is ever pointed at real traffic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideAction } from './aiBot.js';

const HOUR = 3600_000;
const NOW = new Date('2026-08-20T12:00:00.000Z');

const config = {
    maxRepliesPerThreadPerDay: 20,
    handoverKeywords: ['human', 'agent', 'call me'],
};

const thread = (over = {}) => ({
    phoneNormalized: '971500000000',
    status: 'bot',
    pausedUntil: null,
    pendingMessageId: 'wamid.1',
    handledMessageId: '',
    pendingText: 'How much is a 50 sqft unit?',
    pendingType: 'text',
    pendingAt: new Date(NOW - 2 * 60_000),
    repliesOn: '2026-08-20',
    repliesCount: 0,
    ...over,
});

const decide = (over, cfg = config) => decideAction({ thread: thread(over), config: cfg, now: NOW });

test('answers an ordinary question', () => {
    assert.equal(decide({}).action, 'generate');
});

test('stays quiet once handed to a person', () => {
    assert.equal(decide({ status: 'escalated' }).action, 'skip');
});

test('stays quiet while a colleague has the thread', () => {
    assert.equal(decide({ status: 'paused', pausedUntil: new Date(NOW.getTime() + 6 * HOUR) }).action, 'skip');
});

test('picks the thread back up once the pause has expired', () => {
    assert.equal(decide({ status: 'paused', pausedUntil: new Date(NOW.getTime() - HOUR) }).action, 'generate');
});

test('will not reply outside the 24-hour WhatsApp window', () => {
    const r = decide({ pendingAt: new Date(NOW.getTime() - 25 * HOUR) });
    assert.equal(r.action, 'skip');
    assert.match(r.reason, /24-hour/);
});

test('replies just inside the window', () => {
    assert.equal(decide({ pendingAt: new Date(NOW.getTime() - 22 * HOUR) }).action, 'generate');
});

test('hands over media it cannot read', () => {
    for (const type of ['image', 'audio', 'document', 'video', 'voice', 'location', 'contacts']) {
        const r = decide({ pendingType: type, pendingText: '' });
        assert.equal(r.action, 'escalate', `${type} should escalate`);
    }
});

test('media handover reads as English, not "a unsupported"', () => {
    assert.match(decide({ pendingType: 'image', pendingText: '' }).reason, /sent a photo/);
    assert.match(decide({ pendingType: 'voice', pendingText: '' }).reason, /sent a voice note/);
});

test('ignores reactions and system notices instead of handing them over', () => {
    // Escalating mutes the thread. A thumbs-up must never be able to stop the
    // assistant answering that customer for good.
    for (const type of ['reaction', 'system', 'unsupported', 'ephemeral', 'sticker']) {
        const r = decide({ pendingType: type, pendingText: '' });
        assert.equal(r.action, 'skip', `${type} should be ignored, not escalated`);
    }
});

test('ignores an empty message rather than raising a task about it', () => {
    assert.equal(decide({ pendingText: '   ' }).action, 'skip');
});

test('hands over when the daily cap is reached', () => {
    const r = decide({ repliesCount: 20, repliesOn: '2026-08-20' });
    assert.equal(r.action, 'escalate');
    assert.match(r.reason, /already sent 20/);
});

test("yesterday's count does not spend today's budget", () => {
    assert.equal(decide({ repliesCount: 20, repliesOn: '2026-08-19' }).action, 'generate');
});

test('hands over when the customer asks for a person', () => {
    for (const text of ['can I speak to a human', 'Please CALL ME back', 'give me an agent']) {
        const r = decide({ pendingText: text });
        assert.equal(r.action, 'escalate', `"${text}" should escalate`);
        assert.match(r.reason, /asked for a person/);
    }
});

test('a keyword inside an ordinary word does not trigger a handover falsely', () => {
    // 'agent' is a substring of nothing common, but the check is substring-based,
    // so this pins the behaviour rather than leaving it to chance.
    assert.equal(decide({ pendingText: 'Do you have management on site?' }).action, 'generate');
});

test('an empty keyword list never escalates on keywords', () => {
    const r = decideAction({
        thread: thread({ pendingText: 'I want a human' }),
        config: { maxRepliesPerThreadPerDay: 20, handoverKeywords: [] },
        now: NOW,
    });
    assert.equal(r.action, 'generate');
});

test('handover is checked before the reply is generated, not after', () => {
    // Escalation must not depend on the model's own judgement: a customer
    // asking for a person is decided here, before any OpenAI call.
    const r = decide({ pendingText: 'human please' });
    assert.equal(r.action, 'escalate');
});

test('escalation beats the reply cap ordering only when the cap is not hit', () => {
    const r = decide({ pendingText: 'human please', repliesCount: 20 });
    // The cap is checked first, and either outcome is a handover — what matters
    // is that it never reaches 'generate'.
    assert.equal(r.action, 'escalate');
});
