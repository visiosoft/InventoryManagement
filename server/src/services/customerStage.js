/**
 * When somebody stops being an enquiry and becomes a tenant.
 *
 * Quoting used to require a customer record. A rep worked a lead, the customer
 * asked for a price, and the only way to raise a quotation was to convert the
 * lead — which created a tenant, marked the lead won, and left both wrong if
 * the person never came back. Measured on production: 354 customer records,
 * 185 with a contract against them. Nearly half the tenant list had never
 * rented anything.
 *
 * So a record now knows which it is:
 *
 *   prospect   quoted, talked to, priced — not a tenant
 *   customer   has signed a contract
 *
 * The only thing that promotes anybody is a contract. Not a quotation, not a
 * site visit, not a deposit discussed on the phone — a signed contract, which
 * is the same event the deal-credit and the leaderboard count. Nothing demotes
 * anybody: somebody whose contract ended is a past tenant, not a prospect
 * again, and treating them as one would put them back on prospecting lists.
 *
 * Nothing here throws. A contract must be created even if this cannot be
 * recorded — the contract is the fact, this is the label.
 */

import { Customer } from '../models/index.js';

/**
 * How to ask for one kind or the other.
 *
 * One place, because the tenant list, the counts and anything else that slices
 * by this have to agree about what an absent `stage` means. It means tenant:
 * that is what every record written before the field existed meant, so the
 * test is "not a prospect" rather than "is a customer".
 *
 * Anything else — no filter — is everybody, which is what every quote and
 * booking picker wants.
 */
export function stageFilter(stage) {
   if (stage === 'prospect') return { stage: 'prospect' };
   if (stage === 'customer') return { stage: { $ne: 'prospect' } };
   return {};
}

/** What promotion writes, and who it writes it to. Pure, so the rule can be
 *  asserted without a database: only somebody who is not already a tenant, so
 *  a second contract never moves the date of the first. */
export function promotion(customerId, at = new Date()) {
   return {
      filter: { _id: customerId, stage: { $ne: 'customer' } },
      update: { $set: { stage: 'customer', becameCustomerAt: at } },
   };
}

/**
 * Mark somebody a customer, because they have signed.
 *
 * Idempotent, and safe to call on every contract: a second contract for the
 * same tenant leaves the original date alone, because when they became a
 * customer is the day of the first one.
 *
 * @returns { promoted: boolean, reason?: string }
 */
export async function promoteToCustomer(customerId, { contractNo = '', at = new Date() } = {}) {
   if (!customerId) return { promoted: false, reason: 'no customer' };
   try {
      const { filter, update } = promotion(customerId, at);
      const result = await Customer.updateOne(filter, update);
      const promoted = (result.modifiedCount ?? 0) > 0;
      if (promoted && contractNo) {
         console.log(`[CustomerStage] ${customerId} is a tenant now (${contractNo})`);
      }
      return { promoted };
   } catch (e) {
      console.error('[CustomerStage] could not promote', String(customerId), e.message);
      return { promoted: false, reason: e.message };
   }
}

/** How many of each there are, for the tabs on the tenant list. */
export async function stageCounts() {
   const [customers, prospects] = await Promise.all([
      Customer.countDocuments(stageFilter('customer')),
      Customer.countDocuments(stageFilter('prospect')),
   ]);
   return { customer: customers, prospect: prospects };
}
