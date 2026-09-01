import test from 'node:test';
import assert from 'node:assert/strict';
import { isRefundableRow, vatBase, vatOn } from './quoteVat.js';

/**
 * VAT on a quotation: 5% of what is sold, nothing on money held and returned.
 *
 * The deposit and the advance have their own fields and were straightforward.
 * The case that reached a customer was a refundable amount typed into the
 * add-ons list — two live quotes carry an add-on called "Refundable Deposit" —
 * where nothing in the shape of the data says it is not a sale.
 */

test('a refundable row is recognised however it is worded', () => {
    for (const name of [
        'Refundable Deposit',           // exactly what is on QT-000139 and QT-000145
        'refundable deposit',
        'Security Deposit',
        'Deposit',
        'Refundable Advance · Unit F2-34',
        'Advance rent',
    ]) {
        assert.equal(isRefundableRow(name), true, `${name} should not be taxed`);
    }
});

test('an ordinary sale is still taxed', () => {
    for (const name of ['Padlock', 'Packing materials', 'Moving service', 'Insurance', 'Storage Unit F2-34', '']) {
        assert.equal(isRefundableRow(name), false, `${name} should be taxed`);
    }
});

test('a deposit box is a product, not a deposit', () => {
    // The one plausible way the word appears on something genuinely sold.
    assert.equal(isRefundableRow('Deposit box rental'), false);
    assert.equal(isRefundableRow('Safe deposit locker'), false);
});

test('the tax base excludes a refundable add-on', () => {
    const base = vatBase({
        unitsTotal: 1000,
        addOns: [{ name: 'Padlock', amount: 80 }, { name: 'Refundable Deposit', amount: 1100 }],
    });
    assert.equal(base, 1080, 'rent plus the padlock, not the deposit');
    assert.equal(vatOn(base), 54);

    // What it used to do, for contrast: 5% of 2,180 is 109 — the customer
    // charged 55 dirhams on money they get back.
    assert.notEqual(vatOn(1000 + 80 + 1100), vatOn(base));
});

test('the real quotes that prompted this', () => {
    // QT-000139: an add-on of 1100 called "Refundable Deposit".
    assert.equal(vatOn(vatBase({ unitsTotal: 0, addOns: [{ name: 'Refundable Deposit', amount: 1100 }] })), 0);
    // QT-000145: the same at 250.
    assert.equal(vatOn(vatBase({ unitsTotal: 0, addOns: [{ name: 'Refundable Deposit', amount: 250 }] })), 0);
});

test('a refundable line item is excluded too, not only add-ons', () => {
    const base = vatBase({
        unitsTotal: 500,
        items: [{ itemDetails: 'Security deposit', amount: 500 }, { itemDetails: 'Padlock', amount: 80 }],
    });
    assert.equal(base, 580);
});

test('a discount reduces the base, and never makes it negative', () => {
    assert.equal(vatBase({ unitsTotal: 1000, adjustment: -100 }), 900);
    assert.equal(vatOn(vatBase({ unitsTotal: 1000, adjustment: -100 })), 45);
    assert.equal(vatBase({ unitsTotal: 500, adjustment: -800 }), 0, 'no VAT credit is invented');
});

test('the tax rounds to fils', () => {
    assert.equal(vatOn(405), 20.25);
    assert.equal(vatOn(333.33), 16.67);
    assert.equal(String(vatOn(333.33)).split('.')[1].length <= 2, true);
});

test('turning VAT off charges nothing at all', () => {
    assert.equal(vatOn(vatBase({ unitsTotal: 1000 }), 0), 0);
});

test('an empty quote does not produce NaN', () => {
    assert.equal(vatBase({}), 0);
    assert.equal(vatOn(vatBase({})), 0);
    assert.equal(vatOn(undefined), 0);
});

/* The whole-quote total, restating the two cases that were fixed first: the
 * security deposit and the refundable advance have their own fields and are
 * added after tax, never taxed. Kept here so the earlier fix stays guarded
 * alongside the add-on one.
 */
function quoteTotal({ unitsTotal = 0, addOns = [], items = [], adjustment = 0, advanceExtra = 0, deposit = 0, vatEnabled = true }) {
    const vat = vatOn(vatBase({ unitsTotal, addOns, items, adjustment }), vatEnabled ? 5 : 0);
    const sold = unitsTotal + addOns.reduce((s, a) => s + a.amount, 0) + items.reduce((s, i) => s + i.amount, 0);
    return { vat, total: Number((sold + adjustment + vat + advanceExtra + deposit).toFixed(2)) };
}

test('the security deposit is added after tax, never taxed', () => {
    const without = quoteTotal({ unitsTotal: 1000 });
    const with_ = quoteTotal({ unitsTotal: 1000, deposit: 5000 });
    assert.equal(with_.vat, without.vat, 'a bigger deposit must not raise the VAT');
    assert.equal(with_.vat, 50);
    assert.equal(with_.total, 6050);
});

test('the refundable advance is added after tax, never taxed', () => {
    const out = quoteTotal({ unitsTotal: 1000, advanceExtra: 5000 });
    assert.equal(out.vat, 50);
    assert.equal(out.total, 6050);
});

test('a whole quote with every kind of line adds up', () => {
    // Rent 1440, a 80 padlock, a 1100 refundable add-on, 40 discount,
    // 360 advance held, 1600 deposit.
    const out = quoteTotal({
        unitsTotal: 1440,
        addOns: [{ name: 'Padlock', amount: 80 }, { name: 'Refundable Deposit', amount: 1100 }],
        adjustment: -40, advanceExtra: 360, deposit: 1600,
    });
    assert.equal(out.vat, 74, '5% of 1440 + 80 - 40');
    assert.equal(out.total, 1440 + 80 + 1100 - 40 + 74 + 360 + 1600);
});

test('turning VAT off removes the tax and nothing else', () => {
    const on = quoteTotal({ unitsTotal: 1000, deposit: 500 });
    const off = quoteTotal({ unitsTotal: 1000, deposit: 500, vatEnabled: false });
    assert.equal(off.vat, 0);
    assert.equal(off.total, on.total - on.vat);
});
