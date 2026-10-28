import { Unit, Contract, Lead } from '../models/index.js';
import { covers } from './occupancy.js';

/**
 * Inventory mix by size (WP-18): stock against demand. Occupied comes from
 * contracts, like the occupancy report, so the totals agree. Demand counts
 * leads asking for a size in the period, not contracts.
 */

const DAY = 86_400_000;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

/** The size a request means: the smallest size at or above it, else the largest. Pure. */
export function sizeFor(requested, sizes) {
   const r = Number(requested) || 0;
   if (r <= 0 || !sizes.length) return null;
   const sorted = [...sizes].sort((a, b) => a - b);
   return sorted.find((s) => s >= r) ?? sorted[sorted.length - 1];
}

/** Rows by size with flags. Pure. */
export function mixFrom({ units, contracts, leads, date = new Date() }) {
   const rentable = units.filter((u) => !u.decommissioned);
   const sizes = [...new Set(rentable.map((u) => u.sizeSqf).filter((s) => s > 0))].sort((a, b) => a - b);
   const covering = new Set(contracts.filter((c) => covers(c, date)).flatMap((c) => [c.unit, ...(c.units || [])]).filter(Boolean).map(String));
   // Last day each unit was let, for "days vacant".
   const lastEnd = new Map();
   for (const c of contracts) for (const id of [c.unit, ...(c.units || [])].filter(Boolean).map(String)) {
      const e = new Date(c.endDate).getTime();
      if (e <= date.getTime() && e > (lastEnd.get(id) || 0)) lastEnd.set(id, e);
   }
   const demand = new Map();
   for (const l of leads) { const s = sizeFor(l.storageSizeValue, sizes); if (s) demand.set(s, (demand.get(s) || 0) + 1); }
   const rows = sizes.map((size) => {
      const us = rentable.filter((u) => u.sizeSqf === size);
      const occ = us.filter((u) => covering.has(String(u._id)));
      const rest = us.filter((u) => !covering.has(String(u._id)));
      const reserved = rest.filter((u) => u.status === 'reserved').length;
      const maintenance = rest.filter((u) => u.status === 'maintenance').length;
      const avail = rest.filter((u) => u.status !== 'reserved' && u.status !== 'maintenance');
      const vac = avail.map((u) => Math.max(0, Math.round((date.getTime() - (lastEnd.get(String(u._id)) || new Date(u.createdAt || date).getTime())) / DAY)));
      const d = demand.get(size) || 0;
      return { size, rentable: us.length, occupied: occ.length, reserved, maintenance, available: avail.length, avgDaysVacant: vac.length ? Math.round(vac.reduce((a, b) => a + b, 0) / vac.length) : null, demand: d, demandPerAvailable: avail.length ? Math.round((d / avail.length) * 10) / 10 : null };
   });
   const med = median(rows.map((r) => r.demand));
   for (const r of rows) {
      r.flags = [];
      if (r.available === 0 && r.demand > 0) r.flags.push(r.maintenance ? 'stockout_maintenance' : 'stockout');
      if (r.rentable && r.available > r.rentable / 2 && r.demand < med) r.flags.push('oversupply');
   }
   const totals = rows.reduce((t, r) => ({ rentable: t.rentable + r.rentable, occupied: t.occupied + r.occupied, reserved: t.reserved + r.reserved, maintenance: t.maintenance + r.maintenance, available: t.available + r.available, demand: t.demand + r.demand }), { rentable: 0, occupied: 0, reserved: 0, maintenance: 0, available: 0, demand: 0 });
   return { rows, totals, medianDemand: med };
}

export async function inventoryMix({ days = 30, now = new Date() } = {}) {
   const d = Math.min(180, Math.max(7, Number(days) || 30));
   const [units, contracts, leads] = await Promise.all([
      Unit.find({}).select('sizeSqf status decommissioned createdAt').lean(),
      Contract.find({ status: { $in: ['active', 'ended'] } }).select('status startDate endDate unit units').lean(),
      Lead.find({ createdAt: { $gte: new Date(now.getTime() - d * DAY) }, storageSizeValue: { $gt: 0 } }).select('storageSizeValue').lean(),
   ]);
   return { days: d, ...mixFrom({ units, contracts, leads, date: now }), note: 'Occupied from active contracts covering today; demand = leads in the period asking for that size (rounded up to the next size we have).' };
}
