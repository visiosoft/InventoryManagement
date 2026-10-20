import test from 'node:test';
import assert from 'node:assert/strict';
import { mergedStatus, planMerge, suggestKeep } from './leadMerge.js';

test('the merged stage is the further one; won wins, lost loses to anything live', () => {
    assert.equal(mergedStatus('new', 'quotation_sent'), 'quotation_sent');
    assert.equal(mergedStatus('site_visit_scheduled', 'quotation_sent'), 'quotation_sent');
    assert.equal(mergedStatus('lost', 'contacted'), 'contacted');
    assert.equal(mergedStatus('won', 'lost'), 'won');
    assert.equal(mergedStatus('lost', 'lost'), 'lost');
});

test('Inez: the WhatsApp copy is kept and takes the quote stage, size and the owner who worked it last', () => {
    const whatsapp = { _id: 'w', fullName: 'Inez', phoneNormalized: '971542662555', status: 'site_visit_scheduled', storageSizeValue: 0, owner: 'other', updatedAt: '2026-10-12', tags: [] };
    const manual = { _id: 'm', fullName: 'Inez', phoneNormalized: '0542662555', status: 'quotation_sent', storageSizeValue: 100, owner: 'randa', updatedAt: '2026-10-20', tags: [] };
    assert.equal(suggestKeep(whatsapp, manual, { aChat: 40, bChat: 0 })._id, 'w');
    const set = planMerge(whatsapp, manual);
    assert.equal(set.status, 'quotation_sent');
    assert.equal(set.storageSizeValue, 100);
    assert.equal(set.owner, 'randa');
    assert.equal(planMerge(whatsapp, manual, { ownerId: 'other' }).owner, undefined, 'an owner chosen by the admin wins');
});

test('a real name replaces a placeholder, never the other way round', () => {
    const a = { fullName: 'Lead 161', status: 'new', tags: [] };
    const b = { fullName: 'Kariuki George', firstName: 'Kariuki', lastName: 'George', status: 'new', tags: [] };
    assert.equal(planMerge(a, b).fullName, 'Kariuki George');
    assert.equal(planMerge(b, a).fullName, undefined);
});
