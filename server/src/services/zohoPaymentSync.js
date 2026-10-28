import { Payment, Invoice, SyncRun } from '../models/index.js';
import { zohoBooksConfigured, listZohoPaymentsSince, listZohoInvoicesSince } from './zohoBooks.js';

/**
 * Payments taken in Zoho Books, brought into the CRM (WP-01).
 *
 * The CRM never had this: every paid row was typed in by hand, and nothing
 * has been typed since 17 August. This reads Zoho's customer payments since
 * a date, matches each to a CRM invoice (by the Zoho invoice id the CRM
 * stored when it pushed the invoice, or by invoice number), and plans which
 * unpaid CRM rows of that invoice the money settles, oldest due first.
 *
 * Most invoices are made by hand in Zoho under Zoho's own number (INV-000925)
 * while the CRM keeps its own draft (PB-2026-F3-94-01), so few match by
 * number. For those, a CRM invoice with the same amount, a date within ten
 * days and the same customer (email, or name) is offered as a suggestion:
 * it is applied only when finance ticks it.
 *
 * Nothing is written by the plan. Apply writes only what the plan says, marks
 * each settled row with the Zoho payment id so a second run skips it, and
 * logs the run. A payment that cannot be matched, or whose amount does not
 * settle whole rows, is listed as an exception for finance — never guessed.
 */

const r2 = (n) => Math.round(n * 100) / 100;
const DAY = 86_400_000;
const words = (s) => String(s || '').toLowerCase().replace(/^(mr|mrs|ms|dr)\.?\s+/, '').split(/[^a-z\u0600-\u06ff]+/).filter((w) => w.length > 1);

/** Same customer: the same email, or at least two name words in common (one if either name has only one). Pure. */
export function sameCustomer(z, c) {
   const ze = String(z.email || '').toLowerCase().trim();
   if (ze && ze === String(c.customerEmail || '').toLowerCase().trim()) return true;
   const a = new Set(words(z.customer_name)); const b = words(c.customerName);
   const common = b.filter((w) => a.has(w)).length;
   return common >= Math.min(2, a.size, b.length) && common > 0;
}

/** Zoho's payment mode, in the CRM's words. Pure. */
export function methodFromZoho(mode) {
   const m = String(mode || '').toLowerCase();
   if (m.includes('cash')) return 'cash';
   if (m.includes('cheque') || m.includes('check')) return 'cheque';
   if (m.includes('card') || m.includes('credit') || m.includes('stripe')) return 'card';
   if (m.includes('bank') || m.includes('transfer') || m.includes('remittance') || m.includes('wire')) return 'bank_transfer';
   return 'other';
}

/**
 * The plan. Pure.
 * @param zohoPayments  [{ id, date, amount, mode, reference, invoiceNumbers: 'INV-1, INV-2' }]
 * @param zohoInvoices  [{ invoice_id, invoice_number, reference_number }]
 * @param crmInvoices   [{ _id, invoiceNo, zohoBooksSyncId, contract }]
 * @param unpaidRows    [{ _id, invoice, contract, amount, dueDate }]
 * @param appliedIds    Set of Zoho payment ids already applied
 */
export function planSync({ zohoPayments, zohoInvoices, crmInvoices, unpaidRows, appliedIds = new Set() }) {
   const zByNumber = new Map(zohoInvoices.map((z) => [String(z.invoice_number), z]));
   const crmByZohoId = new Map(crmInvoices.filter((i) => i.zohoBooksSyncId).map((i) => [String(i.zohoBooksSyncId), i]));
   const crmByNo = new Map(crmInvoices.map((i) => [String(i.invoiceNo), i]));
   const rowsByInvoice = new Map();
   for (const r of [...unpaidRows].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))) {
      const k = String(r.invoice || '');
      if (k) (rowsByInvoice.get(k) || rowsByInvoice.set(k, []).get(k)).push(r);
   }
   const taken = new Set();
   const apply = []; const suggestions = []; const exceptions = []; let skipped = 0;

   for (const p of zohoPayments) {
      if (appliedIds.has(String(p.id))) { skipped += 1; continue; }
      const numbers = String(p.invoiceNumbers || '').split(',').map((s) => s.trim()).filter(Boolean);
      const crm = numbers.map((n) => {
         const z = zByNumber.get(n);
         return (z && (crmByZohoId.get(String(z.invoice_id)) || crmByNo.get(String(z.reference_number || '')))) || crmByNo.get(n) || null;
      }).filter(Boolean);
      const base = { zohoPaymentId: String(p.id), date: p.date, amount: r2(p.amount), method: methodFromZoho(p.mode), reference: p.reference || '', invoiceNumbers: numbers.join(', ') };
      let suggested = false;
      if (!crm.length) {
         // Same customer, same amount, within ten days: offered, not applied.
         for (const n of numbers) {
            const z = zByNumber.get(n);
            if (!z) continue;
            const cands = crmInvoices.filter((c) => Math.abs(r2(c.total) - r2(z.total)) <= 0.01
               && Math.abs(new Date(c.invoiceDate || c.createdAt) - new Date(z.date)) <= 10 * DAY && sameCustomer(z, c));
            if (cands.length === 1) crm.push(cands[0]);
         }
         suggested = crm.length > 0;
      }
      if (!crm.length) { exceptions.push({ ...base, reason: numbers.length ? 'No CRM invoice matches this Zoho invoice by number, or by customer, amount and date' : 'The Zoho payment names no invoice' }); continue; }
      // Settle whole rows, oldest due first, across the invoices it names.
      let left = r2(p.amount);
      const rows = [];
      for (const inv of crm) {
         for (const r of rowsByInvoice.get(String(inv._id)) || []) {
            if (taken.has(String(r._id))) continue;
            if (r2(r.amount) <= left + 0.005) { rows.push(r); taken.add(String(r._id)); left = r2(left - r.amount); }
         }
      }
      if (!rows.length) { exceptions.push({ ...base, invoice: crm.map((i) => i.invoiceNo).join(', '), reason: 'The CRM invoice has no unpaid row this amount settles' }); continue; }
      (suggested ? suggestions : apply).push({ ...base, invoice: crm.map((i) => i.invoiceNo).join(', '), customer: crm[0].customerName || p.customer || '', rowIds: rows.map((r) => String(r._id)), settles: r2(p.amount - left), unallocated: left, suggested });
   }
   return {
      apply, suggestions, exceptions, skipped,
      totals: { payments: zohoPayments.length, toApply: apply.length, suggestions: suggestions.length, rows: apply.reduce((n, a) => n + a.rowIds.length, 0), amount: r2(apply.reduce((n, a) => n + a.settles, 0)), exceptions: exceptions.length, alreadyApplied: skipped },
   };
}

async function gather(since) {
   const [zp, zi, applied] = await Promise.all([
      listZohoPaymentsSince(since),
      listZohoInvoicesSince(new Date(new Date(since).getTime() - 365 * 86_400_000).toISOString().slice(0, 10)),
      Payment.distinct('zohoPaymentId', { zohoPaymentId: { $nin: [null, ''] } }),
   ]);
   const numbers = new Set(zp.flatMap((p) => String(p.invoiceNumbers || '').split(',').map((s) => s.trim())).filter(Boolean));
   const zInv = zi.filter((z) => numbers.has(String(z.invoice_number)));
   const totals = [...new Set(zInv.map((z) => r2(z.total)))];
   const crmInvoices = (await Invoice.find({ $or: [
      { zohoBooksSyncId: { $in: zInv.map((z) => String(z.invoice_id)) } },
      { invoiceNo: { $in: [...numbers, ...zInv.map((z) => z.reference_number).filter(Boolean)] } },
      { total: { $in: totals }, invoiceDate: { $gte: new Date(new Date(since).getTime() - 60 * DAY) } },
   ] }).select('invoiceNo zohoBooksSyncId contract total invoiceDate createdAt customer').populate('customer', 'fullName email').lean())
      .map((i) => ({ ...i, customerName: i.customer?.fullName || '', customerEmail: i.customer?.email || '' }));
   const unpaidRows = await Payment.find({ invoice: { $in: crmInvoices.map((i) => i._id) }, status: { $in: ['pending', 'overdue'] } }).select('invoice contract amount dueDate').lean();
   return { zohoPayments: zp, zohoInvoices: zInv, crmInvoices, unpaidRows, appliedIds: new Set(applied.map(String)) };
}

export async function previewZohoPaymentSync({ since }) {
   if (!zohoBooksConfigured()) return { configured: false, error: 'Zoho Books is not connected' };
   return { configured: true, since, ...planSync(await gather(since)) };
}

export async function applyZohoPaymentSync({ since, user, accept = [] }) {
   if (!zohoBooksConfigured()) return { configured: false, error: 'Zoho Books is not connected' };
   const plan = planSync(await gather(since));
   const ok = new Set(accept.map(String));
   const chosen = [...plan.apply, ...plan.suggestions.filter((s) => ok.has(s.zohoPaymentId))];
   let rows = 0;
   for (const a of chosen) {
      const r = await Payment.updateMany(
         { _id: { $in: a.rowIds }, status: { $in: ['pending', 'overdue'] } },
         { $set: { status: 'paid', method: a.method, paidDate: new Date(a.date), recordedBy: 'Zoho Books sync', zohoPaymentId: a.zohoPaymentId, source: 'zoho', notes: a.reference ? `Zoho ref ${a.reference}` : '' } },
      );
      rows += r.modifiedCount || 0;
   }
   await SyncRun.create({ kind: 'zoho_payments', since, by: user?.name || user?.email || '', applied: chosen.length, rows, exceptions: plan.exceptions.length, skipped: plan.skipped, exceptionList: plan.exceptions.slice(0, 200) });
   return { ok: true, applied: chosen.length, rows, exceptions: plan.exceptions };
}
