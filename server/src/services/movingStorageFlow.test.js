import test from 'node:test';
import assert from 'node:assert/strict';
import {
    sizeFromListId, sizeFromActionId, priceFor,
    serviceMenu, sizeMenu, reserveOrPriceMenu, STORAGE_PRICES,
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

test('a reserve/price button id extracts its size, scoped to its own prefix', () => {
    assert.equal(sizeFromActionId('reserve', 'reserve_35'), '35');
    assert.equal(sizeFromActionId('price', 'price_35'), '35');
    // A price id must never be read as a reserve id, or vice versa.
    assert.equal(sizeFromActionId('reserve', 'price_35'), '');
    assert.equal(sizeFromActionId('price', 'reserve_35'), '');
});

test('every listed size has a price, and nothing else does', () => {
    assert.equal(priceFor('10'), STORAGE_PRICES['10']);
    assert.equal(priceFor('25'), STORAGE_PRICES['25']);
    assert.equal(priceFor('35'), STORAGE_PRICES['35']);
    assert.equal(priceFor('50'), STORAGE_PRICES['50']);
    assert.equal(priceFor('99'), '');
    assert.equal(priceFor(''), '');
});

test('the service menu offers exactly Moving and Storage', () => {
    const { buttons } = serviceMenu();
    assert.deepEqual(buttons.map((b) => b.id), ['svc_moving', 'svc_storage']);
});

test('the size menu lists every priced size plus a help option, in order', () => {
    const { rows } = sizeMenu();
    assert.deepEqual(rows.map((r) => r.id), ['size_10', 'size_25', 'size_35', 'size_50', 'size_help']);
});

test('the reserve/price menu is scoped to the size just picked', () => {
    const { buttons, bodyText } = reserveOrPriceMenu('35');
    assert.deepEqual(buttons.map((b) => b.id), ['reserve_35', 'price_35']);
    assert.match(bodyText, /35 sqft/);
});
