import { Customer, Lead } from '../models/index.js';
import { digitTail } from './leadRouting.js';

/**
 * Somebody who is already our customer is not a new lead.
 *
 * Their WhatsApp chats used to create a lead at "New" like anybody else's, so
 * tenants were being counted — and chased — as fresh enquiries. Matched the
 * way the inbox decides to show the green Customer tag: the last nine digits
 * of the number, against people who have signed (not prospects).
 */
async function customerTails() {
   const customers = await Customer.find({ stage: { $ne: 'prospect' } }).select('phone phones').lean();
   const tails = new Set();
   for (const c of customers) {
      for (const p of [...(c.phones || []), c.phone]) {
         const t = digitTail(p);
         if (t) tails.add(t);
      }
   }
   return tails;
}

export async function isExistingCustomerPhone(phoneNormalized) {
   const tail = digitTail(phoneNormalized);
   if (!tail) return false;
   return (await customerTails()).has(tail);
}

/**
 * One-off catch-up, harmless to repeat: leads still sitting at "New" whose
 * number belongs to a signed customer move to "Already customer". Only "New"
 * is touched — anything a rep has already worked keeps its stage.
 */
export async function markCustomerLeads() {
   const tails = await customerTails();
   if (!tails.size) return 0;
   const leads = await Lead.find({ status: 'new' }).select('phoneNormalized phone').lean();
   const ids = leads.filter((l) => tails.has(digitTail(l.phoneNormalized || l.phone))).map((l) => l._id);
   if (!ids.length) return 0;
   const r = await Lead.updateMany(
      { _id: { $in: ids }, status: 'new' },
      { $set: { status: 'already_customer' }, $push: { timeline: { type: 'note', text: 'Already a customer — moved out of New leads' } } },
   );
   return r.modifiedCount ?? 0;
}
