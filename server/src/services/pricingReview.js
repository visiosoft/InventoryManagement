/**
 * Price against demand, per unit size and floor: how many units, how many
 * free, occupancy, today's list price (per 4 weeks), what tenants on it
 * actually pay, and how many people asked for that size lately. The pricing
 * bot reads this beside competitor prices to suggest changes; it never
 * changes a price itself.
 *
 * Pure: give it the units, which are taken, active contracts' rates by unit,
 * and the sizes recent leads asked for.
 */

const round = (n) => Math.round(n * 100) / 100;

export function pricingReview({ units = [], takenIds = new Set(), leasedByUnit = new Map(), askedSizes = [] }) {
   const asked = new Map();
   for (const s of askedSizes) if (s > 0) asked.set(Number(s), (asked.get(Number(s)) || 0) + 1);
   const groups = new Map();
   for (const u of units) {
      if (!(u.sizeSqf > 0) || u.status === 'maintenance') continue;
      const key = `${u.sizeSqf}|${u.floor || ''}`;
      if (!groups.has(key)) groups.set(key, { sizeSqf: Number(u.sizeSqf), floor: u.floor || '', units: 0, free: 0, prices: [], leased: [] });
      const g = groups.get(key);
      g.units += 1;
      if (!takenIds.has(String(u._id))) g.free += 1;
      if (u.price > 0) g.prices.push(Number(u.price));
      const l = leasedByUnit.get(String(u._id));
      if (l > 0) g.leased.push(l);
   }
   const sizeTotals = new Map();
   for (const g of groups.values()) {
      const t = sizeTotals.get(g.sizeSqf) || { units: 0, free: 0 };
      t.units += g.units; t.free += g.free;
      sizeTotals.set(g.sizeSqf, t);
   }
   return [...groups.values()].map((g) => {
      const t = sizeTotals.get(g.sizeSqf);
      const enquiries = asked.get(g.sizeSqf) || 0;
      const prices = g.prices.sort((a, b) => a - b);
      return {
         sizeSqf: g.sizeSqf, floor: g.floor, units: g.units, free: g.free,
         occupancyPct: g.units ? Math.round(((g.units - g.free) / g.units) * 100) : 0,
         listPrice: prices.length ? prices[Math.floor(prices.length / 2)] : null,
         listPriceRange: prices.length && prices[0] !== prices[prices.length - 1] ? `${prices[0]}–${prices[prices.length - 1]}` : '',
         avgLeased: g.leased.length ? round(g.leased.reduce((a, b) => a + b, 0) / g.leased.length) : null,
         enquiriesForSize: enquiries,
         enquiriesPerFreeUnitOfSize: t.free ? round(enquiries / t.free) : null,
      };
   }).sort((a, b) => a.sizeSqf - b.sizeSqf || String(a.floor).localeCompare(String(b.floor)));
}
