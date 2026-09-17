import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuietNudge } from './quietNudge.js';

/**
 * The push notification a rep actually reads — pure, so it can be pinned
 * without a database or a push endpoint standing behind it.
 */

test('one quiet lead reads as a sentence, named plainly', () => {
    const notice = buildQuietNudge({
        leads: [{ leadId: 'l1', name: 'Aisha', phone: '971501234567', minutesQuiet: 370 }],
    });
    assert.match(notice.push.title, /Aisha has gone quiet/);
    assert.match(notice.push.body, /6 hours/);
    assert.equal(notice.push.url, '/leads/l1');
    // Tagged by lead, so a second nudge for the same lead replaces the first
    // notification rather than stacking a duplicate on the rep's phone.
    assert.equal(notice.push.tag, 'quiet-nudge-l1');
});

test('several quiet leads read as a count, longest first', () => {
    const notice = buildQuietNudge({
        leads: [
            { leadId: 'l1', name: 'Aisha', phone: '971501234567', minutesQuiet: 370 },
            { leadId: 'l2', name: 'Omar', phone: '971509876543', minutesQuiet: 900 },
        ],
    });
    assert.match(notice.push.title, /2 leads have gone quiet/);
    // Omar has been silent longer, so Omar is the one named in the body.
    assert.match(notice.push.body, /Omar/);
    assert.equal(notice.push.url, '/leads');
    assert.equal(notice.push.tag, 'quiet-nudge');
});

test('a lead with no saved name falls back to their number, never blank', () => {
    const notice = buildQuietNudge({
        leads: [{ leadId: 'l1', name: '', phone: '971501234567', minutesQuiet: 400 }],
    });
    assert.match(notice.push.title, /971501234567/);
});
