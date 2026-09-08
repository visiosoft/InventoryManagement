import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, summarise, validateForSend, stageFor, priorityOf, windowFor, nextQuietContact } from './followUpQueue.js';
import { isWaitingOnUs } from './chatFollowUp.js';
import { windowOpenFor } from './whatsapp.js';
import { displayNameFor } from './leadNames.js';

/**
 * The queue's decisions, pinned against the scenarios the spec was written
 * around. No database: classify() and validateForSend() are pure on purpose,
 * because whether — and when — a customer gets messaged should be checkable
 * by reading a test, not by watching production.
 */

const NOW = new Date('2026-09-07T10:00:00.000Z'); // 14:00 Dubai
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600_000);
const daysAgo = (d) => hoursAgo(d * 24);
const daysAhead = (d) => hoursAgo(-d * 24);

test('scenario 1: they asked, we answered, they went quiet → customer_quiet, due today', () => {
    const v = classify({ lastInboundAt: daysAgo(4), lastOutboundAt: daysAgo(3), leadStatus: 'contacted' }, { now: NOW });
    assert.equal(v.reason, 'customer_quiet');
    assert.equal(v.window, 'today');
    assert.equal(v.daysWaiting, 3);
});

test('scenario 2: they asked, nobody answered → sales_response_overdue, now — never customer_quiet', () => {
    const v = classify({ lastInboundAt: hoursAgo(2), lastOutboundAt: daysAgo(5), leadStatus: 'contacted' }, { now: NOW });
    assert.equal(v.reason, 'sales_response_overdue');
    assert.equal(v.window, 'now');
    assert.equal(v.windowOpen, true);
});

test('scenario 3: once we reply, a waiting customer is no longer waiting', () => {
    const before = classify({ lastInboundAt: hoursAgo(1), lastOutboundAt: daysAgo(1), leadStatus: 'contacted' }, { now: NOW });
    assert.equal(before.reason, 'sales_response_overdue');
    const after = classify({ lastInboundAt: hoursAgo(1), lastOutboundAt: hoursAgo(0.5), leadStatus: 'contacted' }, { now: NOW });
    // We spoke last half an hour ago: not waiting, not due — first follow-up is 3 days out.
    assert.equal(after.reason, 'customer_quiet');
    assert.equal(after.window, 'in_3_days');
});

test('scenarios 5 & 6: converted or lost → nothing, whatever the conversation looks like', () => {
    for (const leadStatus of ['won', 'lost', 'already_customer']) {
        assert.equal(classify({ lastInboundAt: daysAgo(10), lastOutboundAt: daysAgo(9), leadStatus }, { now: NOW }), null);
        assert.equal(classify({ lastInboundAt: hoursAgo(1), leadStatus }, { now: NOW }), null);
    }
});

test('never spoken to at all → not in the queue', () => {
    assert.equal(classify({ leadStatus: 'new' }, { now: NOW }), null);
});

test('what happens when today\'s row is followed up: it leaves today and lands in 7 days', () => {
    // A customer waiting on us. We reply with a template — the send log
    // records it even if the chat log does not.
    const before = classify({ lastInboundAt: daysAgo(2), leadStatus: 'contacted' }, { now: NOW });
    assert.equal(before.window, 'now');
    const after = classify({ lastInboundAt: daysAgo(2), lastSentAt: NOW, sentSinceReply: 1, leadStatus: 'contacted' }, { now: NOW });
    assert.equal(after.reason, 'customer_quiet');
    assert.equal(after.window, 'in_7_days');
    // Same for a quiet lead due today for its first follow-up.
    const quietDue = classify({ lastOutboundAt: daysAgo(3), leadStatus: 'contacted' }, { now: NOW });
    assert.equal(quietDue.window, 'today');
    const quietAfter = classify({ lastOutboundAt: daysAgo(3), lastSentAt: NOW, sentSinceReply: 1, leadStatus: 'contacted' }, { now: NOW });
    assert.equal(quietAfter.window, 'in_7_days');
});

test('a chat left unanswered for years is history, not "needs reply now"', () => {
    // Nothing from us, ever, and their message is far outside the 30-day bound.
    assert.equal(classify({ lastInboundAt: daysAgo(400), leadStatus: 'contacted' }, { now: NOW }), null);
    // Inside the bound it is exactly the reply-needed case.
    assert.equal(classify({ lastInboundAt: daysAgo(20), leadStatus: 'contacted' }, { now: NOW }).window, 'now');
});

test('waiting-on-us wins over everything else when both apply', () => {
    const v = classify({
        lastInboundAt: hoursAgo(3), lastOutboundAt: daysAgo(6), leadStatus: 'contacted',
        followUpAt: daysAgo(1), sequenceExhaustedAt: daysAgo(2),
    }, { now: NOW });
    assert.equal(v.reason, 'sales_response_overdue');
});

/* ── the cadence: the thing that stops a customer being messaged daily ─── */

test('messaged yesterday: not today — first follow-up is 3 days after we last spoke', () => {
    const v = classify({ lastOutboundAt: daysAgo(1), leadStatus: 'contacted' }, { now: NOW });
    assert.equal(v.reason, 'customer_quiet');
    assert.equal(v.window, 'in_3_days');
    assert.equal(windowFor(v.nextContactAt, NOW), 'in_3_days');
});

test('after the first follow-up went out, the next is 7 days after it — not tomorrow', () => {
    const v = classify({ lastOutboundAt: daysAgo(10), lastSentAt: daysAgo(1), sentSinceReply: 1, leadStatus: 'contacted' }, { now: NOW });
    assert.equal(v.window, 'in_7_days');
    assert.equal(Math.round((v.nextContactAt - daysAgo(1)) / 864e5), 7);
});

test('after the second, 14 days; after the third, nobody is messaged automatically again', () => {
    const second = classify({ lastOutboundAt: daysAgo(20), lastSentAt: daysAgo(2), sentSinceReply: 2, leadStatus: 'contacted' }, { now: NOW });
    assert.equal(second.window, 'later');
    const third = classify({ lastOutboundAt: daysAgo(40), lastSentAt: daysAgo(15), sentSinceReply: 3, leadStatus: 'contacted' }, { now: NOW });
    assert.equal(third.window, 'exhausted');
    assert.equal(third.reasonDetail, 'exhausted');
    assert.equal(third.nextContactAt, null);
});

test('the follow-up that is due lands on today, and an overdue one is still today, not lost', () => {
    const due = classify({ lastOutboundAt: daysAgo(10), lastSentAt: daysAgo(7), sentSinceReply: 1, leadStatus: 'contacted' }, { now: NOW });
    assert.equal(due.window, 'today');
    const overdue = classify({ lastOutboundAt: daysAgo(30), lastSentAt: daysAgo(12), sentSinceReply: 1, leadStatus: 'contacted' }, { now: NOW });
    assert.equal(overdue.window, 'today');
});

test('a customer reply resets the count: the cadence starts again from our next message', () => {
    // Two follow-ups went out, then they replied, then we replied yesterday. sentSinceReply is 0 again.
    const v = classify({ lastInboundAt: daysAgo(2), lastOutboundAt: daysAgo(1), lastSentAt: daysAgo(5), sentSinceReply: 0, leadStatus: 'contacted' }, { now: NOW });
    assert.equal(v.window, 'in_3_days');
});

test('nextQuietContact counts from whichever was later — the chat or the follow-up send', () => {
    const fromSend = nextQuietContact({ lastOutboundAt: daysAgo(9), lastSentAt: daysAgo(2), sentSinceReply: 1 });
    assert.equal(Math.round((fromSend.nextContactAt - daysAgo(2)) / 864e5), 7);
    const fromChat = nextQuietContact({ lastOutboundAt: daysAgo(1), lastSentAt: daysAgo(6), sentSinceReply: 1 });
    assert.equal(Math.round((fromChat.nextContactAt - daysAgo(1)) / 864e5), 7);
});

test('a scheduled follow-up appears on its day: past or today → today, else its own bucket', () => {
    assert.equal(classify({ lastOutboundAt: daysAgo(10), leadStatus: 'contacted', followUpAt: daysAgo(1) }, { now: NOW }).window, 'today');
    assert.equal(classify({ lastOutboundAt: daysAgo(1), leadStatus: 'contacted', followUpAt: daysAhead(1) }, { now: NOW }).window, 'tomorrow');
    const wk = classify({ lastOutboundAt: daysAgo(1), leadStatus: 'contacted', followUpAt: daysAhead(6) }, { now: NOW });
    assert.equal(wk.window, 'in_7_days');
    assert.equal(wk.reasonDetail, 'scheduled');
});

test('windowFor buckets by Dubai day, not by 24-hour spans', () => {
    // 23:30 Dubai tonight is still today; 00:30 Dubai is tomorrow.
    const dubai = (h) => new Date(Date.UTC(2026, 8, 7, h - 4, 30));
    assert.equal(windowFor(dubai(23), NOW), 'today');
    assert.equal(windowFor(dubai(24), NOW), 'tomorrow');
    assert.equal(windowFor(daysAhead(3), NOW), 'in_3_days');
    assert.equal(windowFor(daysAhead(7), NOW), 'in_7_days');
    assert.equal(windowFor(daysAhead(8), NOW), 'later');
});

test('priority is not time alone: a hot lead quiet 3 days beats a cold one quiet 10', () => {
    const hot = classify({ lastOutboundAt: daysAgo(3), leadStatus: 'contacted', temperature: 'hot', nextAction: 'Send availability' }, { now: NOW });
    const cold = classify({ lastOutboundAt: daysAgo(10), leadStatus: 'contacted', temperature: 'cold' }, { now: NOW });
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

test('the counts the cards show: only what is due counts as work; the rest is by day', () => {
    const s = summarise([
        { reason: 'sales_response_overdue', window: 'now', daysWaiting: 2, temperature: 'hot', nextAction: 'x' },
        { reason: 'customer_quiet', window: 'today', daysWaiting: 5, temperature: 'hot' },
        { reason: 'customer_quiet', window: 'tomorrow', daysWaiting: 2, temperature: 'hot', nextAction: 'y' },
        { reason: 'customer_quiet', window: 'in_3_days', daysWaiting: 1 },
        { reason: 'customer_quiet', window: 'in_7_days', daysWaiting: 1 },
        { reason: 'manual_followup_due', reasonDetail: 'overdue_date', window: 'today', daysWaiting: 3 },
        { reason: 'customer_quiet', reasonDetail: 'exhausted', window: 'exhausted', daysWaiting: 20 },
    ]);
    assert.equal(s.total, 7);
    assert.equal(s.due, 4);
    assert.deepEqual(s.windows, { now: 1, today: 2, tomorrow: 1, in_3_days: 1, in_7_days: 1, later: 0, exhausted: 1 });
    assert.equal(s.needsReply, 1);
    assert.equal(s.hot, 2);        // the tomorrow one is not today's work
    assert.equal(s.aiSuggested, 1);
    assert.equal(s.overdue, 2);
});

test('stage is derived from sends since they last spoke, and says when the cadence is spent', () => {
    assert.equal(stageFor(0).label, 'Follow-up 1 of 3');
    assert.equal(stageFor(2).label, 'Follow-up 3 of 3');
    assert.equal(stageFor(3).exhausted, true);
});

/* ── the send guard ─────────────────────────────────────────────────────── */

const OPEN = { leadStatus: 'contacted', phone: '971500000000', phoneNormalized: '971500000000', reason: 'customer_quiet', since: daysAgo(4) };
const TPL = { name: 'general_followup' };

test('scenario 8: a customer who replied after the list was drawn is excluded', () => {
    const v = validateForSend(OPEN, { template: TPL, now: NOW, snapshotAt: hoursAgo(3), latestInboundAt: hoursAgo(2) });
    assert.deepEqual(v, { ok: false, reason: 'replied_since_snapshot' });
});

test('scenario 9: the same lead sent to an hour ago is refused — one click, one message', () => {
    assert.deepEqual(validateForSend(OPEN, { template: TPL, now: NOW, lastSentAt: hoursAgo(1) }), { ok: false, reason: 'sent_recently' });
    assert.equal(validateForSend(OPEN, { template: TPL, now: NOW, lastSentAt: hoursAgo(1), confirmResend: true }).ok, true);
});

test('not due yet is refused too — the cadence is enforced, not just displayed', () => {
    const v = validateForSend(OPEN, { template: TPL, now: NOW, lastSentAt: daysAgo(1), nextContactAt: daysAhead(6) });
    assert.deepEqual(v, { ok: false, reason: 'not_due_yet' });
    // Due later today is fine.
    assert.equal(validateForSend(OPEN, { template: TPL, now: NOW, lastSentAt: daysAgo(3), nextContactAt: hoursAgo(-2) }).ok, true);
    // An explicit override still gets through — a person decided.
    assert.equal(validateForSend(OPEN, { template: TPL, now: NOW, lastSentAt: daysAgo(1), nextContactAt: daysAhead(6), confirmResend: true }).ok, true);
});

test('a spent cadence is refused until somebody decides', () => {
    assert.equal(validateForSend(OPEN, { template: TPL, now: NOW, lastSentAt: daysAgo(20), exhausted: true }).reason, 'exhausted');
    assert.equal(validateForSend(OPEN, { template: TPL, now: NOW, lastSentAt: daysAgo(20), exhausted: true, confirmResend: true }).ok, true);
});

test('an active tenant is not a lead: refused by default, allowed only by its own explicit tick', () => {
    const tenant = { ...OPEN, customer: { status: 'active', contracts: [{ contractNo: 'PB-2026-0369', unit: 'F3-112' }] } };
    assert.equal(validateForSend(tenant, { template: TPL, now: NOW }).reason, 'active_customer');
    // The cadence override is a different decision and does not cover this.
    assert.equal(validateForSend(tenant, { template: TPL, now: NOW, confirmResend: true }).reason, 'active_customer');
    assert.equal(validateForSend(tenant, { template: TPL, now: NOW, allowCustomers: true }).ok, true);
    // A former tenant is a real lead again.
    assert.equal(validateForSend({ ...OPEN, customer: { status: 'former', contracts: [] } }, { template: TPL, now: NOW }).ok, true);
});

test('closed, phoneless and opted-out leads are never sent to, override or not', () => {
    assert.equal(validateForSend({ ...OPEN, leadStatus: 'won' }, { template: TPL, now: NOW, confirmResend: true }).reason, 'closed_lead');
    assert.equal(validateForSend({ ...OPEN, phone: '', phoneNormalized: '' }, { template: TPL, now: NOW }).reason, 'no_phone');
    assert.equal(validateForSend({ ...OPEN, optedOut: true }, { template: TPL, now: NOW, confirmResend: true }).reason, 'opted_out');
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

test('a placeholder-named lead is shown by their Customer record, then their WhatsApp name, never "WhatsApp Contact"', () => {
    const ph = { fullName: 'WhatsApp Contact 5892', whatsappProfileName: 'Ahmed K' };
    assert.equal(displayNameFor(ph, 'Ahmed Khan'), 'Ahmed Khan');
    assert.equal(displayNameFor(ph), 'Ahmed K');
    assert.equal(displayNameFor({ fullName: 'WhatsApp Contact 5892' }), 'WhatsApp Contact 5892');
    // A name a rep typed in wins over everything.
    assert.equal(displayNameFor({ fullName: 'Sara Ali', whatsappProfileName: 'S' }, 'Spring 7'), 'Sara Ali');
    assert.equal(displayNameFor({}), 'Unknown');
});
