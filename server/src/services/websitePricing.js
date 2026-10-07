/**
 * The price list the marketing website shows, one row per unit size.
 *
 * Built from the units themselves — the same `price` and `discountPct` a
 * booking is quoted from — so what the website advertises is what a customer
 * is actually charged, with no second price list to keep in step.
 *
 * Prices are per 4-week rental cycle, and the discount applies to the first
 * cycle only (see quotePricing.js); the standard price applies after that.
 */

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/**
 * @param units  [{ sizeSqf, price, discountPct, status }]
 * @param sizes  optional list of sizes to keep (e.g. [10, 25, 35])
 *
 * A size's row is described by the units a customer could actually take: the
 * free ones if there are any, otherwise every unit of that size, so a sold-out
 * size still shows its price with `available: 0` rather than vanishing.
 * Where units of one size are priced differently (100 sq ft can be 1,600 or
 * 1,650), the row starts from the cheapest and `priceTo` gives the other end.
 */
export function buildWebsitePricing(units, { sizes } = {}) {
    const wanted = sizes && sizes.length ? new Set(sizes.map(Number)) : null;
    const bySize = new Map();
    for (const u of units) {
        const size = num(u.sizeSqf);
        const price = num(u.price);
        if (!(size > 0) || !(price > 0) || u.status === 'maintenance') continue;
        if (wanted && !wanted.has(size)) continue;
        if (!bySize.has(size)) bySize.set(size, []);
        bySize.get(size).push({ price, discountPct: Math.min(100, Math.max(0, num(u.discountPct) || 0)), free: u.status === 'available' });
    }

    return [...bySize.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([sizeSqf, all]) => {
            const free = all.filter((u) => u.free);
            const pool = free.length ? free : all;
            // Cheapest first; among equals, the bigger discount.
            const from = [...pool].sort((a, b) => a.price - b.price || b.discountPct - a.discountPct)[0];
            const priceTo = Math.max(...pool.map((u) => u.price));
            const offerPrice = round2(from.price * (1 - from.discountPct / 100));
            return {
                sizeSqf,
                label: `${sizeSqf} sq ft`,
                available: free.length,
                price: from.price,
                priceTo,
                hasPriceRange: priceTo > from.price,
                hasDiscount: from.discountPct > 0,
                discountPct: from.discountPct,
                offerPrice,
                savings: round2(from.price - offerPrice),
            };
        });
}
