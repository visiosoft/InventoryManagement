/**
 * Actual price against leased price.
 *
 * Every unit carries a pre-set monthly price — what the business asks for it.
 * A contract on that unit carries what the tenant actually agreed. The gap is
 * discount, and until now it could only be read unit by unit on the pricing
 * screen, never per month and never exported.
 *
 * Two things had gone wrong and are fixed here:
 *
 * 1. **Billing period.** A weekly contract stores a *weekly* rate, and a month
 *    in this business is four weeks. The pricing matrix compared that weekly
 *    figure straight against a monthly unit price — which is why a unit priced
 *    at 2,800 showed as leased for 583, an implausible 79% discount rather than
 *    a rate billed a different way.
 *
 * 2. **Two derivations for one number.** The contract page derives the leased
 *    price from the units' asking price; the matrix derived it from the rate.
 *    They disagreed. This is now the single rule both use.
 *
 * Pure — no database, no clock — so the money can be checked directly.
 */

/** A month is four weeks here, not thirty days. */
export const WEEKS_PER_MONTH = 4;

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** A contract's stored rate expressed as a month, whichever way it is billed. */
export function monthlyRate(contract = {}) {
  const rate = num(contract.rate);
  return contract.billingPeriod === 'weekly' ? rate * WEEKS_PER_MONTH : rate;
}

/** Every unit a contract covers, tolerating the older single-unit shape. */
export function unitsOf(contract = {}) {
  const many = Array.isArray(contract.units) ? contract.units.filter(Boolean) : [];
  if (many.length) return many;
  return contract.unit ? [contract.unit] : [];
}

/**
 * The asking price: what these units are priced at together.
 * Zero means none of them carry a price, which is a different thing from free.
 */
export function actualPrice(contract = {}) {
  return round2(unitsOf(contract).reduce((s, u) => s + num(u?.price), 0));
}

/**
 * What the unit is actually let for, as a monthly figure.
 *
 * Order matters. An explicitly stored `leasedPrice` is somebody's decision and
 * wins outright — including a deliberate 0, which is why the check is against
 * null rather than falsiness. Otherwise the asking price is discounted, the
 * same derivation the contract page uses. Only when no unit carries a price
 * does the contract's own rate stand in, converted to a month first.
 */
export function leasedPrice(contract = {}) {
  if (contract.leasedPrice != null) return round2(num(contract.leasedPrice));

  const discount = 1 - num(contract.firstMonthDiscountPct) / 100;
  const asking = actualPrice(contract);
  if (asking > 0) return round2(asking * discount);
  return round2(monthlyRate(contract) * discount);
}

/** One contract's line: asked, let, and the gap. */
export function realisationRow(contract = {}) {
  const actual = actualPrice(contract);
  const leased = leasedPrice(contract);
  const priced = actual > 0;

  return {
    contractId: String(contract._id ?? ''),
    contractNo: contract.contractNo ?? '',
    customer: contract.customer?.fullName ?? contract.customerName ?? '',
    units: unitsOf(contract).map((u) => u?.unitNumber).filter(Boolean),
    unitCount: unitsOf(contract).length,
    floor: unitsOf(contract)[0]?.floor ?? '',
    sizeSqf: unitsOf(contract).reduce((s, u) => s + num(u?.sizeSqf), 0) || null,
    billingPeriod: contract.billingPeriod ?? 'monthly',
    // Kept so a weekly contract can still be read the way it is billed rather
    // than only as the converted figure.
    billedRate: round2(num(contract.rate)),
    actual,
    leased,
    variance: priced ? round2(leased - actual) : null,
    // Positive means we let it for less than we ask.
    discountPct: priced ? Math.round(((actual - leased) / actual) * 1000) / 10 : null,
    priced,
    startDate: contract.startDate ?? null,
    status: contract.status ?? '',
  };
}

/**
 * Roll a set of lines up.
 *
 * Percentages are computed over priced units only. An unpriced unit would
 * otherwise read as a 100% discount and drag the whole figure down, so those
 * are counted and named instead.
 */
export function totals(rows = []) {
  const pricedRows = rows.filter((r) => r.priced);
  const actual = round2(pricedRows.reduce((s, r) => s + r.actual, 0));
  const leased = round2(pricedRows.reduce((s, r) => s + r.leased, 0));

  return {
    contracts: rows.length,
    units: rows.reduce((s, r) => s + r.unitCount, 0),
    actual,
    // Every leased figure counts toward the money, priced or not; only the
    // percentage is restricted to units we can compare.
    leased: round2(rows.reduce((s, r) => s + r.leased, 0)),
    leasedOnPriced: leased,
    variance: round2(leased - actual),
    discountPct: actual > 0 ? Math.round(((actual - leased) / actual) * 1000) / 10 : null,
    unpriced: rows.length - pricedRows.length,
  };
}

/** The same roll-up, per floor, in floor order. */
export function byFloor(rows = []) {
  const map = new Map();
  for (const r of rows) {
    const key = r.floor || 'No floor';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([floor, list]) => ({ floor, ...totals(list), rows: list }));
}
