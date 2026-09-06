import test from 'node:test';
import assert from 'node:assert/strict';
import { decideExtension } from './renewalApply.js';

/**
 * Whether a paid renewal moves the contract's end date.
 *
 * The case worth guarding is a contract that already runs past the date being
 * paid for. Writing the renewed date in then shortens a term the tenant has
 * already paid for, and nothing downstream would catch it — the invoice would
 * be right, the money would be right, and the unit would come free early.
 */

test('an ordinary renewal moves the end date forward', () => {
    const out = decideExtension({
        contractEndDate: '2026-10-01',
        quotedEndDate: '2026-10-01',
        newEndDate: '2026-12-24',
    });
    assert.equal(out.extend, true);
    assert.deepEqual(out.notes, []);
});

test('a contract already running past the renewed date is left alone', () => {
    // Somebody extended by hand while the tenant was paying. Shortening it back
    // is the bug this exists to prevent.
    const out = decideExtension({
        contractEndDate: '2027-06-01',
        quotedEndDate: '2026-10-01',
        newEndDate: '2026-12-24',
    });
    assert.equal(out.extend, false);
    assert.equal(out.notes.length, 2, 'both the move and the refusal are worth saying');
    assert.match(out.notes.join(' '), /left alone/);
});

test('a moved end date is reported even when the renewal still applies', () => {
    const out = decideExtension({
        contractEndDate: '2026-10-15',   // moved on since quoting
        quotedEndDate: '2026-10-01',
        newEndDate: '2026-12-24',        // still further out, so it applies
    });
    assert.equal(out.extend, true);
    assert.equal(out.notes.length, 1);
    assert.match(out.notes[0], /moved from/);
});

test('the same date is not an extension', () => {
    const out = decideExtension({
        contractEndDate: '2026-12-24',
        quotedEndDate: '2026-12-24',
        newEndDate: '2026-12-24',
    });
    assert.equal(out.extend, false);
});

test('a contract with no end date takes the renewed one', () => {
    const out = decideExtension({
        contractEndDate: null,
        quotedEndDate: null,
        newEndDate: '2026-12-24',
    });
    assert.equal(out.extend, true);
    assert.deepEqual(out.notes, []);
});
