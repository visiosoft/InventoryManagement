/**
 * Who closed a deal, and which lead it came from.
 *
 * Contracts recorded `salesRep` as whoever clicked Create — which is nearly
 * always an admin doing the paperwork, not the rep who worked the lead — and
 * never wrote `contract.lead` at all. Measured on production before this
 * existed: 209 contracts, 21 with a rep against them, 0 joined to a lead, and
 * 6 leads out of 521 marked won. Nothing recorded that anybody had closed
 * anything, so there was nothing to recognise anyone for.
 *
 * This resolves the credit once, in one place, so the two creation paths
 * (routes/quotes.js converting a quote, routes/contracts.js creating one
 * directly) cannot come to different answers.
 *
 * The phone rule is the app's standing one: two numbers are the same person if
 * their last nine digits match. It is what the WhatsApp inbox uses to attach a
 * conversation to a lead, and what the leads search uses. Written out, a UAE
 * number appears as +971 55 464 4265, 055 464 4265 or 971554644265, and the
 * last nine digits are the only part all three agree on.
 */

import { promoteToCustomer } from './customerStage.js';
import { snapshotIntentAtClose } from './leadScore.js';
import { Lead, Contract } from '../models/index.js';
import { recheckAndSync } from './contractPayment.js';

/** The last nine digits of every number we hold for somebody. */
export function phoneSuffixes(customer) {
   return [...(customer?.phones || []), customer?.phone]
      .map((p) => String(p || '').replace(/\D/g, ''))
      .filter((d) => d.length >= 9)
      .map((d) => d.slice(-9));
}

/**
 * The lead this customer came from, found by their number.
 *
 * Split out because it is wanted before a deal is closed as well as at the
 * moment it is: a quote that records the lead it came from makes the credit
 * exact later, instead of leaving it to be guessed from a phone number.
 * The oldest match wins — the first time they ever contacted us is the
 * enquiry that started this.
 */
export async function leadForCustomer(customer) {
   const suffixes = phoneSuffixes(customer);
   if (!suffixes.length) return null;
   /* Anchored at the end, so 554644265 matches 971554644265 without also
      matching a number that merely contains those digits in the middle. */
   const or = suffixes.map((s) => ({ phoneNormalized: new RegExp(`${s}$`) }));
   return Lead.findOne({ $or: or }).select('_id owner assignedAt status fullName')
      .sort({ createdAt: 1 }).lean();
}

/**
 * Decide who to credit.
 *
 * Returns { leadId, ownerId, matchedBy } where matchedBy is:
 *   'quote'    the quote named the lead outright — exact, and preferred
 *   'phone'    the customer's number matched a lead
 *   'fallback' no lead found; credit stays with whoever was going to get it
 *
 * `fallbackUserId` is what the caller would have used anyway, so a contract is
 * never left uncredited by this being unable to find a lead.
 */
export async function creditFor({ quote, customer, fallbackUserId }) {
   let lead = null;
   let matchedBy = 'fallback';

   if (quote?.lead) {
      lead = await Lead.findById(quote.lead).select('_id owner assignedAt status').lean();
      if (lead) matchedBy = 'quote';
   }

   if (!lead) {
      lead = await leadForCustomer(customer);
      if (lead) matchedBy = 'phone';
   }

   /* Credit the lead's owner only where a person chose them.
    *
    * Every conversation auto-creates a lead and gives it a default owner, and
    * on this database that owner is the admin on 274 of 521 leads. Crediting
    * the owner outright handed him 96 of the first 100 deals - a board that
    * says the administrator closed everything and the two reps closed nothing.
    * assignedAt is set only when somebody actually handed the lead over, which
    * is the same test the leads board and the inbox badge use.
    *
    * Where nobody chose, the credit stays where it already went: the person
    * raising the contract. Imperfect, but recorded rather than inferred. */
   if (lead && lead.assignedAt && lead.owner) {
      return { leadId: lead._id, ownerId: lead.owner, matchedBy };
   }
   return {
      leadId: lead?._id ?? null,
      ownerId: fallbackUserId ?? null,
      matchedBy: lead ? `${matchedBy}-unassigned` : 'fallback',
   };
}

/**
 * Mark the lead won, once.
 *
 * A lead already won is left alone: re-stamping it would move the date the
 * board counts it under, and a second contract for the same customer would
 * make an old win look like a new one. Never throws — a contract must still be
 * created if this fails.
 */
export async function markLeadWon({ leadId, contractNo, userId }) {
   if (!leadId) return { changed: false, reason: 'no lead' };
   try {
      const lead = await Lead.findById(leadId);
      if (!lead) return { changed: false, reason: 'lead not found' };
      if (lead.status === 'won') return { changed: false, reason: 'already won' };

      await snapshotIntentAtClose(lead);
      lead.status = 'won';
      lead.timeline = lead.timeline || [];
      lead.timeline.push({
         type: 'updated',
         text: `Won — contract ${contractNo} signed`,
         user: userId || undefined,
         at: new Date(),
      });
      await lead.save();
      return { changed: true };
   } catch (e) {
      return { changed: false, reason: e.message };
   }
}


/**
 * A contract has been signed: only now is the lead won and the customer a
 * tenant. Both used to happen the moment a DRAFT contract was created, so a
 * lead counted as won (and a rep as having closed) before anyone had signed
 * anything. Call this wherever a contract becomes active by signature or
 * approval. Idempotent — a lead already won, or a customer already promoted,
 * is left alone — and it never throws.
 */
export async function onContractSigned(contract, { userId } = {}) {
   try {
      if (!contract) return;
      const customerId = contract.customer?._id || contract.customer;
      await markLeadWon({ leadId: contract.lead, contractNo: contract.contractNo, userId });
      await promoteToCustomer(customerId, { contractNo: contract.contractNo });
    // Signed (or signed again): the paper is current, and from now on the unit
    // only turns Occupied once the first payment is verified.
    await Contract.updateOne({ _id: contract._id }, { $set: { resignNeeded: null } });
    // New signing: put it under the payment rule (once; a re-signing keeps its original date).
    // Only a move-in that is today, ahead, or just happened: re-signing or renewing
    // a tenant who has been there a while must not put their unit under the rule.
    const recent = contract.startDate && new Date(contract.startDate) >= new Date(Date.now() - 3 * 864e5);
    if (recent) await Contract.updateOne({ _id: contract._id, 'paymentGate.since': null }, { $set: { 'paymentGate.required': true, 'paymentGate.since': new Date() } });
    recheckAndSync(contract._id).catch(() => {});
   } catch (e) {
      console.error('[DealCredit] onContractSigned:', e.message);
   }
}
