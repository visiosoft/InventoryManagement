import test from 'node:test';
import assert from 'node:assert/strict';
import {
    sizeFromListId, sizeRowsFromUnits, priceLabelFor,
    parseFlexibleDate, formatDate,
    serviceMenu, sizeMenu, dateFromPrompt, dateToPrompt,
    bookingConfirmationMessage, noAvailabilityMessage,
} from './movingStorageFlow.js';

test('a size list row id extracts its number', () => {
    assert.equal(sizeFromListId('size_10'), '10');
    assert.equal(sizeFromListId('size_25'), '25');
    assert.equal(sizeFromListId('size_50'), '50');
});

test('size_help and anything unrecognised extract nothing', () => {
    assert.equal(sizeFromListId('size_help'), '');
    assert.equal(sizeFromListId('svc_storage'), '');
    assert.equal(sizeFromListId(''), '');
    assert.equal(sizeFromListId(undefined), '');
});

test('units group into sorted per-size rows with a real price range', () => {
    const rows = sizeRowsFromUnits([
        { sizeSqf: 25, price: 600 },
        { sizeSqf: 25, price: 650 },
        { sizeSqf: 10, price: 350 },
        { sizeSqf: 0, price: 999 }, // not a real size, dropped
    ]);
    assert.deepEqual(rows, [
        { size: 10, count: 1, minPrice: 350, maxPrice: 350 },
        { size: 25, count: 2, minPrice: 600, maxPrice: 650 },
    ]);
});

test('a size with no priced units still gets a row, just no price', () => {
    const rows = sizeRowsFromUnits([{ sizeSqf: 35, price: null }]);
    assert.deepEqual(rows, [{ size: 35, count: 1, minPrice: null, maxPrice: null }]);
    assert.equal(priceLabelFor(rows[0]), 'price on request');
});

test('price label collapses a single price and ranges a spread', () => {
    assert.equal(priceLabelFor({ minPrice: 600, maxPrice: 600 }), 'AED 600/mo');
    assert.equal(priceLabelFor({ minPrice: 600, maxPrice: 900 }), 'AED 600–900/mo');
});

test('the service menu offers exactly Moving and Storage', () => {
    const { buttons } = serviceMenu();
    assert.deepEqual(buttons.map((b) => b.id), ['svc_moving', 'svc_storage']);
});

test('the size menu lists real rows plus a help option, and shows the price', () => {
    const rows = sizeRowsFromUnits([{ sizeSqf: 25, price: 600 }, { sizeSqf: 10, price: 350 }]);
    const menu = sizeMenu(rows);
    assert.deepEqual(menu.rows.map((r) => r.id), ['size_10', 'size_25', 'size_help']);
    assert.match(menu.rows[0].description, /350/);
});

test('a day-first date like a UAE customer would type it is read as day/month/year', () => {
    const d = parseFlexibleDate('20/09/2026');
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCMonth(), 8); // September
    assert.equal(d.getUTCDate(), 20);
});

test('an ISO date and a month-name date both still parse', () => {
    assert.ok(parseFlexibleDate('2026-09-20'));
    assert.ok(parseFlexibleDate('20 September 2026'));
});

test('nonsense and empty input parse to null, not an Invalid Date', () => {
    assert.equal(parseFlexibleDate('whenever'), null);
    assert.equal(parseFlexibleDate(''), null);
    assert.equal(parseFlexibleDate(undefined), null);
    // Out-of-range day-first numbers are rejected rather than silently
    // rolled over to some other month.
    assert.equal(parseFlexibleDate('40/13/2026'), null);
});

test('formatDate renders a real date and blanks an invalid one', () => {
    // The exact month abbreviation ("Sep" vs "Sept") is ICU-data dependent,
    // so match loosely rather than pin one spelling across environments.
    assert.match(formatDate(new Date(Date.UTC(2026, 8, 20))), /20 Sept? 2026/);
    assert.equal(formatDate('not a date'), '');
});

test('the date prompts ask from, then to', () => {
    assert.match(dateFromPrompt(), /start/i);
    assert.match(dateToPrompt(), /until/i);
});

test('the booking confirmation names the real unit, size, price and dates', () => {
    const msg = bookingConfirmationMessage({
        unitNumber: 'F2-64', size: '25', price: 600,
        from: new Date(Date.UTC(2026, 8, 20)), to: new Date(Date.UTC(2026, 11, 20)),
    });
    assert.match(msg, /F2-64/);
    assert.match(msg, /25 sqft/);
    assert.match(msg, /AED 600\/month/);
    assert.match(msg, /20 Sept? 2026/);
    assert.match(msg, /20 Dec 2026/);
});

test('a missing price still produces a sensible confirmation', () => {
    const msg = bookingConfirmationMessage({ unitNumber: 'F2-64', size: '25', price: null, from: new Date(), to: new Date() });
    assert.match(msg, /confirmed by our team/);
});

test('the no-availability message names the size and the requested window', () => {
    const msg = noAvailabilityMessage({ size: '25', from: new Date(Date.UTC(2026, 8, 20)), to: new Date(Date.UTC(2026, 11, 20)) });
    assert.match(msg, /25 sqft/);
    assert.match(msg, /20 Sept? 2026/);
    assert.match(msg, /20 Dec 2026/);
});
