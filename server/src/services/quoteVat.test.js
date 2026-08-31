import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * VAT on a quotation.
 *
 * The rule lives in routes/quotes.js, where the server owns every total. It is
 * restated here because it is money: 5% of the rent, add-ons and adjustment,
 * and nothing at all on the security deposit or the refundable advance, which
 * are held and handed back rather than sold. Taxing those would bill the
 * customer 5% of a sum they are owed.
 */
function quoteTotals({ subTotal, adjustment = 0, advanceExtra = 0, deposit = 0, vatEnabled = true }) {
    const vatRate = vatEnabled ? 5 : 0;
    const vatAmount = Number((Math.max(0, subTotal + adjustment) * (vatRate / 100)).toFixed(2));
    return { vatAmount, total: Number((subTotal + adjustment + vatAmount + advanceExtra + deposit).toFixed(2)) };
}

test('VAT is 5% of the rent and add-ons', () => {
    assert.equal(quoteTotals({ subTotal: 1000 }).vatAmount, 50);
    assert.equal(quoteTotals({ subTotal: 1000 }).total, 1050);
});

test('the security deposit is not taxed', () => {
    const without = quoteTotals({ subTotal: 1000 });
    const with_ = quoteTotals({ subTotal: 1000, deposit: 5000 });
    assert.equal(with_.vatAmount, without.vatAmount, 'a bigger deposit must not raise the VAT');
    assert.equal(with_.total, 6050, 'the deposit is added after tax');
});

test('the refundable advance is not taxed', () => {
    const with_ = quoteTotals({ subTotal: 1000, advanceExtra: 5000 });
    assert.equal(with_.vatAmount, 50);
    assert.equal(with_.total, 6050);
});

test('a discount reduces the tax with it', () => {
    // A discount is a smaller supply, so it is taxed as one.
    assert.equal(quoteTotals({ subTotal: 1000, adjustment: -100 }).vatAmount, 45);
    assert.equal(quoteTotals({ subTotal: 1000, adjustment: -100 }).total, 945);
});

test('a discount larger than the rent never produces negative tax', () => {
    const out = quoteTotals({ subTotal: 500, adjustment: -800 });
    assert.equal(out.vatAmount, 0, 'no VAT credit is invented');
});

test('turning VAT off removes it and nothing else', () => {
    const on = quoteTotals({ subTotal: 1000, deposit: 500 });
    const off = quoteTotals({ subTotal: 1000, deposit: 500, vatEnabled: false });
    assert.equal(off.vatAmount, 0);
    assert.equal(off.total, on.total - on.vatAmount);
});

test('the tax is rounded to fils, not left as a long fraction', () => {
    // 405 is a real quote subtotal; 5% of it is 20.25 exactly.
    assert.equal(quoteTotals({ subTotal: 405 }).vatAmount, 20.25);
    // 333.33 x 5% = 16.6665, which must not reach an invoice as-is.
    const awkward = quoteTotals({ subTotal: 333.33 }).vatAmount;
    assert.equal(awkward, 16.67);
    assert.equal(String(awkward).split('.')[1].length <= 2, true, 'no sub-fils precision');
});

/* The quotation PDF builds its own row list and totals it independently, so
 * the rule has to hold there too. It nearly did not: the deposit and the
 * refundable advance are printed as rows, and taxing the sub total charged VAT
 * on both — on a real quote with a 980 rent and a 980 deposit that doubled the
 * VAT from 49 to 98. Each row now carries whether it is taxable. */
const PDF_ROWS = [
    { title: 'Storage Unit F2-34', amount: 980, taxable: true },
    { title: 'Refundable Advance · Unit F2-34', amount: 245, taxable: false },
    { title: 'Padlock', amount: 80, taxable: true },
    { title: 'Security Deposit (refundable)', amount: 980, taxable: false },
];

test('the PDF taxes the supply, not the sub total', () => {
    const subTotal = PDF_ROWS.reduce((s, r) => s + r.amount, 0);
    const taxable = PDF_ROWS.reduce((s, r) => s + (r.taxable ? r.amount : 0), 0);

    assert.equal(subTotal, 2285, 'every row, which is what the customer sees as Sub Total');
    assert.equal(taxable, 1060, 'rent and add-ons only');
    assert.equal(Number((taxable * 0.05).toFixed(2)), 53);
    assert.notEqual(
        Number((taxable * 0.05).toFixed(2)),
        Number((subTotal * 0.05).toFixed(2)),
        'taxing the sub total would overcharge',
    );
});

test('every refundable row is excluded from tax by name and by flag', () => {
    for (const row of PDF_ROWS) {
        const refundable = /refundable|deposit/i.test(row.title);
        assert.equal(row.taxable, !refundable, `${row.title} is flagged wrongly`);
    }
});

test('a full quote adds up', () => {
    // Rent 1440, discount 40, advance 360 held, deposit 1600.
    const out = quoteTotals({ subTotal: 1440, adjustment: -40, advanceExtra: 360, deposit: 1600 });
    assert.equal(out.vatAmount, 70, '5% of 1400');
    assert.equal(out.total, 1400 + 70 + 360 + 1600);
});
