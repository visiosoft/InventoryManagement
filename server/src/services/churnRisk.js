import { Contract, Payment } from '../models/index.js';

/**
 * Churn risk v1 (WP-27): points from rules, never a model. Not shown to
 * customers and not used for pricing.
 *   not renewing +40 · undecided and ending within 7 days +25
 *   2+ late payments in 90 days +20 · open complaint +15 (no complaint record yet)
 *   tenure under 60 days +10 · 2+ extensions +10
 * 60 or more is at risk.
 */

const DAY = 86_400_000;
export const AT_RISK = 60;

/** Score and reasons for one contract. Pure. */
export function scoreContract(c, { latePayments90 = 0, openComplaint = false, now = new Date() } = {}) {
   const reasons = []; let score = 0;
   const add = (n, why) => { score += n; reasons.push(why); };
   const daysLeft = (new Date(c.endDate) - now) / DAY;
   if (c.renewalIntent === 'not_renewing') add(40, 'Said they are not renewing');
   if ((c.renewalIntent || 'undecided') === 'undecided' && daysLeft >= 0 && daysLeft <= 7) add(25, `Undecided, ends in ${Math.max(0, Math.ceil(daysLeft))} days`);
   if (latePayments90 >= 2) add(20, `${latePayments90} late payments in 90 days`);
   if (openComplaint) add(15, 'Open complaint');
   if ((now - new Date(c.startDate)) / DAY < 60) add(10, 'With us under 60 days');
   const ext = (c.renewalHistory || []).filter((h) => /^extension/.test(h.reason || '')).length;
   if (ext >= 2) add(10, `${ext} extensions`);
   return { score, reasons };
}

export async function churnRisk({ now = new Date(), min = AT_RISK } = {}) {
   const contracts = await Contract.find({ status: 'active' }).select('contractNo customer unit renewalIntent startDate endDate rate billingPeriod renewalHistory salesRep').populate('customer', 'fullName phone').populate('unit', 'unitNumber').populate('salesRep', 'name').lean();
   const late = await Payment.aggregate([
      { $match: { contract: { $in: contracts.map((c) => c._id) }, dueDate: { $gte: new Date(now - 90 * DAY), $lt: now }, $or: [{ status: 'overdue' }, { status: 'paid', $expr: { $gt: ['$paidDate', '$dueDate'] } }] } },
      { $group: { _id: '$contract', n: { $sum: 1 } } },
   ]);
   const lateBy = Object.fromEntries(late.map((l) => [String(l._id), l.n]));
   const rows = contracts.map((c) => ({ c, ...scoreContract(c, { latePayments90: lateBy[String(c._id)] || 0, now }) }))
      .filter((r) => r.score >= min).sort((a, b) => b.score - a.score)
      .map(({ c, score, reasons }) => ({ contractId: String(c._id), contractNo: c.contractNo, customer: c.customer?.fullName || '', unit: c.unit?.unitNumber || '', endDate: c.endDate, rate: c.rate || 0, billingPeriod: c.billingPeriod, owner: c.salesRep?.name || '', ownerId: c.salesRep?._id ? String(c.salesRep._id) : '', score, reasons }));
   return { threshold: min, atRisk: rows.length, valueAtRisk: Math.round(rows.reduce((s, r) => s + (r.rate || 0), 0) * 100) / 100, contracts: rows, note: 'Rules only (WP-27). Open complaints are not recorded in the CRM yet, so that rule never adds points.' };
}
