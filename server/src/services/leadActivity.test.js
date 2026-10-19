import test from 'node:test';
import assert from 'node:assert/strict';
import { describeChanges, handOverText } from './leadActivity.js';

test('says what changed, old to new', () => {
    const before = { fullName: 'Kariuki', status: 'new', storageSizeValue: 0, durationValue: 1, durationUnit: 'month', tags: [] };
    const after = { fullName: 'Kariuki George', status: 'contacted', storageSizeValue: 50, durationValue: 3, durationUnit: 'month', tags: ['vip'], whenNeeded: 'Just planning ahead' };
    assert.equal(describeChanges(before, after),
        'Name Kariuki → Kariuki George · Stage New → Contacted · Size not asked → 50 sq ft · When needed — → Just planning ahead · Duration 1 month → 3 months · Tags — → vip');
});

test('nothing changed says nothing', () => {
    const l = { fullName: 'A', status: 'new', storageSizeValue: 0, tags: ['x'], notes: 'n' };
    assert.equal(describeChanges(l, { ...l, tags: ['x'] }), '');
});

test('the hand-over line names who, to whom, and why', () => {
    assert.equal(handOverText({ byName: 'Emad', toName: 'Admin', fromName: 'Emad', note: 'wants a corporate quote' }),
        'Emad sent the lead to Admin — "wants a corporate quote"');
    assert.equal(handOverText({ byName: 'Admin', toName: 'Randa', fromName: 'Emad' }), 'Admin sent the lead to Randa (was Emad)');
    assert.equal(handOverText({ byName: 'Admin', toName: '', fromName: 'Emad' }), 'Admin left the lead unassigned (was Emad)');
});
