import { Contract, Customer, nextContractNo } from '../models/index.js';
import { creditFor, markLeadWon } from './dealCredit.js';
import { promoteToCustomer } from './customerStage.js';
import { createFirstInvoiceFromQuote, toNumber } from './quotePricing.js';
import { syncUnitStatus } from '../utils/unitStatus.js';

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

const SYSTEM = { name: 'customer app', userId: null };

/**
 * Turn an accepted quote into a draft contract plus its draft first invoice.
 *
 * This is the body of POST /api/quotes/:id/convert-to-contract, moved out so a
 * paid app booking can run it with no staff member logged in. `actor` is who
 * gets named on the timeline; `userId` is only used for lead credit and may be
 * absent.
 *
 * Throws errors carrying `.status` (409 already converted / not accepted, 400 no
 * units). If anything after the contract is created fails, the contract is
 * removed again so a retry cannot pile up duplicates.
 */
export async function convertQuoteToContract(quote, { actor = SYSTEM, authorizedPersons = [], paymentMethod = '' } = {}) {
  if (quote.status !== 'accepted') throw fail(409, 'Only accepted quotes can be converted to a contract');
  if (quote.contract) {
    const existing = await Contract.findById(quote.contract).select('_id contractNo');
    if (existing) throw fail(409, `Quote already converted to contract ${existing.contractNo}`, { contractId: existing._id });
    quote.contract = undefined; // stale ref — allow re-conversion
  }
  if (!quote.units?.length) throw fail(400, 'Quote has no units to convert');

  const unitIds = quote.units.map((u) => u.unit);
  const startDate = new Date(Math.min(...quote.units.map((u) => new Date(u.startDate).getTime())));
  const endDate = new Date(Math.max(...quote.units.map((u) => new Date(u.endDate).getTime())));
  const rate = Number(quote.units.reduce((s, u) => s + toNumber(u.rate), 0).toFixed(2));
  const discounts = [...new Set(quote.units.map((u) => toNumber(u.discountPct)))];
  const firstMonthDiscountPct = discounts.length === 1 ? discounts[0] : 0;

  const noteParts = [];
  if (quote.notes) noteParts.push(quote.notes);
  if (quote.addOns?.length) {
    noteParts.push('Add-ons: ' + quote.addOns.map((a) => `${a.name} x${a.quantity} (${a.amount} AED)`).join(', '));
  }

  const persons = authorizedPersons
    .map((p) => ({
      name: String(p.name || '').trim(),
      phone: String(p.phone || '').trim(),
      relation: String(p.relation || '').trim(),
      idType: String(p.idType || '').trim(),
      idNumber: String(p.idNumber || '').trim(),
    }))
    .filter((p) => p.name);

  const credit = await creditFor({
    quote,
    customer: await Customer.findById(quote.customer).select('phone phones').lean(),
    fallbackUserId: quote.assignedTo || actor.userId,
  });

  const contract = await Contract.create({
    contractNo: await nextContractNo(),
    customer: quote.customer,
    unit: unitIds[0],
    units: unitIds.length > 1 ? unitIds : [],
    billingPeriod: quote.billingPeriod || 'monthly',
    rate,
    deposit: toNumber(quote.deposit),
    startDate,
    endDate,
    firstMonthDiscountPct,
    notes: noteParts.join('\n'),
    paymentMethod: String(paymentMethod || ''),
    authorizedPersons: persons,
    totalQuotation: Number(quote.total || 0),
    quote: quote._id,
    lead: credit.leadId,
    salesRep: quote.assignedTo || credit.ownerId || actor.userId || undefined,
    source: 'quote',
    approvalStatus: 'not_required',
    status: 'draft',
    timeline: [{ at: new Date(), text: `Created from quote ${quote.quoteNo} by ${actor.name}`, author: actor.name }],
  });

  try {
    await markLeadWon({ leadId: credit.leadId, contractNo: contract.contractNo, userId: actor.userId });
    await promoteToCustomer(quote.customer, { contractNo: contract.contractNo });

    quote.contract = contract._id;
    quote.timeline.push({ type: 'converted', text: `Converted to contract ${contract.contractNo} by ${actor.name}`, user: actor.userId || undefined });

    const invoice = await createFirstInvoiceFromQuote(quote, contract, actor.name);
    contract.timeline.push({ at: new Date(), text: `Draft invoice ${invoice.invoiceNo} generated from quote (prices locked)`, author: actor.name });
    await contract.save();
    await quote.save();

    await Promise.all(unitIds.map((uid) => syncUnitStatus(uid)));
    return { contract, invoice };
  } catch (err) {
    await Contract.deleteOne({ _id: contract._id });
    throw fail(500, `Could not finish converting the quote: ${err.message}`);
  }
}
