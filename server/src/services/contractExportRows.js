/**
 * The tenant list as a spreadsheet, with the figures the contract card shows.
 *
 * Asking price, leased price, quotation, received and remaining are all
 * derived rather than stored — the contract page works them out from the
 * unit's price list, a discount, an override and the payment records, in that
 * order of precedence. Exporting them meant either repeating that arithmetic
 * in the browser, once per contract, or doing it here in one pass.
 *
 * It is here, and it is written to match ContractDetail.tsx exactly. Two
 * places computing money from the same records is how a spreadsheet ends up
 * disagreeing with the screen it was exported from, and the spreadsheet is
 * the copy that gets emailed to somebody.
 *
 * The precedence rules, each of which exists because of a real case:
 *
 *   asking     the sum of the units' own prices, from Settings → Unit
 *              Pricing. Falls back to the contract's rate for units priced
 *              before that page existed.
 *   leased     an explicit leasedPrice wins, including 0. Otherwise the
 *              asking price less the first-month discount.
 *   quotation  a saved totalQuotation wins, including 0 — a manual edit has
 *              to stick. Only never-set falls back to what has been paid.
 *   received   manualReceived wins, including 0. Otherwise the paid records.
 *   remaining  quotation less received, never below zero.
 */

import { Contract, Payment } from '../models/index.js';

/** Whole weeks between two dates, rounded up, as the contract card counts. */
export function weeksBetween(startDate, endDate) {
   if (!startDate || !endDate) return null;
   const days = Math.round((new Date(endDate) - new Date(startDate)) / 864e5);
   return Math.ceil(days / 7);
}

/**
 * The money on one contract.
 *
 * @param contract  with `unit`/`units` populated
 * @param paid      what the payment records say has been collected
 */
export function moneyFor(contract, paid = 0) {
   const units = [contract.unit, ...(contract.units || [])].filter(Boolean);
   const priced = units.filter((u) => u?.price != null);
   const asking = priced.length
      ? priced.reduce((sum, u) => sum + Number(u.price ?? 0), 0)
      : Number(contract.rate || 0);

   const discount = Number(contract.firstMonthDiscountPct || 0);
   const leased = contract.leasedPrice != null
      ? Number(contract.leasedPrice)
      : Math.round(asking * (1 - discount / 100) * 100) / 100;

   const quotation = contract.totalQuotation != null ? Number(contract.totalQuotation) : paid;
   const received = contract.manualReceived != null ? Number(contract.manualReceived) : paid;

   return {
      asking,
      leased,
      quotation,
      received,
      remaining: Math.max(0, quotation - received),
      sizeSqf: units.reduce((sum, u) => sum + (Number(u?.sizeSqf) || 0), 0) || null,
   };
}

/**
 * Every contract matching `filter`, with its figures worked out.
 *
 * One query for the contracts and one for the payments, rather than a payment
 * lookup per contract: 148 tenants would otherwise be 149 round trips to Atlas
 * for a file somebody is waiting on.
 */
export async function contractExportRows(filter = {}) {
   /* Named fields only.
    *
    * Every contract carries its agreement wording — around 59 KB of it — and
    * asking for whole documents pulled roughly nine megabytes across the wire
    * to build a spreadsheet that uses none of it. The export took 35 seconds
    * for 148 tenants. This is the same trap the tenant list itself fell into
    * once; the fix is the same one. */
   const contracts = await Contract.find(filter)
      .select('contractNo customer unit units status renewalIntent startDate endDate rate leasedPrice totalQuotation manualReceived firstMonthDiscountPct createdAt')
      .populate('customer', 'fullName email phone phones')
      .populate('unit', 'unitNumber floor sizeSqf price')
      .populate('units', 'unitNumber floor sizeSqf price')
      .sort({ createdAt: -1 })
      .lean();

   if (!contracts.length) return [];

   const paidByContract = new Map();
   const rows = await Payment.aggregate([
      { $match: { contract: { $in: contracts.map((c) => c._id) }, status: 'paid' } },
      { $group: { _id: '$contract', paid: { $sum: '$amount' } } },
   ]);
   for (const r of rows) paidByContract.set(String(r._id), Number(r.paid) || 0);

   return contracts.map((c) => {
      const units = [c.unit, ...(c.units || [])].filter(Boolean);
      const m = moneyFor(c, paidByContract.get(String(c._id)) || 0);
      const daysLeft = c.endDate && ['active', 'pending_signature'].includes(c.status)
         ? Math.ceil((new Date(c.endDate) - Date.now()) / 864e5)
         : null;

      return {
         tenant: c.customer?.fullName || '',
         // Every number on file: a spreadsheet is where somebody goes to
         // phone a list of people.
         phone: [c.customer?.phone, ...(c.customer?.phones || [])]
            .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' / '),
         email: c.customer?.email || '',
         contractNo: c.contractNo || '',
         units: units.map((u) => u?.unitNumber).filter(Boolean).join(', '),
         floor: units.map((u) => u?.floor).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', '),
         sizeSqf: m.sizeSqf,
         checkIn: c.startDate || null,
         checkOut: c.endDate || null,
         weeks: weeksBetween(c.startDate, c.endDate),
         daysLeft,
         asking: m.asking,
         leased: m.leased,
         quotation: m.quotation,
         received: m.received,
         remaining: m.remaining,
         status: c.status,
         renewal: c.renewalIntent || '',
      };
   });
}
