import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    freshState, transition, nextTouchFor, describeStage, mayContactFirst,
    DEFAULT_CADENCE, LEAD_STATUS_FOR, BUCKETS,
} from './buckets.js';

const T0 = new Date('2026-10-01T08:00:00.000Z');
const days = (n) => new Date(T0.getTime() + n * 86_400_000);
const at = (state, event, now = T0) => transition(state, event, { now }).state;

test('a new lead becomes Engaged on the first reply and has no scheduled touch', () => {
    const s = at(freshState(T0), 'first_reply_sent');
    assert.equal(s.bucket, 'engaged');
    assert.equal(s.nextTouchAt, null);
});

test('24 hours of silence moves an engaged lead to Quiet with the day-3 touch scheduled', () => {
    const s = at(at(freshState(T0), 'first_reply_sent'), 'silence', days(1));
    assert.equal(s.bucket, 'quiet');
    assert.equal(s.nextTouchAt.toISOString(), days(1 + 3).toISOString());
    assert.equal(describeStage(s), 'touch 1 of 3');
});

test('the quiet cadence walks day 3, 7, 14 and then falls through to Dormant', () => {
    let s = at(at(freshState(T0), 'first_reply_sent'), 'silence', T0);
    s = at(s, 'touch_sent', days(3));
    assert.equal(describeStage(s), 'touch 2 of 3');
    assert.equal(s.nextTouchAt.toISOString(), days(3 + 7).toISOString());
    s = at(s, 'touch_sent', days(10));
    s = at(s, 'touch_sent', days(24));
    assert.equal(nextTouchFor(s), null, 'three touches used, nothing more scheduled');
    s = at(s, 'exhausted', days(24));
    assert.equal(s.bucket, 'dormant');
    assert.equal(s.nextTouchAt.toISOString(), days(24 + 30).toISOString());
});

test('dormant runs out into Lost, and a Lost lead is never contacted first', () => {
    let s = { ...freshState(T0), bucket: 'dormant', touchCount: 3 };
    s = at(s, 'exhausted');
    assert.equal(s.bucket, 'lost');
    assert.equal(mayContactFirst(s), false);
    assert.equal(nextTouchFor(s), null);
});

test('a reply from any nurture bucket returns the lead to Engaged and cancels the next touch', () => {
    for (const bucket of ['quiet', 'dormant', 'quoted']) {
        const s = at({ ...freshState(T0), bucket, touchCount: 2, nextTouchAt: days(5) }, 'inbound', days(2));
        assert.equal(s.bucket, 'engaged', bucket);
        assert.equal(s.nextTouchAt, null, bucket);
        assert.equal(s.touchCount, 0, bucket);
    }
});

test('a reply to a closed lead is answered but does not reopen it', () => {
    for (const bucket of ['won', 'lost', 'do_not_contact']) {
        const r = transition({ ...freshState(T0), bucket }, 'inbound', { now: T0 });
        assert.equal(r.changed, false, bucket);
        assert.equal(r.state.bucket, bucket);
    }
});

test('quote → confirmed → signed is the selling path, and silence after a quote goes to Quiet', () => {
    let s = at(at(freshState(T0), 'first_reply_sent'), 'quote_sent');
    assert.equal(s.bucket, 'quoted');
    assert.equal(s.nextTouchAt.toISOString(), days(1).toISOString(), 'day-1 check that the quote arrived');
    const quiet = at(s, 'silence');
    assert.equal(quiet.bucket, 'quiet');
    s = at(at(s, 'confirmed'), 'signed');
    assert.equal(s.bucket, 'won');
    assert.equal(mayContactFirst(s), false);
});

test('escalation remembers where the lead was, and hand-back returns it there', () => {
    let s = { ...freshState(T0), bucket: 'quoted', touchCount: 1 };
    s = at(s, 'escalate');
    assert.equal(s.bucket, 'with_person');
    assert.equal(s.previousBucket, 'quoted');
    assert.equal(nextTouchFor(s), null, 'nothing is scheduled while a person has it');
    s = at(s, 'hand_back');
    assert.equal(s.bucket, 'quoted');
});

test('opt-out wins from anywhere and is permanent', () => {
    const s = at({ ...freshState(T0), bucket: 'engaged' }, 'opt_out');
    assert.equal(s.bucket, 'do_not_contact');
    assert.equal(at(s, 'inbound').bucket, 'do_not_contact');
    assert.equal(mayContactFirst(s), false);
});

test('a configured cadence overrides the default', () => {
    const cadence = { ...DEFAULT_CADENCE, quiet: [2, 5] };
    const s = transition({ ...freshState(T0), bucket: 'engaged' }, 'silence', { now: T0, cadence }).state;
    assert.equal(describeStage(s, cadence), 'touch 1 of 2');
});

test('every bucket maps to a human-facing lead status or deliberately leaves it alone', () => {
    for (const bucket of Object.keys(BUCKETS)) {
        assert.ok(bucket in LEAD_STATUS_FOR, `${bucket} has a status mapping`);
    }
    assert.equal(LEAD_STATUS_FOR.with_person, null);
    assert.equal(LEAD_STATUS_FOR.quiet, 'follow_up_scheduled');
});
