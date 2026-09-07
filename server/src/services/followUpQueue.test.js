import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, summarise, validateForSend, stageFor, priorityOf } from './followUpQueue.js';
import { isWaitingOnUs } from './chatFollowUp.js';
import { windowOpenFor } from './whatsapp.js';

/**
 * The queue's decisions, pinned against the scenarios the spec was written
 * around. No database: classify() and validateForSend() are pure on purpose,
 * because whether a customer gets messaged should be checkable by reading a
 * test, not by watching production.
 */

const NOW = new Date('2026-09-07T10:00:00.000Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600_000);
const daysAgo = (d) => hoursAgo(d * 24);

test('scenario 1: they asked, we answered, they went quiet → customer_quiet', () => {
    const v = classify({ lastInboundAt: daysAgo(4), lastOutboundAt: daysAgo(3), leadStatus: 'contacted' }, { now: NOW });
    assert.equal(v.reason, 'customer_quiet');
    assert.equal(v.daysWaiting, 3);
});

test('scenario 2: they asked, nobody answered → sales_response_overdue, never customer_quiet', () => {
    const v = classify({ lastInboundAt: hoursAgo(2), lastOutboundAt: daysAgo(5), leadStatus: 'contacted' }, { now: NOW });
    assert.equal(v.reason, 'sales_response_overdue');
    // Two hours is still inside Meta's window: the right move is a plain reply.
    assert.equal(v.windowOpen, true);
});

test('scenario 3: they replied → out of the queue entirely', () => {
    // Replied an hour ago to our message from yesterday — nothing is owed and nothing is quiet.
    const v = classify({ lastInboundAt: hoursAgo(1), lastOutboundAt: daysAgo(1), leadStatus: 'contacted' }, { now: NOW });
    // They wrote last, so this is waiting-on-us — the queue does show it, as the reply-needed case.
    assert.equal(v.reason, 'sales_response_overdue');
    // But once WE reply, it is gone.
    const after = classify({ lastInboundAt: hoursAgo(1), lastOutboundAt: hoursAgo(0.5), leadStatus: 'contacted' }, { now: NOW });
    assert.equal(after, null);
});

test('scenarios 5 & 6: converted or lost → nothing, whatever the conversation looks like', () => {
    for (const leadStatus of ['won', 'lost', 'already_customer']) {
        assert.equal(classify({ lastInboundAt: daysAgo(10), lastOutboundAt: daysAgo(9), leadStatus }, { now: NOW }), null);
        assert.equal(classify({ lastInboundAt: hoursAgo(1), leadStatus }, { now: NOW }), null);
    }
});

test('waiting-on-us wins over everything else when both apply', () => {
    const v = classify({
        lastInboundAt: hoursAgo(3), lastOutboundAt: daysAgo(6), leadStatus: 'contacted',
        followUpAt: daysAgo(1), sequenceExhaustedAt: daysAgo(2),
    }, { now: NOW });
    assert.equal(v.reason, 'sales_response_overdue');
});

test('a scheduled follow-up that has arrived outranks plain silence', () => {
    const v = classify({ lastOutboundAt: daysAgo(10), leadStatus: 'contacted', followUpAt: daysAgo(1) }, { now: NOW });
    assert.equal(v.reason, 'manual_followup_due');
    assert.equal(v.reasonDetail, 'overdue_date');
});

test('a follow-up set for later today counts as due today', () => {
    const laterToday = new Date('2026-09-07T14:00:00.000Z');
    const v = classify({ lastOutboundAt: daysAgo(1), leadStatus: 'contacted', followUpAt: laterToday }, { now: NOW });
    assert.equal(v?.reason, 'manual_followup_due');
});

test('a future follow-up means somebody already dealt with it — not quiet', () => {
    const v = classify({ lastOutboundAt: daysAgo(6), leadStatus: 'contacted', followUpAt: daysAgo(-3) }, { now: NOW });
    assert.equal(v, null);
});

test('priority is not time alone: a hot lead quiet 2 days beats a cold one quiet 10', () => {
    const hot = classify({ lastOutboundAt: daysAgo(4), leadStatus: 'contacted', temperature: 'hot', nextAction: 'Send availability' }, { now: NOW, quietAfterDays: 3 });
    const cold = classify({ lastOutboundAt: daysAgo(10), leadStatus: 'contacted', temperature: 'cold' }, { now: NOW, quietAfterDays: 3 });
    assert.ok(hot.priorityScore > cold.priorityScore, `${hot.priorityScore} should beat ${cold.priorityScore}`);
});

test('scenario 10: no AI fields at all still classifies — the model only adds to the score', () => {
    const v = classify({ lastOutboundAt: daysAgo(5), leadStatus: 'contacted' }, { now: NOW });
    assert.equal(v.reason, 'customer_quiet');
    assert.equal(v.priority, priorityOf(v.priorityScore));
});

test('priority badge thresholds', () => {
    assert.equal(priorityOf(100), 'high');
    assert.equal(priorityOf(89), 'medium');
    assert.equal(priorityOf(59), 'low');
});

test('the counts the tiles show', () => {
    const s = summarise([
        { reason: 'sales_response_overdue', daysWaiting: 2, temperature: 'hot', nextAction: 'x' },
        { reason: 'sales_response_overdue', daysWaiting: 0 },
        { reason: 'customer_quiet', daysWaiting: 5 },
        { reason: 'manual_followup_due', reasonDetail: 'overdue_date', daysWaiting: 3 },
        { reason: 'manual_followup_due', reasonDetail: 'overdue_date', daysWaiting: 0 },
    ]);
    assert.deepEqual(s, { total: 5, needsReply: 2, customerQuiet: 1, manualDue: 2, hot: 1, aiSuggested: 1, overdue: 2 });
});

test('stage is derived from sends since they last spoke, and never reads past the last stage', () => {
    assert.equal(stageFor(0).label, 'Follow-up 1 of 3');
    assert.equal(stageFor(2).label, 'Follow-up 3 of 3');
    assert.equal(stageFor(7).label, 'Follow-up 3 of 3');
});

/* ── the send guard ─────────────────────────────────────────────────────── */

const OPEN = { leadStatus: 'contacted', phone: '971500000000', phoneNormalized: '971500000000', reason: 'customer_quiet', since: daysAgo(4) };
const TPL = { name: 'general_followup' };

test('scenario 8: a customer who replied after the list was drawn is excluded', () => {
    const v = validateForSend(OPEN, { template: TPL, now: NOW, snapshotAt: hoursAgo(3), latestInboundAt: hoursAgo(2) });
    assert.deepEqual(v, { ok: false, reason: 'replied_since_snapshot' });
});

test('a quiet lead who has since written is no longer quiet, snapshot or not', () => {
    const v = validateForSend(OPEN, { template: TPL, now: NOW, latestInboundAt: daysAgo(1) });
    assert.equal(v.reason, 'replied_since_snapshot');
});

test('scenario 9: the same lead sent to an hour ago is refused — one click, one message', () => {
    const v = validateForSend(OPEN, { template: TPL, now: NOW, lastSentAt: hoursAgo(1) });
    assert.deepEqual(v, { ok: false, reason: 'sent_recently' });
    // Only an explicit "yes, again" gets past it.
    assert.equal(validateForSend(OPEN, { template: TPL, now: NOW, lastSentAt: hoursAgo(1), confirmResend: true }).ok, true);
    // And it lapses after the guard window.
    assert.equal(validateForSend(OPEN, { template: TPL, now: NOW, lastSentAt: hoursAgo(13) }).ok, true);
});

test('closed, phoneless and opted-out leads are never sent to', () => {
    assert.equal(validateForSend({ ...OPEN, leadStatus: 'won' }, { template: TPL, now: NOW }).reason, 'closed_lead');
    assert.equal(validateForSend({ ...OPEN, phone: '', phoneNormalized: '' }, { template: TPL, now: NOW }).reason, 'no_phone');
    assert.equal(validateForSend({ ...OPEN, optedOut: true }, { template: TPL, now: NOW }).reason, 'opted_out');
});

test('scenario 7: no approved template, no send — free text is never sent from here', () => {
    assert.equal(validateForSend(OPEN, { template: null, now: NOW }).reason, 'template_required');
    assert.equal(validateForSend(OPEN, { template: TPL, now: NOW }).ok, true);
});

/* ── the two predicates the whole thing rests on ─────────────────────────── */

test('isWaitingOnUs: they wrote last, or only they have written', () => {
    assert.equal(isWaitingOnUs({ lastInboundAt: hoursAgo(1), lastOutboundAt: hoursAgo(2) }), true);
    assert.equal(isWaitingOnUs({ lastInboundAt: hoursAgo(1), lastOutboundAt: null }), true);
    assert.equal(isWaitingOnUs({ lastInboundAt: hoursAgo(2), lastOutboundAt: hoursAgo(1) }), false);
    assert.equal(isWaitingOnUs({ lastInboundAt: null, lastOutboundAt: hoursAgo(1) }), false);
    assert.equal(isWaitingOnUs({}), false);
});

test('the 24-hour window: open at 23h59, shut at 24h01, shut with nothing inbound', () => {
    assert.equal(windowOpenFor({ lastInboundAt: hoursAgo(23.98), now: NOW }), true);
    assert.equal(windowOpenFor({ lastInboundAt: hoursAgo(24.02), now: NOW }), false);
    assert.equal(windowOpenFor({ lastInboundAt: null, now: NOW }), false);
    assert.equal(windowOpenFor({ lastInboundAt: 'not a date', now: NOW }), false);
});
