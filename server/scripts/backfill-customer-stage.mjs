/**
 * Say which of the tenant records are actually tenants.
 *
 * Quoting used to require creating a customer, so anybody who asked for a
 * price and never came back stayed on the tenant list for good. Measured
 * before this ran: 354 records, 185 with a contract against them.
 *
 * Going forward a contract is the only thing that promotes anybody. For the
 * records already here that test alone is too narrow: 27 of the 170 without a
 * contract have an invoice against them or an ID document on file. Those are
 * real tenancies from before the system recorded contracts properly, and
 * calling them prospects would put people who have rented from us back onto a
 * prospecting list. So history is read more generously than the future:
 *
 *   a contract, an invoice, or a document  ->  customer
 *   none of the three                      ->  prospect
 *
 * "Ever" is deliberate throughout. A tenant whose contract ended is a past
 * tenant, not a prospect again.
 *
 * Only `stage` and `becameCustomerAt` are written. Nothing about anybody's
 * name, number, documents or history is touched, and nothing is deleted —
 * a prospect keeps every field it had and stays searchable from every quote
 * and booking screen. It is a label, and it can be run again safely.
 *
 *   node scripts/backfill-customer-stage.mjs          # dry run, writes nothing
 *   node scripts/backfill-customer-stage.mjs --write
 */

import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import 'dotenv/config';
process.env.TZ = 'Asia/Dubai';
import mongoose from 'mongoose';

const WRITE = process.argv.includes('--write');
const SHOW = Number(process.env.SHOW ?? 15);

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
const { Customer, Contract, Quote, Invoice, Document } = await import('../src/models/index.js');

console.log(WRITE ? 'Writing.\n' : 'Dry run — nothing will be written.\n');

/* One query each rather than one per customer: 354 customers would otherwise
   be 354 round trips to Atlas for a job that is two set memberships. */
const contracts = await Contract.find({}).select('customer contractNo createdAt').sort({ createdAt: 1 }).lean();
const firstContract = new Map();
for (const c of contracts) {
   const key = String(c.customer);
   if (key && !firstContract.has(key)) firstContract.set(key, c);
}
const quotedIds = new Set((await Quote.distinct('customer')).filter(Boolean).map(String));
/* Evidence of a tenancy that predates contracts being recorded here: we have
   billed them, or we hold their Emirates ID. Either means they rented. */
const invoicedIds = new Set((await Invoice.distinct('customer')).filter(Boolean).map(String));
const documentedIds = new Set((await Document.distinct('customer')).filter(Boolean).map(String));

const customers = await Customer.find({}).select('fullName stage becameCustomerAt createdAt').lean();

let toCustomer = 0;
let toProspect = 0;
let unchanged = 0;
const examples = [];

for (const c of customers) {
   const key = String(c._id);
   const signed = firstContract.get(key);
   const billed = invoicedIds.has(key);
   const documented = documentedIds.has(key);
   const want = signed || billed || documented ? 'customer' : 'prospect';
   const have = c.stage === 'prospect' ? 'prospect' : 'customer';   // absent means tenant

   if (want === have && (want === 'prospect' || c.becameCustomerAt)) { unchanged++; continue; }
   if (want === have && want === 'customer' && !signed) { unchanged++; continue; }

   if (want === 'customer') toCustomer++; else toProspect++;
   if (examples.length < SHOW) {
      examples.push(
         `  ${String(c.fullName || key).slice(0, 32).padEnd(34)}${have} -> ${want.padEnd(10)}`
         + (signed ? `signed ${signed.contractNo}`
            : billed ? 'invoiced, no contract on file'
               : documented ? 'has documents on file, no contract'
                  : quotedIds.has(key) ? 'quoted, never signed'
                     : 'no quote, no invoice, no documents'),
      );
   }

   if (!WRITE) continue;
   await Customer.updateOne({ _id: c._id }, {
      $set: {
         stage: want,
         /* The day they became a tenant is the day of their first contract,
            not the day this script happened to run. Left null for the ones
            promoted on an invoice or a document alone: there is no contract to
            take a date from, and a made-up one would be worse than none. */
         ...(want === 'customer'
            ? { becameCustomerAt: signed?.createdAt ?? null }
            : { becameCustomerAt: null }),
      },
   });
}

if (examples.length) console.log(examples.join('\n'), '\n');

console.log('summary');
console.log(`  records read           : ${customers.length}`);
console.log(`  marked tenant         : ${toCustomer}`);
console.log(`  marked prospect       : ${toProspect}`);
console.log(`  already right         : ${unchanged}`);
const isProspect = (c) => {
   const k = String(c._id);
   return !firstContract.has(k) && !invoicedIds.has(k) && !documentedIds.has(k);
};
console.log(`  prospects who were quoted at least once: ${customers.filter((c) => isProspect(c) && quotedIds.has(String(c._id))).length}`);
console.log(`  prospects with no quote either         : ${customers.filter((c) => isProspect(c) && !quotedIds.has(String(c._id))).length}`);
if (!WRITE) console.log('\nnothing was written. Re-run with --write to apply.');

await mongoose.disconnect();
