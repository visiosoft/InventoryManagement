import { WhatsAppMessage, Lead, Customer, Quote, Contract, Unit, ConversationSummary } from '../../models/index.js';
import { issuedQuoteFilter } from '../../utils/unitStatus.js';

/**
 * The facts the customer-facing agents are all built from.
 *
 * Assembled once per run and handed round, because every agent here needs the
 * same joins and none of them should each fetch the lead table again.
 */

/** The last nine digits. Numbers are stored as +971…, 0…, 971… and 05…, so
 *  this is the identity rule the inbox, the Zoho matcher and the lead sync all
 *  already use — an agent that invented its own would disagree with the rest
 *  of the system about who somebody is. */
export const suffix = (p) => String(p || '').replace(/\D/g, '').slice(-9);

/** A name the sync invented rather than one a person gave us. */
export const isPlaceholderName = (n) => !n || /^whatsapp\s*contact/i.test(String(n).trim());

/** Meta only delivers free text within 24 hours of their last message. Outside
 *  it nothing typed arrives, so it decides what advice is even actionable. */
export function windowOpen(lastInboundAt, now = new Date()) {
   if (!lastInboundAt) return false;
   return new Date(lastInboundAt).getTime() + 24 * 3600_000 > new Date(now).getTime();
}

export function daysBetween(from, to = new Date()) {
   if (!from) return null;
   return Math.max(0, Math.floor((new Date(to) - new Date(from)) / 864e5));
}

/**
 * One row per conversation, with the direction facts the predicates need.
 *
 * The date range is applied before the grouping, so a narrow range is cheap —
 * and it means the range asks "who last had contact with us in this period",
 * which is what somebody means by missed clients *between these dates*.
 */
export async function loadThreads({ from = null, to = null } = {}) {
   const match = { deletedAt: null };
   if (from || to) {
      match.occurredAt = {};
      if (from) match.occurredAt.$gte = new Date(from);
      if (to) match.occurredAt.$lte = new Date(to);
   }
   return WhatsAppMessage.aggregate([
      { $match: match },
      { $sort: { occurredAt: -1 } },
      {
         $group: {
            _id: '$phoneNormalized',
            phone: { $first: '$phone' },
            lastAt: { $max: '$occurredAt' },
            lastText: { $first: '$text' },
            lastMessageId: { $first: '$messageId' },
            count: { $sum: 1 },
            inbound: { $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] } },
            outbound: { $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] } },
            lastInboundAt: { $max: { $cond: [{ $eq: ['$direction', 'inbound'] }, '$occurredAt', null] } },
            lastOutboundAt: { $max: { $cond: [{ $eq: ['$direction', 'outbound'] }, '$occurredAt', null] } },
         },
      },
   ], { allowDiskUse: true });
}

/**
 * Everybody the threads might belong to, indexed by the nine-digit key.
 *
 * Note quotes are indexed by **customer**, not by lead: of 59 quotations on
 * production, 59 carry a customer and 2 carry a lead. A "never quoted" rule
 * written against `Quote.lead` reports every single lead as never quoted,
 * which is exactly the wrong answer and a convincing-looking one.
 */
export async function loadPeople() {
   const [leads, customers, quotes, contracts, units, summaries] = await Promise.all([
      Lead.find({})
         .select('fullName firstName phone phoneNormalized status owner ownerSeenAt assignedAt firstResponseAt followUpAt attempts sequenceExhaustedAt storageSizeValue durationValue durationUnit unitsNeeded temperature preferredContact email unsubscribed whatsappOptIn whatsappProfileName leadDateTime')
         .populate('owner', 'name')
         .lean(),
      Customer.find({}).select('fullName phone phones email unsubscribed whatsappOptIn').lean(),
      Quote.find(issuedQuoteFilter()).select('quoteNo customer lead total status flowStep contract quoteDate updatedAt').lean(),
      Contract.find({}).select('customer status startDate endDate rate leasedPrice contractNo').lean(),
      Unit.find({ price: { $gt: 0 } }).select('sizeSqf price').lean(),
      ConversationSummary.find({}).select('phoneNormalized summary lastMessageId').lean(),
   ]);

   const byLead = new Map();
   for (const l of leads) {
      const k = suffix(l.phoneNormalized || l.phone);
      // A real name beats a placeholder when two records share a number.
      const held = byLead.get(k);
      if (!held || (isPlaceholderName(held.fullName) && !isPlaceholderName(l.fullName))) byLead.set(k, l);
   }

   // By id as well as by phone: a contract knows its customer's id, and a
   // customer with no phone on record is still somebody with a name.
   const customerById = new Map(customers.map((c) => [String(c._id), c]));

   const byCustomer = new Map();
   for (const c of customers) {
      for (const p of [c.phone, ...(c.phones || [])].filter(Boolean)) {
         if (!byCustomer.has(suffix(p))) byCustomer.set(suffix(p), c);
      }
   }

   const quotesByCustomer = new Map();
   const quotesByLead = new Map();
   for (const q of quotes) {
      if (q.customer) {
         const list = quotesByCustomer.get(String(q.customer)) || [];
         list.push(q);
         quotesByCustomer.set(String(q.customer), list);
      }
      if (q.lead) quotesByLead.set(String(q.lead), q);
   }

   const contractsByCustomer = new Map();
   for (const c of contracts) {
      const list = contractsByCustomer.get(String(c.customer)) || [];
      list.push(c);
      contractsByCustomer.set(String(c.customer), list);
   }

   // Average monthly price per size, so a stated requirement becomes a number.
   const bySize = new Map();
   for (const u of units) {
      const held = bySize.get(u.sizeSqf) || { total: 0, n: 0 };
      held.total += u.price;
      held.n += 1;
      bySize.set(u.sizeSqf, held);
   }
   const priceBySize = new Map([...bySize].map(([size, v]) => [size, v.total / v.n]));

   const summaryByPhone = new Map();
   for (const s of summaries) summaryByPhone.set(s.phoneNormalized, s);

   return { byLead, byCustomer, customerById, quotesByCustomer, quotesByLead, contractsByCustomer, priceBySize, summaryByPhone };
}

const LIVE_CONTRACT = ['active', 'pending_signature', 'draft'];

/** Whether this customer is currently renting anything. */
export function hasLiveContract(contracts = []) {
   return contracts.some((c) => LIVE_CONTRACT.includes(c.status));
}

/**
 * What this person is worth a month, and how we decided.
 *
 * `null` rather than 0 when nothing is known — an unknown value shown as AED 0
 * would sort a serious enquiry to the bottom and look like a fact. The basis
 * travels with the number so a card can say where it came from.
 */
export function estimateValue({ lead, quote, contracts = [] }, priceBySize) {
   if (quote?.total > 0) return { aed: Math.round(quote.total), basis: `quotation ${quote.quoteNo || ''}`.trim() };

   const past = contracts.find((c) => c.leasedPrice > 0 || c.rate > 0);
   if (past) return { aed: Math.round(past.leasedPrice || past.rate), basis: 'their last contract' };

   const size = Number(lead?.storageSizeValue || 0);
   if (size > 0 && priceBySize.size) {
      // The nearest size we actually stock, since people ask for 90 and we let
      // 100 sq ft units.
      let best = null;
      for (const [s, price] of priceBySize) {
         if (best === null || Math.abs(s - size) < Math.abs(best[0] - size)) best = [s, price];
      }
      if (best) {
         const units = Math.max(1, Number(lead.unitsNeeded || 1));
         return { aed: Math.round(best[1] * units), basis: `asked for ${size} sq ft` };
      }
   }
   return { aed: null, basis: 'not enough to say' };
}

/** How the person should be shown, preferring a name somebody actually gave. */
export function displayNameFor({ lead, customer, phoneNormalized }) {
   const fromLead = lead && !isPlaceholderName(lead.fullName) ? lead.fullName : '';
   return customer?.fullName || fromLead || `+${phoneNormalized}`;
}
