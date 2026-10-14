import { Contract, Invoice } from '../models/index.js';
import { findZohoContactsFor, fetchZohoInvoicesForContacts, zohoBooksConfigured } from './zohoBooks.js';
import { syncUnitStatus } from '../utils/unitStatus.js';

/**
 * Has the tenant actually paid for this unit?
 *
 * A signed contract only turns its unit Occupied once the check-in day has
 * arrived AND the first payment is verified. Until then the unit stays
 * Reserved, so a tenant who has signed but not paid is never shown as moved in.
 *
 * "Verified" means Zoho Books says the contract's opening invoice(s) are paid.
 * The customer is found in Zoho by email or phone — never by name, which is
 * spelled differently in the two systems — and the contract's invoices are
 * matched by the Zoho invoice id stored when they were synced. A person at the
 * desk can also mark it verified by hand (cash, a transfer Zoho has not seen
 * yet); that choice is kept until somebody changes it.
 *
 * Only contracts with `paymentGate.required` are held to this. Contracts that
 * were running before the rule existed are left exactly as they were.
 */

const DAY = 864e5;

/** The opening invoices: the earliest one and anything raised within 3 days of it (e.g. a deposit). */
export function openingInvoices(invoices) {
  const live = (invoices || []).filter((i) => i.status !== 'cancelled');
  if (!live.length) return [];
  const first = Math.min(...live.map((i) => new Date(i.invoiceDate).getTime()));
  return live.filter((i) => new Date(i.invoiceDate).getTime() - first <= 3 * DAY);
}

/** Decide from the facts. Pure, so it can be tested without Zoho. */
export function judgePayment({ opening, zohoConfigured, zohoMatched, zohoById }) {
  if (!opening.length) return { verified: false, source: 'none', detail: 'No invoice has been raised for this contract yet' };
  if (!zohoConfigured) {
    const paid = opening.every((i) => i.status === 'paid');
    return { verified: paid, source: 'local', detail: paid ? 'Paid (Zoho not connected — read from our own invoices)' : 'Opening invoice is not paid' };
  }
  if (!zohoMatched) return { verified: false, source: 'zoho', detail: 'No customer in Zoho matches this email or phone number' };
  const unsynced = opening.filter((i) => !i.zohoBooksSyncId);
  if (unsynced.length) return { verified: false, source: 'zoho', detail: `Invoice ${unsynced[0].invoiceNo} has not reached Zoho yet` };
  const unpaid = opening.filter((i) => zohoById.get(String(i.zohoBooksSyncId))?.status !== 'paid');
  if (unpaid.length) return { verified: false, source: 'zoho', detail: `Invoice ${unpaid[0].invoiceNo} is not paid in Zoho` };
  return { verified: true, source: 'zoho', detail: `Paid in Zoho (${opening.map((i) => i.invoiceNo).join(', ')})` };
}

/** Look the payment up and store the answer on the contract. Never throws. */
export async function checkContractPayment(contractId) {
  try {
    const contract = await Contract.findById(contractId).populate('customer', 'email phone phones').lean();
    if (!contract) return null;
    if (contract.paymentGate?.manual) return contract.paymentGate;

    const invoices = await Invoice.find({ orderNumber: contract.contractNo }).select('invoiceNo invoiceDate status zohoBooksSyncId').lean();
    const opening = openingInvoices(invoices);

    let zohoMatched = false;
    const zohoById = new Map();
    const zohoOn = zohoBooksConfigured();
    if (zohoOn && opening.length) {
      const cust = contract.customer || {};
      const { contacts } = await findZohoContactsFor({ emails: [cust.email].filter(Boolean), phones: [cust.phone, ...(cust.phones || [])].filter(Boolean) });
      zohoMatched = contacts.length > 0;
      if (zohoMatched) {
        const { invoices: zi } = await fetchZohoInvoicesForContacts(contacts.map((c) => c.id));
        for (const z of zi) zohoById.set(String(z.id), z);
      }
    }
    const verdict = judgePayment({ opening, zohoConfigured: zohoOn, zohoMatched, zohoById });
    await Contract.updateOne({ _id: contractId }, { $set: {
      'paymentGate.required': true, 'paymentGate.verified': verdict.verified, 'paymentGate.source': verdict.source,
      'paymentGate.detail': verdict.detail, 'paymentGate.checkedAt': new Date(),
    } });
    return verdict;
  } catch (e) {
    console.error('[ContractPayment]', e.message);
    return null;
  }
}

/** Re-check, then bring every unit on the contract into line with the answer. */
export async function recheckAndSync(contractId) {
  const verdict = await checkContractPayment(contractId);
  const c = await Contract.findById(contractId).select('unit units').lean();
  for (const u of new Set([c?.unit, ...(c?.units || [])].filter(Boolean).map(String))) await syncUnitStatus(u);
  return verdict;
}

/**
 * Sweep: contracts that are signed, held to the rule, not yet verified, and
 * starting within a day (or already started). Run every few minutes so a unit
 * turns Occupied soon after the payment lands in Zoho.
 */
export async function verifyPendingPayments() {
  const soon = new Date(Date.now() + DAY);
  const pending = await Contract.find({
    status: 'active', archived: { $ne: true },
    'paymentGate.verified': { $ne: true }, 'paymentGate.manual': { $ne: true },
    startDate: { $lte: soon },
    // Already held to the rule and unpaid, or a contract nobody has checked yet
    // (every contract that was running before the rule: it gets checked once,
    // and from then on is held to it like the rest).
    $or: [
      { 'paymentGate.required': true, 'paymentGate.checkedAt': { $lt: new Date(Date.now() - 10 * 60_000) } },
      { 'paymentGate.required': true, 'paymentGate.checkedAt': null },
      { 'paymentGate.checkedAt': null }, { 'paymentGate.checkedAt': { $exists: false } },
    ],
  }).sort({ 'paymentGate.checkedAt': 1 }).select('_id').limit(60).lean();
  for (const c of pending) await recheckAndSync(c._id);
  return pending.length;
}
