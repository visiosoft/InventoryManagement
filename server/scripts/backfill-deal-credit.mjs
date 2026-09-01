/**
 * Join existing contracts to the leads they came from.
 *
 * Contracts have never recorded which lead they came from, and leads were
 * almost never moved to "won" — 6 of 521, against 209 contracts. So the
 * pipeline showed nearly every customer who ever signed as still being chased.
 *
 * This writes the two things the records actually support:
 *
 *   contract.lead   the lead whose number matches the customer's
 *   lead.status     won, because they signed
 *
 * It deliberately does NOT rewrite `salesRep`. Planning looked for evidence of
 * who closed these deals and there is none: of the 100 contracts that map to a
 * lead, 97 carry only the automatic owner every WhatsApp lead is given (the
 * admin, on 274 of 521 leads), and none has a single logged chase against it.
 * Crediting on that would put the administrator top of the board with 96 deals
 * and both reps on nothing. An invented winner is worse than an empty board.
 *
 *   node scripts/backfill-deal-credit.mjs          # dry run, writes nothing
 *   node scripts/backfill-deal-credit.mjs --write
 */

import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import 'dotenv/config';
process.env.TZ = 'Asia/Dubai';
import mongoose from 'mongoose';

const WRITE = process.argv.includes('--write');

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
const { Contract, Quote, Lead } = await import('../src/models/index.js');
const { creditFor } = await import('../src/services/dealCredit.js');

const contracts = await Contract.find({})
   .select('contractNo customer quote lead salesRep createdAt')
   .populate('customer', 'fullName phone phones')
   .sort({ createdAt: 1 })
   .lean();

console.log(WRITE ? 'WRITING\n' : 'DRY RUN — nothing will be written (pass --write)\n');
console.log(`${contracts.length} contracts to consider\n`);

let linked = 0, won = 0, alreadyLinked = 0, noLead = 0, alreadyWon = 0;

for (const c of contracts) {
   if (c.lead) { alreadyLinked++; continue; }

   const quote = c.quote ? await Quote.findById(c.quote).select('lead').lean() : null;
   const { leadId, matchedBy } = await creditFor({ quote, customer: c.customer, fallbackUserId: null });
   if (!leadId) { noLead++; continue; }

   const lead = await Lead.findById(leadId).select('fullName status').lean();
   const willWin = lead && lead.status !== 'won';
   if (!willWin) alreadyWon++;

   console.log(
      `  ${c.contractNo}  ->  ${String(lead?.fullName || leadId).slice(0, 32).padEnd(34)}`
      + `${matchedBy.padEnd(18)}${willWin ? `${lead.status} -> won` : 'already won'}`,
   );

   if (WRITE) {
      await Contract.updateOne({ _id: c._id }, { $set: { lead: leadId } });
      linked++;
      if (willWin) {
         await Lead.updateOne({ _id: leadId }, {
            $set: { status: 'won' },
            $push: { timeline: { type: 'updated', text: `Won — contract ${c.contractNo} signed`, at: new Date() } },
         });
         won++;
      }
   } else {
      linked++;
      if (willWin) won++;
   }
}

console.log('\n' + '-'.repeat(60));
console.log(`  contracts joined to a lead : ${linked}`);
console.log(`  leads marked won           : ${won}`);
console.log(`  already joined, skipped    : ${alreadyLinked}`);
console.log(`  already won                : ${alreadyWon}`);
console.log(`  no matching lead           : ${noLead}`);
console.log(`  salesRep changed           : 0 (never — see the note at the top)`);
if (!WRITE) console.log('\nnothing was written. Re-run with --write to apply.');

await mongoose.disconnect();
