import { Payment, Unit } from '../models/index.js';
import { MaintenanceTicket, OPEN_STATUSES } from '../models/maintenance.js';
import { duplicateGroups } from './receivables.js';
import { occupancyReconciliation } from './occupancy.js';

/**
 * Data-quality conditions behind the KPI banner (WP-23). Each is true or
 * not from the data right now; the banner shows every true one with its
 * count and a link to where it is fixed, and cannot be dismissed while true.
 */

const HOURS_48 = 48 * 3_600_000;

/** Which conditions hold, from the counts. Pure. */
export function conditionsFrom({ lastPaymentAt, now = new Date(), duplicateGroupCount, maintenanceWithoutTicket, contractsPastEnd, unitStatusMismatches }) {
   const out = [];
   const staleMs = lastPaymentAt ? now - new Date(lastPaymentAt) : Infinity;
   // Weekends (Sat/Sun in Dubai) don't make payments stale on their own.
   const dow = new Date(now.getTime() + 4 * 3_600_000).getUTCDay();
   const businessDay = dow !== 0 && dow !== 6;
   if (staleMs > HOURS_48 && businessDay) {
      const days = Number.isFinite(staleMs) ? Math.floor(staleMs / 86_400_000) : null;
      out.push({ key: 'payments_stale', severity: 'high', count: days, text: days == null ? 'No payment has ever been recorded in the CRM.' : `No payment recorded in the CRM for ${days} days — collection figures read zero.`, fix: '/?tab=finance' });
   }
   if (duplicateGroupCount > 0) out.push({ key: 'duplicate_payments', severity: 'high', count: duplicateGroupCount, text: `${duplicateGroupCount} groups of duplicate unpaid rows inflate the overdue total.`, fix: '/?tab=finance' });
   if (maintenanceWithoutTicket > 0) out.push({ key: 'maintenance_no_ticket', severity: 'medium', count: maintenanceWithoutTicket, text: `${maintenanceWithoutTicket} units in maintenance have no ticket, so nobody owns them.`, fix: '/maintenance' });
   if (contractsPastEnd > 0) out.push({ key: 'contracts_past_end', severity: 'medium', count: contractsPastEnd, text: `${contractsPastEnd} contracts are active past their end date.`, fix: '/renewals' });
   if (unitStatusMismatches > 0) out.push({ key: 'unit_status_mismatch', severity: 'low', count: unitStatusMismatches, text: `${unitStatusMismatches} units show a status that disagrees with their contracts.`, fix: '/units' });
   return out;
}

export async function dataQuality({ now = new Date() } = {}) {
   const [lastPaid, unpaid, maintUnits, recon] = await Promise.all([
      Payment.findOne({ status: 'paid' }).sort({ paidDate: -1, updatedAt: -1 }).select('paidDate updatedAt').lean(),
      Payment.find({ status: { $in: ['pending', 'overdue'] } }).select('contract amount dueDate status createdAt').lean(),
      Unit.find({ status: 'maintenance' }).select('_id').lean(),
      occupancyReconciliation({ date: now }),
   ]);
   const ticketed = await MaintenanceTicket.find({ status: { $in: OPEN_STATUSES }, units: { $in: maintUnits.map((u) => u._id) } }).select('units').lean();
   const has = new Set(ticketed.flatMap((t) => t.units.map(String)));
   const conditions = conditionsFrom({
      now,
      lastPaymentAt: lastPaid ? (lastPaid.paidDate || lastPaid.updatedAt) : null,
      duplicateGroupCount: duplicateGroups(unpaid).length,
      maintenanceWithoutTicket: maintUnits.filter((u) => !has.has(String(u._id))).length,
      contractsPastEnd: recon.contractsPastEnd.length,
      unitStatusMismatches: recon.units.length,
   });
   return { checkedAt: now.toISOString(), conditions };
}

