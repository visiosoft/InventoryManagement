import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from './reportAgent.js';
import { blockCatalogue, blockNames, BLOCKS } from './reportBlocks.js';

/**
 * The validator is where a report earns its trust.
 *
 * Everything the model returns is treated as a proposal from something that
 * cannot be relied upon to be right. It is checked against the catalogue and
 * rejected outright when it does not fit — never repaired, because a quietly
 * corrected plan answers a question nobody asked, which is far harder to spot
 * than a refusal.
 */

const good = {
    title: 'Al Quoz — what is free',
    intro: 'Vacant units by size.',
    sections: [
        { type: 'stat', block: 'occupancy_now', params: {}, caption: 'Where we stand' },
        { type: 'table', block: 'units_available', params: { sizeSqf: 50 }, caption: 'The 50 sq ft units' },
    ],
    closing: 'Plenty of small units free.',
};

test('a well-formed plan passes and keeps its sections', () => {
    const out = validateSpec(good);
    assert.equal(out.ok, true);
    assert.equal(out.spec.sections.length, 2);
    assert.equal(out.spec.sections[0].block, 'occupancy_now');
    assert.equal(out.spec.title, 'Al Quoz — what is free');
});

test('a block that does not exist is refused, not skipped', () => {
    const out = validateSpec({ ...good, sections: [{ type: 'table', block: 'tenants_likely_to_leave', params: {} }] });
    assert.equal(out.ok, false);
    assert.match(out.errors.join(' '), /no such block "tenants_likely_to_leave"/);
});

test('a parameter the block does not declare is refused', () => {
    // The model inventing a filter is how a report ends up quietly covering
    // the wrong period while looking exactly right.
    const out = validateSpec({ ...good, sections: [{ type: 'table', block: 'units_available', params: { floor: 'F2' } }] });
    assert.equal(out.ok, false);
    assert.match(out.errors.join(' '), /has no parameter "floor"/);
});

test('a date that is not a date is refused', () => {
    const out = validateSpec({ ...good, sections: [{ type: 'table', block: 'contracts_expiring', params: { from: 'next Tuesday' } }] });
    assert.equal(out.ok, false);
    assert.match(out.errors.join(' '), /"from" is not a date/);
});

test('a number that is not a number is refused', () => {
    const out = validateSpec({ ...good, sections: [{ type: 'chart', block: 'move_ins_outs', params: { months: 'a few' } }] });
    assert.equal(out.ok, false);
    assert.match(out.errors.join(' '), /"months" is not a number/);
});

test('an empty plan is refused rather than rendered blank', () => {
    assert.equal(validateSpec({ ...good, sections: [] }).ok, false);
    assert.equal(validateSpec(null).ok, false);
    assert.equal(validateSpec('nonsense').ok, false);
});

test('an over-long plan is refused', () => {
    const many = Array.from({ length: 9 }, () => ({ type: 'stat', block: 'occupancy_now', params: {} }));
    const out = validateSpec({ ...good, sections: many });
    assert.equal(out.ok, false);
    assert.match(out.errors.join(' '), /limit is 6/);
});

test('a question outside the data declines, and says why', () => {
    const out = validateSpec({ answerable: false, reason: 'There is no weather data in this system.' });
    assert.equal(out.ok, false);
    assert.equal(out.unanswerable, true);
    assert.match(out.reason, /no weather data/);
    assert.equal(out.errors, undefined, 'a decline is not an error to show as a fault');
});

test('a missing section type falls back to the block’s own shape', () => {
    // A chart of a table would render as nothing; the block knows what it is.
    const out = validateSpec({ ...good, sections: [{ block: 'move_ins_outs', params: {} }] });
    assert.equal(out.ok, true);
    assert.equal(out.spec.sections[0].type, 'chart');

    const table = validateSpec({ ...good, sections: [{ block: 'units_available', params: {} }] });
    assert.equal(table.spec.sections[0].type, 'table');
});

test('every block in the catalogue is described well enough to be chosen', () => {
    // The catalogue is the model's entire view of the data. A block with no
    // summary is a block it will either never pick or pick blindly.
    for (const b of blockCatalogue()) {
        assert.ok(b.summary && b.summary.length > 20, `${b.name} needs a real summary`);
        assert.ok(['stat', 'table', 'series'].includes(b.shape), `${b.name} has an odd shape`);
        assert.equal(typeof b.params, 'object', `${b.name} must declare its parameters`);
    }
    assert.ok(blockNames().length >= 10, 'the catalogue should cover the questions that were asked for');
});

test('the catalogue carries descriptions, never data or code', () => {
    // What goes into the prompt is names, summaries and parameter shapes —
    // nothing that could put a figure or a query in front of the model.
    const allowedKeys = new Set(['name', 'summary', 'params', 'shape']);
    for (const entry of blockCatalogue()) {
        for (const key of Object.keys(entry)) {
            assert.ok(allowedKeys.has(key), `catalogue entry leaked "${key}"`);
        }
        assert.equal(entry.run, undefined, 'the runner must not reach the prompt');
    }
    // The runners still exist where they belong.
    for (const name of blockNames()) {
        assert.equal(typeof BLOCKS[name].run, 'function', `${name} must be runnable`);
    }
});

test('parameter declarations are shapes the validator understands', () => {
    const allowed = new Set(['date', 'date?', 'number', 'number?', 'string', 'string?']);
    for (const [name, b] of Object.entries(BLOCKS)) {
        for (const [key, kind] of Object.entries(b.params || {})) {
            assert.ok(allowed.has(kind), `${name}.${key} declares "${kind}", which the validator cannot check`);
        }
    }
});
