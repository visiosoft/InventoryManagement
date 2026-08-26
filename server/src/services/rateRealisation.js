/**
 * Actual price against leased price, unit by unit.
 *
 * Every unit carries a pre-set monthly price — what the business asks for it.
 * A contract on that unit carries what the tenant actually agreed. The gap is
 * discount, and an empty unit is the whole of its own asking price going
 * unearned, which is why this counts units rather than contracts: a report
 * built from contracts cannot show you a floor standing empty.
 *
 * Two things this gets right that cost real money to get wrong:
 *
 * 1. **`rate` is already monthly.** `generateSchedule` says so plainly: "rate
 *    is the MONTHLY price (4 weeks)… each weekly payment = rate / 4". A weekly
 *    contract does not store a weekly rate, so multiplying by four to
 *    "convert" it inflates that contract fourfold. Billing period changes how
 *    often the tenant pays, not what the figure means.
 *
 * 2. **A unit let twice in one month is still one unit.** Counting rows rather
 *    than distinct units made 165 units appear leased out of 156 that exist on
 *    those floors.
 *
 * Pure — no database, no clock — so the money can be checked directly.
 */

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * A contract's monthly figure.
 *
 * Kept as a named function because the temptation to "convert for weekly
 * billing" is exactly the bug above, and the reason not to belongs here rather
 * than in a caller's head.
 */
export function monthlyRate(contract = {}) {
  return num(contract.rate);
}

/** Every unit a contract covers, tolerating the older single-unit shape. */
export function unitsOf(contract = {}) {
  const many = Array.isArray(contract.units) ? contract.units.filter(Boolean) : [];
  if (many.length) return many;
  return contract.unit ? [contract.unit] : [];
}

/**
 * What a contract is worth per month, whichever field carries it.
 *
 * A stored `leasedPrice` is somebody's decision and wins — except zero. The
 * model treats 0 as deliberate, but no unit is let for nothing, and five
 * contracts carry it on units asking two and a half thousand a month. Read
 * literally those become 100% discounts and drag the whole report down, so a
 * zero is treated as never set and the rate is used instead.
 */
export function contractLeased(contract = {}) {
  const stored = contract.leasedPrice;
  if (stored != null && num(stored) > 0) return round2(num(stored));
  const discount = 1 - num(contract.firstMonthDiscountPct) / 100;
  return round2(monthlyRate(contract) * discount);
}

/**
 * One unit's line.
 *
 * A contract covering several units states one figure for all of them, so it
 * is shared out in proportion to what each unit asks — the only split that
 * leaves a cheap unit looking cheap. With no asking prices to weigh, it splits
 * evenly, which is at least not misleading.
 */
export function unitRow(unit, contract) {
  const actual = num(unit?.price);
  const covered = contract ? unitsOf(contract) : [];
  const totalAsking = covered.reduce((s, u) => s + num(u?.price), 0);

  let leased = 0;
  if (contract) {
    const whole = contractLeased(contract);
    leased = covered.length <= 1
      ? whole
      : round2(whole * (totalAsking > 0 ? actual / totalAsking : 1 / covered.length));
  }

  const priced = actual > 0;
  const occupied = Boolean(contract);

  return {
    unitId: String(unit?._id ?? ''),
    unitNumber: unit?.unitNumber ?? '',
    floor: unit?.floor || 'No floor',
    sizeSqf: unit?.sizeSqf ?? null,
    actual,
    leased,
    occupied,
    priced,
    contractNo: contract?.contractNo ?? '',
    customer: contract?.customer?.fullName ?? '',
    billingPeriod: contract?.billingPeriod ?? '',
    sharedWith: covered.length > 1 ? covered.length : 0,
    variance: occupied && priced ? round2(leased - actual) : null,
    // Positive means let for less than we ask. Only meaningful once let.
    discountPct: occupied && priced ? Math.round(((actual - leased) / actual) * 1000) / 10 : null,
  };
}

/** Roll a set of unit rows up. */
export function totals(rows = []) {
  const let_ = rows.filter((r) => r.occupied);
  const vacant = rows.filter((r) => !r.occupied);
  const comparable = let_.filter((r) => r.priced);

  const askingLet = round2(comparable.reduce((s, r) => s + r.actual, 0));
  const leasedLet = round2(comparable.reduce((s, r) => s + r.leased, 0));

  return {
    units: rows.length,
    leasedUnits: let_.length,
    vacantUnits: vacant.length,
    occupancyPct: rows.length ? Math.round((let_.length / rows.length) * 1000) / 10 : null,
    // The whole floor's asking price, let or not — what the space could earn.
    actualAll: round2(rows.reduce((s, r) => s + r.actual, 0)),
    // Asking price of the units actually let, which is what "leased" compares to.
    actualLet: askingLet,
    leased: round2(let_.reduce((s, r) => s + r.leased, 0)),
    variance: round2(leasedLet - askingLet),
    discountPct: askingLet > 0 ? Math.round(((askingLet - leasedLet) / askingLet) * 1000) / 10 : null,
    // Asking price sitting empty — usually the larger number, and the one
    // discounting arguments tend to forget.
    vacantValue: round2(vacant.reduce((s, r) => s + r.actual, 0)),
    unpricedUnits: rows.filter((r) => !r.priced).length,
  };
}

/** The same roll-up per floor, in floor order. */
export function byFloor(rows = []) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.floor)) map.set(r.floor, []);
    map.get(r.floor).push(r);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([floor, list]) => ({ floor, ...totals(list), rows: list }));
}

/**
 * The trailing months, each as one point on the trend.
 *
 * A caveat worth stating rather than burying: unit prices are not versioned, so
 * "actual" uses today's asking price for every month shown. Only units that
 * existed by the end of a month are counted, which stops a floor added this
 * week from appearing to have been earning all year — but a price *changed*
 * last month is applied backwards. The leased figure has no such problem: it
 * comes from the contracts that actually ran.
 */
export function monthlySeries(units = [], contracts = [], { months = 12, now = new Date() } = {}) {
  const out = [];

  for (let i = months - 1; i >= 0; i--) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));

    const existed = units.filter((u) => !u.createdAt || new Date(u.createdAt) < monthEnd);
    const running = contracts.filter((c) => new Date(c.startDate) < monthEnd && new Date(c.endDate) > monthStart);

    const held = pickPerUnit(running);
    const rows = existed.map((u) => unitRow(u, held.get(String(u._id)) || null));
    const t = totals(rows);

    out.push({
      monthISO: monthStart.toISOString().slice(0, 7),
      label: monthStart.toLocaleString('en', { month: 'short', timeZone: 'UTC' }),
      actual: t.actualAll,
      leased: t.leased,
      units: t.units,
      leasedUnits: t.leasedUnits,
    });
  }

  // Months before any unit existed are not months of zero income, they are
  // months with no records — the unit list only goes back to mid-2026. Drawing
  // them as empty bars would read as a collapse in revenue that never happened.
  const firstReal = out.findIndex((m) => m.units > 0);
  return firstReal <= 0 ? out : out.slice(firstReal);
}

/**
 * One contract per unit.
 *
 * An active contract beats an ended one that merely overlapped the month, so a
 * unit re-let mid-month is counted once rather than twice — which is what made
 * 165 units appear leased across floors holding 156.
 */
export function pickPerUnit(contracts = []) {
  const rank = (c) => (c.status === 'active' ? 0 : c.status === 'pending_signature' ? 1 : 2);
  const map = new Map();
  for (const c of contracts) {
    for (const u of unitsOf(c)) {
      const id = String(u?._id ?? u);
      const held = map.get(id);
      if (!held || rank(c) < rank(held)) map.set(id, c);
    }
  }
  return map;
}
