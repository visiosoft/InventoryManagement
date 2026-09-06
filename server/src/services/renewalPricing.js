/**
 * What a renewal costs.
 *
 * One module because three places need the same answer and must not disagree:
 * the figure the tenant is shown on the renewal page, the Stripe session they
 * are charged, and the invoice raised afterwards. A tenant who is quoted 1,575
 * and invoiced 1,650 will not renew again, and the difference would be found by
 * them rather than by us.
 *
 * The rules are the ones already used everywhere else in the system:
 *   - a unit's price is its MONTHLY rate; a week is a quarter of it
 *   - one month is 28 days, so any leftover day is a whole extra week
 *   - no per-day maths, anywhere
 *
 * The first-month discount deliberately has no branch here. It applies to the
 * first four weeks of a contract, and a renewal begins where the contract was
 * already ending — always past week four, so there is no case in which it could
 * fire. Writing it in anyway would only create a way for it to fire wrongly.
 */

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** Midnight, so a time-of-day difference cannot buy or lose a week.
 *
 *  Null is rejected before the Date is built: `new Date(null)` is not an
 *  invalid date, it is 1st January 1970 — so a contract with no end date would
 *  otherwise price fifty-six years of storage instead of refusing. */
function atMidnight(value) {
    if (value === null || value === undefined || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function daysBetween(from, to) {
    const a = atMidnight(from);
    const b = atMidnight(to);
    if (!a || !b) return null;
    return Math.round((b - a) / 86400000);
}

/** Ceiling to whole weeks — a part week is charged as a full one. */
export function weeksBetween(from, to) {
    const days = daysBetween(from, to);
    if (days === null || days <= 0) return 0;
    return Math.ceil(days / 7);
}

export function weeklyRateFrom(monthlyRate) {
    return round2(Number(monthlyRate || 0) / 4);
}

/**
 * The monthly rate a renewal is priced at.
 *
 * Today's list price, not the rate on the contract — a tenant from two years
 * ago renews at what the unit is worth now. Where a unit carries no price the
 * whole calculation falls back to the contract's own rate rather than pricing
 * that unit at zero: a renewal quoted short is worse than one quoted at the old
 * rate, because the second is merely generous and the first is broken.
 *
 * `source` is returned so the page and the team can see which rule applied
 * instead of having to work it out from the number.
 */
export function renewalMonthlyRate(contract, units) {
    const list = (Array.isArray(units) ? units : []).filter(Boolean);
    const priced = list.filter((u) => Number(u?.price) > 0);
    const contractRate = round2(contract?.rate || 0);

    if (list.length && priced.length === list.length) {
        return {
            monthlyRate: round2(priced.reduce((sum, u) => sum + Number(u.price), 0)),
            source: 'list',
            contractRate,
        };
    }
    return { monthlyRate: contractRate, source: 'contract', contractRate };
}

/**
 * Price a renewal period.
 *
 * VAT is charged on the rent because rent is a supply. Nothing refundable is
 * involved: a renewal re-lets a unit the tenant already holds, so no deposit
 * and no advance are collected again — which is also why the deposit rules that
 * complicate a new quote have no equivalent here.
 *
 * The card fee sits outside `total` on purpose, exactly as it does on a quote
 * or an invoice. What is owed does not depend on how it is paid; the fee only
 * exists if they choose the card, so folding it into the total would misstate
 * the price to somebody paying by bank transfer.
 */
export function priceRenewal({ monthlyRate, from, to, vatPct = 5, cardFeePct = 0 }) {
    const weeks = weeksBetween(from, to);
    const weeklyRate = weeklyRateFrom(monthlyRate);
    const subTotal = round2(weeks * weeklyRate);
    const vatAmount = round2(subTotal * (Number(vatPct) || 0) / 100);
    const total = round2(subTotal + vatAmount);
    const cardFeeAmount = round2(total * (Number(cardFeePct) || 0) / 100);

    return {
        days: daysBetween(from, to) ?? 0,
        weeks,
        monthlyRate: round2(monthlyRate),
        weeklyRate,
        subTotal,
        vatPct: Number(vatPct) || 0,
        vatAmount,
        total,
        cardFeePct: Number(cardFeePct) || 0,
        cardFeeAmount,
        // What the card actually collects. Bank transfer collects `total`.
        totalWithCardFee: round2(total + cardFeeAmount),
    };
}

/**
 * The presets offered before they reach for the date picker.
 *
 * Most people renew for a round period and want to be told the price rather
 * than discover it by dragging a calendar. The picker stays for everyone else.
 */
export const PRESET_WEEKS = [4, 12, 24, 52];

export function renewalChoices({ monthlyRate, from, vatPct = 5, cardFeePct = 0, presets = PRESET_WEEKS }) {
    const start = atMidnight(from);
    if (!start) return [];
    return presets.map((weeks) => {
        const to = new Date(start.getTime() + weeks * 7 * 86400000);
        return {
            weeks,
            endDate: to.toISOString().slice(0, 10),
            ...priceRenewal({ monthlyRate, from: start, to, vatPct, cardFeePct }),
        };
    });
}

/**
 * Is this a date we are willing to renew to?
 *
 * The floor is one week past the current end date — anything less is not a
 * renewal, and a zero-week period would produce a zero-amount Stripe session
 * that fails with a error the tenant cannot act on. The ceiling keeps a
 * mis-typed year (2035 for 2026) from quietly producing a 470-week invoice.
 */
export function validateNewEndDate({ currentEndDate, newEndDate, maxWeeks = 104 }) {
    const from = atMidnight(currentEndDate);
    const to = atMidnight(newEndDate);
    if (!to) return { ok: false, error: 'Pick a valid date' };
    if (!from) return { ok: false, error: 'This contract has no end date to renew from' };

    const weeks = weeksBetween(from, to);
    if (weeks < 1) return { ok: false, error: 'Choose a date at least a week after your current end date' };
    if (weeks > maxWeeks) {
        return { ok: false, error: `We can renew up to ${Math.floor(maxWeeks / 52)} years ahead online — please contact us for longer` };
    }
    return { ok: true, weeks };
}
