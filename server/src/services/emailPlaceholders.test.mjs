/**
 * What a tenant actually reads, run with `node --test`.
 *
 * A real customer received an expiry email saying "expires on @endDate", so
 * these pin the fill and, more importantly, the guard that refuses to send
 * anything still carrying a placeholder.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fillPlaceholders, leftoverPlaceholders } from './emailPlaceholders.js';

const customer = { fullName: 'Zulfiqar khan', email: 'z@example.com', company: 'Acme' };

const contract = {
    _id: '6a335421f9cb6478e1e51885',
    contractNo: 'PB-2026-0001',
    unit: { unitNumber: 'F2-44' },
    units: [],
    startDate: '2026-05-25T00:00:00.000Z',
    endDate: '2026-12-25T00:00:00.000Z',
    rate: 675,
};

test('fills the tenant', () => {
    assert.equal(fillPlaceholders('Dear @name,', customer), 'Dear Zulfiqar khan,');
    assert.equal(fillPlaceholders('@company', customer), 'Acme');
});

test('a tenant with no name still reads as a sentence', () => {
    assert.equal(fillPlaceholders('Dear @name,', { fullName: '' }), 'Dear there,');
});

test('fills the contract details that went out raw', () => {
    const out = fillPlaceholders('unit @unit expires @endDate, rate AED @rate, ref @contractNo', customer, contract);
    assert.match(out, /unit F2-44/);
    assert.match(out, /expires 25 Dec 2026/);
    assert.match(out, /AED 675\.00/);
    assert.match(out, /ref PB-2026-0001/);
    assert.equal(leftoverPlaceholders(out).length, 0);
});

test('@newEndDate is exactly 28 days after @endDate, for the auto-renewed notice', () => {
    // 25 Dec 2026 + 28 days — checked against the calendar, not just re-running
    // the same arithmetic the code does.
    const out = fillPlaceholders('was @endDate, now @newEndDate', customer, contract);
    assert.match(out, /was 25 Dec 2026/);
    assert.match(out, /now 22 Jan 2027/);
});

test('a contract with several units names them all', () => {
    const many = { ...contract, units: [{ unitNumber: 'F2-44' }, { unitNumber: 'F2-45' }] };
    assert.match(fillPlaceholders('@unit', customer, many), /F2-44, F2-45/);
});

test('the renewal links resolve to real, contract-scoped URLs', () => {
    const out = fillPlaceholders('@renewLink | @moveOutLink', customer, contract);
    assert.match(out, /intent=renewing/);
    assert.match(out, /intent=not_renewing/);
    assert.match(out, new RegExp(contract._id));
    assert.equal(leftoverPlaceholders(out).length, 0);
});

test('without a contract, the contract placeholders survive untouched', () => {
    // Which is the point: they survive so the caller can refuse to send,
    // rather than being silently blanked into "expires on ".
    const out = fillPlaceholders('Dear @name, unit @unit expires @endDate', customer, null);
    assert.match(out, /Dear Zulfiqar khan/);
    assert.deepEqual(leftoverPlaceholders(out).sort(), ['@endDate', '@unit']);
});

test('leftovers are what decides whether a message may go out', () => {
    assert.deepEqual(leftoverPlaceholders('nothing here'), []);
    assert.deepEqual(leftoverPlaceholders('expires on @endDate'), ['@endDate']);
    // The exact message that reached a customer.
    assert.deepEqual(
        leftoverPlaceholders('Your storage contract @contractNo expires on @endDate').sort(),
        ['@contractNo', '@endDate'],
    );
});

test('an email address is not mistaken for a placeholder', () => {
    // Ordinary copy is full of @ signs. Reading hello@purplebox.ae as an
    // unfilled placeholder would block a perfectly good message.
    assert.deepEqual(leftoverPlaceholders('write to us at hello@purplebox.ae'), []);
    assert.deepEqual(leftoverPlaceholders('mailto:contact@purplebox.ae'), []);
    // But a real placeholder next to one is still caught.
    assert.deepEqual(leftoverPlaceholders('hi@x.com and @endDate'), ['@endDate']);
});

test('a fully filled expiry message has nothing left to refuse', () => {
    const body = 'Dear @name, unit @unit expires @endDate in @daysLeft days. Rate AED @rate. @renewLink @moveOutLink @lateFee';
    assert.equal(leftoverPlaceholders(fillPlaceholders(body, customer, contract)).length, 0);
});
