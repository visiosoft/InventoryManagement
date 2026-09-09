/**
 * Say which "waiting" leads a rep has actually already answered.
 *
 * firstResponseAt was only ever set by logging an attempt on the Follow-Up
 * Plan or changing a lead's stage — neither of which is where a WhatsApp
 * reply actually happens. A rep who spent all day replying in the inbox
 * itself never touched either, so a lead they had genuinely answered kept
 * counting as "waiting" for days, in the one panel that exists to catch
 * exactly that. Fixed going forward in routes/whatsapp.js: every human send
 * now marks the lead answered the moment it goes out.
 *
 * This is the other half — the leads already sitting in that state when the
 * fix landed, whose real reply happened before it did and so was never
 * recorded. For each: the earliest human-sent (not the assistant's)
 * outbound WhatsApp message at or after assignedAt, if one exists, becomes
 * firstResponseAt. A lead with no such message is left alone — it really is
 * still waiting, and this script does not invent an answer for it.
 *
 *   node scripts/backfill-lead-first-response.mjs          # dry run, writes nothing
 *   node scripts/backfill-lead-first-response.mjs --write
 */

import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import 'dotenv/config';
process.env.TZ = 'Asia/Dubai';
import mongoose from 'mongoose';

const WRITE = process.argv.includes('--write');
const SHOW = Number(process.env.SHOW ?? 15);

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
const { Lead, WhatsAppMessage } = await import('../src/models/index.js');

console.log(WRITE ? 'Writing.\n' : 'Dry run — nothing will be written.\n');

const leads = await Lead.find({
   assignedAt: { $ne: null },
   firstResponseAt: null,
   owner: { $ne: null },
   status: { $nin: ['won', 'lost', 'already_customer'] },
}).select('fullName phoneNormalized owner assignedAt').populate('owner', 'name').lean();

console.log(`leads currently "waiting" : ${leads.length}\n`);

let answered = 0;
let stillWaiting = 0;
const examples = [];

for (const l of leads) {
   if (!l.phoneNormalized) { stillWaiting++; continue; }
   // The earliest genuine reply after this lead became theirs — the moment
   // that should have stopped the clock at the time.
   const reply = await WhatsAppMessage.findOne({
      phoneNormalized: l.phoneNormalized,
      direction: 'outbound',
      sentByAi: { $ne: true },
      occurredAt: { $gte: l.assignedAt },
   }).sort({ occurredAt: 1 }).select('occurredAt').lean();

   if (!reply) { stillWaiting++; continue; }
   answered++;
   if (examples.length < SHOW) {
      const hours = Math.round((new Date(reply.occurredAt) - new Date(l.assignedAt)) / 3600000);
      examples.push(`  ${String(l.fullName || l.phoneNormalized).slice(0, 30).padEnd(32)}${l.owner?.name || '—'} — replied ${hours}h after assignment`);
   }
   if (!WRITE) continue;
   await Lead.updateOne({ _id: l._id, firstResponseAt: null }, { $set: { firstResponseAt: reply.occurredAt } });
}

if (examples.length) console.log(examples.join('\n'), '\n');

console.log('summary');
console.log(`  leads read                : ${leads.length}`);
console.log(`  had a real reply on file  : ${answered}`);
console.log(`  genuinely still waiting   : ${stillWaiting}`);
if (!WRITE) console.log('\nnothing was written. Re-run with --write to apply.');

await mongoose.disconnect();
