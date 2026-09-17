import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLead, behavioralSignals, needsConfirmation, intakeChecklist, BAND_HIGH, BAND_MEDIUM, NEED_SOON_WINDOW_DAYS } from './leadScore.js';

const NOW = new Date('2026-09-10T10:00:00Z');
const daysFromNow = (d) => new Date(NOW.getTime() + d * 864e5);

test('a human override wins outright, whatever the AI signals say', () => {
    const hotLead = { leadType: 'storage_inquiry', temperature: 'hot', turnCount: 10, medianReplyMinutes: 1 };
    assert.deepEqual(
        { score: 0, band: 'low' },
        (({ score, band }) => ({ score, band }))(scoreLead({ ...hotLead, override: 'not_interested' })),
    );
    const coldLead = { leadType: 'job_seeker', temperature: 'cold' };
    assert.deepEqual(
        { score: 90, band: 'high' },
        (({ score, band }) => ({ score, band }))(scoreLead({ ...coldLead, override: 'qualifying' })),
    );
});

test('anything but a genuine enquiry is capped low, however engaged they are', () => {
    for (const leadType of ['job_seeker', 'price_declined', 'not_our_service', 'spam_or_unclear']) {
        const v = scoreLead({ leadType, temperature: 'hot', turnCount: 20, medianReplyMinutes: 1 });
        assert.ok(v.score <= 15, `${leadType} scored ${v.score}, expected capped low`);
        assert.equal(v.band, 'low');
    }
});

test('a genuine enquiry scores up with temperature, specifics, engagement and reply speed', () => {
    const bare = scoreLead({ leadType: 'storage_inquiry', temperature: 'cold' });
    const hot = scoreLead({ leadType: 'storage_inquiry', temperature: 'hot' });
    assert.ok(hot.score > bare.score);

    const specific = scoreLead({ leadType: 'storage_inquiry', temperature: 'warm', budget: 'AED 500/month' });
    const vague = scoreLead({ leadType: 'storage_inquiry', temperature: 'warm' });
    assert.ok(specific.score > vague.score);

    const engaged = scoreLead({ leadType: 'storage_inquiry', temperature: 'warm', turnCount: 5 });
    const oneOff = scoreLead({ leadType: 'storage_inquiry', temperature: 'warm', turnCount: 1 });
    assert.ok(engaged.score > oneOff.score);

    const fast = scoreLead({ leadType: 'storage_inquiry', temperature: 'warm', medianReplyMinutes: 5 });
    const slow = scoreLead({ leadType: 'storage_inquiry', temperature: 'warm', medianReplyMinutes: 600 });
    assert.ok(fast.score > slow.score);
});

test('every band boundary lands where it says it does', () => {
    // hot + specific + engaged + fast: everything on, well past BAND_HIGH.
    const everything = scoreLead({
        leadType: 'storage_inquiry', temperature: 'hot', budget: 'AED 500',
        turnCount: 10, medianReplyMinutes: 5,
    });
    assert.ok(everything.score >= BAND_HIGH);
    assert.equal(everything.band, 'high');

    // cold, nothing else: base only. A genuine enquiry never reads as
    // "low" purely for being quiet so far — that band is reserved for the
    // capped non-inquiry types above; a cold, unengaged real enquiry is
    // "medium, no strong signal yet", not "not worth chasing".
    const nothing = scoreLead({ leadType: 'storage_inquiry', temperature: 'cold' });
    assert.equal(nothing.score, BAND_MEDIUM);
    assert.equal(nothing.band, 'medium');
});

test('scoreLead never returns outside 0-100, whatever combination of signals it is given', () => {
    for (const leadType of ['storage_inquiry', 'job_seeker', 'price_declined', 'not_our_service', 'spam_or_unclear', 'made_up']) {
        for (const temperature of ['hot', 'warm', 'cold', undefined]) {
            const v = scoreLead({ leadType, temperature, turnCount: 999, medianReplyMinutes: 0, budget: 'x' });
            assert.ok(v.score >= 0 && v.score <= 100, `${leadType}/${temperature} -> ${v.score}`);
        }
    }
});

test('a stated need date within the soon window scores like a hot lead, and says so', () => {
    const soon = scoreLead({ leadType: 'storage_inquiry', temperature: 'cold', intendedStartDate: daysFromNow(3), now: NOW });
    assert.equal(soon.signals.daysUntilNeeded, 3);
    assert.ok(soon.reason.includes('needs it within 3 days'));
    const bare = scoreLead({ leadType: 'storage_inquiry', temperature: 'cold', now: NOW });
    assert.ok(soon.score > bare.score);
});

test('a stated need date today or already past reads as "needs it now", not a negative day count', () => {
    const today = scoreLead({ leadType: 'storage_inquiry', temperature: 'cold', intendedStartDate: NOW, now: NOW });
    assert.ok(today.reason.includes('needs it now'));
    const overdue = scoreLead({ leadType: 'storage_inquiry', temperature: 'cold', intendedStartDate: daysFromNow(-5), now: NOW });
    assert.ok(overdue.reason.includes('needs it now'));
});

test('a real future date is never scored down for being unready right now — it counts as specific, not as cold', () => {
    const future = scoreLead({ leadType: 'storage_inquiry', temperature: 'cold', intendedStartDate: daysFromNow(45), now: NOW });
    assert.equal(future.signals.daysUntilNeeded, 45);
    assert.equal(future.signals.specific, true);
    assert.ok(future.reason.includes('needs it from'));
    // Not treated as urgent: no "needs it within N days" bonus for a date
    // this far out.
    assert.ok(!future.reason.includes('needs it within'));
    const bare = scoreLead({ leadType: 'storage_inquiry', temperature: 'cold', now: NOW });
    assert.ok(future.score > bare.score); // still scores up, for being specific
});

test('right at the edge of the soon window, both sides behave as documented', () => {
    const justInside = scoreLead({ leadType: 'storage_inquiry', temperature: 'cold', intendedStartDate: daysFromNow(NEED_SOON_WINDOW_DAYS), now: NOW });
    assert.ok(justInside.reason.includes('needs it within'));
    const justOutside = scoreLead({ leadType: 'storage_inquiry', temperature: 'cold', intendedStartDate: daysFromNow(NEED_SOON_WINDOW_DAYS + 1), now: NOW });
    assert.ok(justOutside.reason.includes('needs it from'));
    assert.ok(justInside.score > justOutside.score);
});

test('a human override still wins over a stated need date', () => {
    const v = scoreLead({ leadType: 'storage_inquiry', intendedStartDate: daysFromNow(2), override: 'not_interested', now: NOW });
    assert.equal(v.score, 0);
});

test('behavioralSignals: turn count is direction changes, not message count', () => {
    const now = new Date('2026-09-10T10:00:00Z');
    const at = (mins) => new Date(now.getTime() + mins * 60000);
    const msgs = [
        { direction: 'inbound', type: 'text', occurredAt: at(0) },
        { direction: 'inbound', type: 'text', occurredAt: at(1) }, // same direction: no new turn
        { direction: 'outbound', type: 'text', occurredAt: at(5) }, // turn 1
        { direction: 'inbound', type: 'text', occurredAt: at(10) }, // turn 2 — replied 5 min after our message
    ];
    const s = behavioralSignals(msgs);
    assert.equal(s.turnCount, 2);
    assert.equal(s.inboundCount, 3);
    assert.equal(s.outboundCount, 1);
    assert.equal(s.medianReplyMinutes, 5);
});

test('behavioralSignals ignores deleted messages and system/reaction rows', () => {
    const now = new Date('2026-09-10T10:00:00Z');
    const msgs = [
        { direction: 'inbound', type: 'text', occurredAt: now },
        { direction: 'inbound', type: 'text', occurredAt: now, deletedAt: now },
        { direction: 'outbound', type: 'reaction', occurredAt: now },
    ];
    const s = behavioralSignals(msgs);
    assert.equal(s.inboundCount, 1);
    assert.equal(s.outboundCount, 0);
});

test('behavioralSignals on no messages, or none from us, never throws and has no reply latency', () => {
    assert.equal(behavioralSignals([]).medianReplyMinutes, null);
    assert.equal(behavioralSignals([{ direction: 'inbound', type: 'text', occurredAt: new Date() }]).medianReplyMinutes, null);
});

test('needsConfirmation: only a genuine enquiry, only after we have actually replied, never twice', () => {
    assert.equal(needsConfirmation({ band: 'high', override: '', outboundCount: 1 }), true);
    assert.equal(needsConfirmation({ band: 'high', override: '', outboundCount: 0 }), false);
    assert.equal(needsConfirmation({ band: 'low', override: '', outboundCount: 3 }), false);
    assert.equal(needsConfirmation({ band: 'high', override: 'qualifying', outboundCount: 3 }), false);
});

test('intakeChecklist: a brand-new lead is missing every fact, with a message suggestion for each customer-facing one', () => {
    const lead = { leadDateTime: new Date('2026-09-01T09:00:00Z'), durationValue: 1, durationUnit: 'month' };
    const c = intakeChecklist(lead);
    assert.deepEqual(c.missing, ['moveInDate', 'lengthOfStay', 'unitSize', 'financiallyQualified', 'locationPreference', 'followUpReminder']);
    assert.equal(c.leadInitiatedAt, lead.leadDateTime);
    assert.equal(c.moveInDate, null);
    assert.equal(c.lengthOfStay, null);
    assert.equal(c.unitSize, null);
    assert.equal(c.financiallyQualified, '');
    assert.equal(c.locationPreference, '');
    assert.equal(c.followUpReminder, null);
    // financiallyQualified and followUpReminder are never something to ask
    // the customer, so only four of the six missing facts get a message.
    assert.equal(c.suggestedMessages.length, 4);
});

test('intakeChecklist: storageSizeValue alone has no meaningful default — 0 (or unset) is always missing, any positive number is always documented', () => {
    const unset = intakeChecklist({});
    assert.ok(unset.missing.includes('unitSize'));
    assert.equal(unset.unitSize, null);

    const zero = intakeChecklist({ storageSizeValue: 0, storageSizeUnit: 'sqft' });
    assert.ok(zero.missing.includes('unitSize'));
    assert.equal(zero.unitSize, null);

    const set = intakeChecklist({ storageSizeValue: 75, storageSizeUnit: 'sqft' });
    assert.ok(!set.missing.includes('unitSize'));
    assert.deepEqual(set.unitSize, { value: 75, unit: 'sqft' });
});

test('intakeChecklist: durationValue/durationUnit alone never count as documented — only lengthOfStayConfirmedAt does', () => {
    const untouched = intakeChecklist({ durationValue: 1, durationUnit: 'month' });
    assert.ok(untouched.missing.includes('lengthOfStay'));
    assert.equal(untouched.lengthOfStay, null);

    const confirmed = intakeChecklist({ durationValue: 3, durationUnit: 'week', lengthOfStayConfirmedAt: new Date() });
    assert.ok(!confirmed.missing.includes('lengthOfStay'));
    assert.deepEqual(confirmed.lengthOfStay, { value: 3, unit: 'week' });
});

test('intakeChecklist: a field drops off the missing list and out of its message suggestion once documented', () => {
    const lead = {
        intendedStartDate: new Date('2026-10-01'),
        lengthOfStayConfirmedAt: new Date(), durationValue: 2, durationUnit: 'month',
        storageSizeValue: 75, storageSizeUnit: 'sqft',
        financiallyQualified: 'yes',
        locationPreference: 'Al Quoz',
        followUpAt: new Date('2026-09-15T10:00:00Z'), followUpNote: 'call back after payday',
    };
    const c = intakeChecklist(lead);
    assert.deepEqual(c.missing, []);
    assert.deepEqual(c.suggestedMessages, []);
    assert.equal(c.moveInDate, lead.intendedStartDate);
    assert.deepEqual(c.lengthOfStay, { value: 2, unit: 'month' });
    assert.deepEqual(c.unitSize, { value: 75, unit: 'sqft' });
    assert.equal(c.financiallyQualified, 'yes');
    assert.equal(c.locationPreference, 'Al Quoz');
    assert.deepEqual(c.followUpReminder, { at: lead.followUpAt, note: 'call back after payday' });
});

test('intakeChecklist: only the still-missing customer-facing facts get a suggested message', () => {
    const c = intakeChecklist({
        intendedStartDate: new Date('2026-10-01'),
        lengthOfStayConfirmedAt: null,
        storageSizeValue: 75, storageSizeUnit: 'sqft',
        locationPreference: '',
    });
    assert.deepEqual(c.missing.filter((k) => ['moveInDate', 'lengthOfStay', 'locationPreference'].includes(k)), ['lengthOfStay', 'locationPreference']);
    assert.equal(c.suggestedMessages.length, 2);
    assert.ok(c.suggestedMessages.some((m) => /store with us/.test(m)));
    assert.ok(c.suggestedMessages.some((m) => /Al Quoz or DIP/.test(m)));
    assert.ok(!c.suggestedMessages.some((m) => /move in/.test(m)));
});
