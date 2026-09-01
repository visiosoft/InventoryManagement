/**
 * What VAT is charged on.
 *
 * The rule is simple and does not change: 5% on what is sold, nothing on money
 * that is held and given back. Where it goes wrong is deciding which is which.
 *
 * The security deposit and the refundable advance have their own fields, so
 * they are easy. The trap is somebody typing a refundable amount into the
 * add-ons list instead — two live quotes carry an add-on literally called
 * "Refundable Deposit", and an add-on is a taxable row as far as any code can
 * tell. That charged the customer 5% of a sum they are owed back.
 *
 * So the test is the row itself, not the field it arrived in. This lives in
 * one place because the quote total and the printed quotation both need it,
 * and the two disagreeing about a customer's VAT is worse than either rule.
 */

/* Deliberately narrow. "Refundable" is unambiguous. "Deposit" on its own is
   the word people actually use, and a taxable service is very unlikely to be
   called one — but "deposit box", a real product elsewhere in storage, would
   be, so it is excluded. Better to miss a case and be told than to silently
   stop charging VAT on something that owed it. */
const REFUNDABLE = /\brefundable\b|\bdeposit\b|\bsecurity\s+deposit\b|\badvance\b/i;
const NOT_REFUNDABLE = /\bdeposit\s*box\b|\bsafe\s*deposit\b/i;

/** Is this line a sum held and returned, rather than something sold? */
export function isRefundableRow(name) {
    const text = String(name || '');
    if (!text.trim()) return false;
    if (NOT_REFUNDABLE.test(text)) return false;
    return REFUNDABLE.test(text);
}

/**
 * The amount VAT is charged on.
 *
 * Rent, plus any add-on or line item that is genuinely a sale, plus the
 * adjustment. Never the deposit, never the advance, and never a refundable
 * amount that arrived dressed as an add-on.
 */
export function vatBase({ unitsTotal = 0, addOns = [], items = [], adjustment = 0 }) {
    const taxable = (rows, nameOf) => rows
        .filter((r) => !isRefundableRow(nameOf(r)))
        .reduce((s, r) => s + Number(r.amount || 0), 0);

    const base = Number(unitsTotal || 0)
        + taxable(addOns, (a) => a.name)
        + taxable(items, (i) => i.itemDetails)
        + Number(adjustment || 0);

    // A discount larger than the sale does not earn a VAT credit.
    return Math.max(0, Number(base.toFixed(2)));
}

/** 5% of it, rounded to fils. */
export function vatOn(base, rate = 5) {
    return Number((Math.max(0, Number(base) || 0) * (Number(rate) || 0) / 100).toFixed(2));
}
