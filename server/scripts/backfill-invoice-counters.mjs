// Seeds the new unit+year invoice counters from existing invoiceNo values so
// the fixed nextInvoiceNo() doesn't immediately collide with numbers already
// in use under the old per-contract counter scheme.
//   node scripts/backfill-invoice-counters.mjs [--dry]
import 'dotenv/config';
import dns from 'node:dns'; dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';
import { Invoice, Counter } from '../src/models/index.js';

const dry = process.argv.includes('--dry');
await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || 'PurpleBox' });

const invoices = await Invoice.find({ invoiceNo: /^PB-\d{4}-.+-\d{2}$/ }).select('invoiceNo').lean();
const re = /^PB-(\d{4})-(.+)-(\d{2})$/;
const maxSeq = new Map(); // key -> max seq

for (const inv of invoices) {
  const m = inv.invoiceNo.match(re);
  if (!m) continue;
  const [, year, unitKey, seqStr] = m;
  const key = `inv-unit-${unitKey}-${year}`;
  const seq = Number(seqStr);
  if (!maxSeq.has(key) || seq > maxSeq.get(key)) maxSeq.set(key, seq);
}

console.log(`${maxSeq.size} unit+year counters to seed (from ${invoices.length} matching invoices)`);
for (const [key, seq] of maxSeq) {
  console.log(dry ? `[dry] ${key} -> seq ${seq}` : `${key} -> seq ${seq}`);
  if (!dry) {
    await Counter.findOneAndUpdate({ key }, { $max: { seq } }, { upsert: true });
  }
}

await mongoose.disconnect();
console.log(dry ? 'Dry run complete — no writes made.' : 'Done.');
