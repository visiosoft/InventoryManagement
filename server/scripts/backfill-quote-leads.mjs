/**
 * Join existing quotes to the leads they came from.
 *
 * Quotes have always had a `lead` field and the pages almost never filled it
 * in: 1 of 57 on production named a lead. That link is what makes the credit
 * for a closed deal exact rather than inferred — a contract converted from a
 * quote takes the quote's lead outright, and only falls back to matching phone
 * numbers when there is none.
 *
 * New quotes record it at creation now (routes/quotes.js). This is for the
 * ones already there, so a deal closed from an old quote is credited the same
 * way as a deal closed from a new one.
 *
 * Only `quote.lead` is written, and only where it is empty. Nothing about the
 * quote's money, status or owner is touched, and a quote that already names a
 * lead is left exactly as it is.
 *
 *   node scripts/backfill-quote-leads.mjs          # dry run, writes nothing
 *   node scripts/backfill-quote-leads.mjs --write
 */

import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import 'dotenv/config';
process.env.TZ = 'Asia/Dubai';
import mongoose from 'mongoose';

const WRITE = process.argv.includes('--write');

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
const { Quote, Customer } = await import('../src/models/index.js');
const { leadForCustomer } = await import('../src/services/dealCredit.js');

console.log(WRITE ? 'Writing.\n' : 'Dry run — nothing will be written.\n');

const quotes = await Quote.find({}).select('quoteNo customer lead status').sort({ createdAt: 1 }).lean();

let linked = 0;
let already = 0;
let noLead = 0;

for (const q of quotes) {
   if (q.lead) { already++; continue; }

   const customer = await Customer.findById(q.customer).select('fullName phone phones').lean();
   const lead = await leadForCustomer(customer).catch(() => null);
   if (!lead) { noLead++; continue; }

   console.log(
      `  ${String(q.quoteNo || q._id).padEnd(12)} -> ${String(lead.fullName || lead._id).slice(0, 34).padEnd(36)}`
      + `${String(customer?.fullName || '').slice(0, 24)}`,
   );
   linked++;
   if (WRITE) await Quote.updateOne({ _id: q._id }, { $set: { lead: lead._id } });
}

console.log('\nsummary');
console.log(`  quotes read            : ${quotes.length}`);
console.log(`  joined to a lead       : ${linked}`);
console.log(`  already named one      : ${already}`);
console.log(`  no matching lead       : ${noLead}`);
if (!WRITE) console.log('\nnothing was written. Re-run with --write to apply.');

await mongoose.disconnect();
