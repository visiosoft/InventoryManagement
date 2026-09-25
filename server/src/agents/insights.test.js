import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHandover, shapeStats } from './insights.js';

test('hand-over reasons are grouped the way a manager would group them', () => {
    assert.equal(classifyHandover('Handed to a person: customer asked for a discount to AED 600'), 'discount');
    assert.equal(classifyHandover('Handed to a person: question about the October invoice'), 'account');
    assert.equal(classifyHandover('Handed to a person: Reply contained figures not backed by a tool result: 700'), 'figures');
    assert.equal(classifyHandover('Handed to a person: Ran out of tool rounds without answering'), 'limits');
    assert.equal(classifyHandover('Handed to a person: No approved template was chosen for this touch'), 'template');
    assert.equal(classifyHandover('Handed to a person: customer wants to speak to someone'), 'person');
    assert.equal(classifyHandover('Handed to a person: unusual request about a boat'), 'other');
});

const NOW = new Date('2026-09-26T09:00:00.000Z');
const act = (kind, extra = {}) => ({ kind, summary: '', lead: 'L1', at: NOW, ...extra });

test('the numbers a stats page shows are counted from actions and files', () => {
    const actions = [
        act('reply_drafted', { lead: 'L1' }), act('reply_drafted', { lead: 'L2' }), act('touch_proposed', { lead: 'L3' }),
        act('approved'), act('approved'), act('edited'), act('dismissed'),
        act('escalated', { summary: 'Handed to a person: discount asked' }), act('escalated', { summary: 'Handed to a person: invoice' }), act('escalated', { summary: 'Handed to a person: another discount' }),
        act('bucket_moved', { bucketBefore: 'quiet', bucketAfter: 'engaged' }), act('bucket_moved', { bucketBefore: 'engaged', bucketAfter: 'quoted' }), act('bucket_moved', { bucketBefore: 'quoted', bucketAfter: 'booking' }),
        act('handoff'),
    ];
    const files = [{ bucket: 'quiet' }, { bucket: 'quiet' }, { bucket: 'engaged' }];
    const s = shapeStats(actions, files, { now: NOW, days: 3 });
    assert.equal(s.leadsInCare, 3);
    assert.equal(s.peopleApproached, 3, 'distinct leads touched');
    assert.equal(s.drafts, 2); assert.equal(s.touchesProposed, 1);
    assert.equal(s.approvedRate, 50, '2 approved of 4 judged');
    assert.equal(s.handedOver, 3); assert.equal(s.handedIn, 1);
    assert.deepEqual(s.handovers[0], { key: 'discount', label: 'Discount asked', n: 2 }, 'most common reason first');
    assert.equal(s.cameBack, 1); assert.equal(s.toQuoted, 1); assert.equal(s.toBooking, 1);
    assert.deepEqual(s.buckets, { quiet: 2, engaged: 1 });
    assert.equal(s.series.length, 3);
    assert.equal(s.series[2].drafted, 3, 'today has all three drafts');
});

test('with nothing judged yet the approval rate is unknown, not zero', () => {
    const s = shapeStats([act('reply_drafted')], [], { now: NOW, days: 1 });
    assert.equal(s.approvedRate, null);
});
