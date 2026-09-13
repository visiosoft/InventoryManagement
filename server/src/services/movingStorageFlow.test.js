import test from 'node:test';
import assert from 'node:assert/strict';
import {
    sizeFromListId, optionIndexFromId, sizeRowsFromUnits, priceLabelFor,
    parseFlexibleDate, formatDate, dateFromPrompt, dateToPrompt, bookingDatesFlowId,
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

test('a button reply id extracts its option index', () => {
    assert.equal(optionIndexFromId('opt_0'), 0);
    assert.equal(optionIndexFromId('opt_2'), 2);
});

test('anything not opt_N reads as -1, not a false match on index 0', () => {
    assert.equal(optionIndexFromId('size_10'), -1);
    assert.equal(optionIndexFromId(''), -1);
    assert.equal(optionIndexFromId(undefined), -1);
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

test('the booking-dates flow id reads from its env var, blank until configured', () => {
    const prev = process.env.WHATSAPP_BOOKING_DATES_FLOW_ID;
    try {
        delete process.env.WHATSAPP_BOOKING_DATES_FLOW_ID;
        assert.equal(bookingDatesFlowId(), '');
        process.env.WHATSAPP_BOOKING_DATES_FLOW_ID = '  123456  ';
        assert.equal(bookingDatesFlowId(), '123456');
    } finally {
        if (prev === undefined) delete process.env.WHATSAPP_BOOKING_DATES_FLOW_ID;
        else process.env.WHATSAPP_BOOKING_DATES_FLOW_ID = prev;
    }
});
