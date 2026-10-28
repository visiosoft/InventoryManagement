import { Unit, Contract } from '../models/index.js';
import { siteScope } from '../utils/siteScope.js';

/**
 * Occupancy, one definition everywhere (WP-06).
 *
 *   rentable    units not decommissioned (maintenance units included)
 *   occupied    rentable units under an active contract covering the date
 *   reserved    rentable units marked reserved with no such contract
 *   maintenance rentable units in maintenance
 *   occupancy % occupied ÷ rentable; maintenance % reported beside it
 *
 * Occupied comes from contracts, never from the stored unit status: the status
 * is for display and can drift. The units whose status disagrees with the
 * contracts are listed by reconcileUnits for operations to fix by hand.
 */

export const OCCUPANCY_DEFINITION = 'Occupied units ÷ rentable units. Occupied = under an active contract that covers the date. Rentable = every unit not decommissioned, including units in maintenance.';
export const DEFINITION_VERSION = 1;

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const unitIdsOf = (c) => [c.unit, ...(c.units || []), ...(c.unitLines || []).map((l) => l?.unit)].filter(Boolean).map(String);

/** Contracts that cover `date`: active, started, not yet ended. Pure. */
export const covers = (c, date) => c.status === 'active' && new Date(c.startDate) <= date && new Date(c.endDate) >= date;

/** The measures from units and contracts. Pure. */
export function occupancyFrom({ units, contracts, date = new Date() }) {
   const rentableUnits = units.filter((u) => !u.decommissioned);
   const rentableIds = new Set(rentableUnits.map((u) => String(u._id)));
   const occupiedIds = new Set(contracts.filter((c) => covers(c, date)).flatMap(unitIdsOf).filter((id) => rentableIds.has(id)));
   const reserved = rentableUnits.filter((u) => u.status === 'reserved' && !occupiedIds.has(String(u._id))).length;
   const maintenance = rentableUnits.filter((u) => u.status === 'maintenance' && !occupiedIds.has(String(u._id))).length;
   const rentable = rentableUnits.length;
   const occupied = occupiedIds.size;
   return {
      date: date.toISOString(), rentable, occupied, reserved, maintenance,
      available: Math.max(0, rentable - occupied - reserved - maintenance),
      decommissioned: units.length - rentable,
      occupancyPct: pct(occupied, rentable), maintenancePct: pct(maintenance, rentable),
      definition: OCCUPANCY_DEFINITION, definitionVersion: DEFINITION_VERSION,
   };
}

/**
 * Units whose stored status disagrees with the contracts, and active
 * contracts already past their end date. Read-only. Pure.
 */
export function reconcileUnits({ units, contracts, date = new Date() }) {
   const covering = new Map();
   for (const c of contracts.filter((x) => covers(x, date))) for (const id of unitIdsOf(c)) covering.set(id, c);
   const issues = [];
   for (const u of units) {
      if (u.decommissioned) continue;
      const c = covering.get(String(u._id));
      if (u.status === 'occupied' && !c) issues.push({ unit: u.unitNumber, unitId: String(u._id), status: u.status, issue: 'Marked occupied, but no active contract covers today' });
      else if (c && u.status !== 'occupied') issues.push({ unit: u.unitNumber, unitId: String(u._id), status: u.status, contractNo: c.contractNo, issue: `Under contract ${c.contractNo || ''} but marked ${u.status}`.replace('  ', ' ') });
   }
   const pastEnd = contracts.filter((c) => c.status === 'active' && new Date(c.endDate) < date)
      .map((c) => ({ contractNo: c.contractNo, contractId: String(c._id), endDate: c.endDate, issue: 'Active, but the end date has passed' }));
   return { units: issues, contractsPastEnd: pastEnd };
}

async function load(siteId, given) {
   const scope = given !== undefined ? given : siteId ? await siteScope(siteId) : null;
   const [units, contracts] = await Promise.all([
      Unit.find(scope ? scope.unitFilter : {}).select('unitNumber status decommissioned').lean(),
      Contract.find({ ...(scope ? scope.contractFilter : {}), status: 'active' }).select('contractNo status startDate endDate unit units unitLines.unit').lean(),
   ]);
   return { units, contracts };
}

/** Occupancy for a site (or all) on a date (default now). */
export async function computeOccupancy({ siteId = null, date = new Date(), scope } = {}) {
   return occupancyFrom({ ...(await load(siteId, scope)), date });
}

export async function occupancyReconciliation({ siteId = null, date = new Date() } = {}) {
   return reconcileUnits({ ...(await load(siteId)), date });
}
