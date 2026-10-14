import test from 'node:test';
import assert from 'node:assert/strict';
import { crmBlock } from './runtime.js';

test('the CRM block carries the follow-up reason, attempts and deal-check answers', () => {
    const out = crmBlock({
        followUpAt: new Date('2026-10-20T00:00:00Z'), followUpNote: 'wants 35 sqft after his move',
        attempts: [{ at: new Date('2026-10-10T00:00:00Z'), outcome: 'reached', note: 'will decide in 2 weeks' }],
        decisionMaker: 'his wife', decisionMakerSpoken: false, whyTheyWant: 'moving flats',
    });
    assert.match(out, /wants 35 sqft after his move/);
    assert.match(out, /1 contact attempt/);
    assert.match(out, /will decide in 2 weeks/);
    assert.match(out, /his wife.*not yet spoken to/);
    assert.match(out, /moving flats/);
});

test('an empty lead gives just the header, and no lead gives nothing', () => {
    assert.equal(crmBlock({}), 'WHAT OUR TEAM HAS RECORDED (from the CRM, not the chat):');
    assert.equal(crmBlock(null), '');
});
