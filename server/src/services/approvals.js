import { ApprovalRule } from '../models/approvals.js';

/**
 * Approval rules (WP-04). The spec's provisional defaults are loaded switched
 * OFF until the owner confirms the thresholds (OQ-05); an active rule holds a
 * matching change as a request until someone else with the role approves it.
 * Requesters never approve their own; AI agents never approve.
 */

export const DEFAULT_RULES = [
   { action: 'discount_pct', operator: 'gt', threshold: 10, requiredRole: 'admin', label: 'First-month discount above 10%' },
   { action: 'rate_change', operator: 'any', threshold: 0, requiredRole: 'admin', label: 'Any change to the rate or leased price of a booked contract' },
   { action: 'total_change', operator: 'any', threshold: 0, requiredRole: 'admin', label: 'Any change to the total quotation of a booked contract' },
   { action: 'checkout_change', operator: 'gt', threshold: 14, requiredRole: 'admin', label: 'Check-out moved more than 14 days after signing' },
];

export async function ensureRules() {
   if (await ApprovalRule.estimatedDocumentCount() > 0) return;
   await ApprovalRule.insertMany(DEFAULT_RULES.map((r) => ({ ...r, active: false, provisional: true })));
}

const DAY = 86_400_000;
const num = (v) => (v == null || v === '' ? null : Number(v));

/**
 * The first active rule a contract change triggers, or null. Pure.
 * `set` holds the new values (dates as Date); `contract` the stored ones.
 */
export function triggeredRule(rules, contract, set) {
   const booked = ['active', 'ended'].includes(contract.status);
   for (const r of rules.filter((x) => x.active)) {
      if (r.action === 'discount_pct' && set.firstMonthDiscountPct != null && num(set.firstMonthDiscountPct) > r.threshold && num(set.firstMonthDiscountPct) !== num(contract.firstMonthDiscountPct)) return r;
      if (!booked) continue;
      if (r.action === 'rate_change' && ['rate', 'leasedPrice'].some((k) => set[k] != null && num(set[k]) !== num(contract[k]))) return r;
      if (r.action === 'total_change' && set.totalQuotation != null && num(set.totalQuotation) !== num(contract.totalQuotation)) return r;
      if (r.action === 'checkout_change' && set.endDate && contract.endDate) {
         const moved = Math.abs(new Date(set.endDate) - new Date(contract.endDate)) / DAY;
         if (moved > r.threshold) return r;
      }
   }
   return null;
}
