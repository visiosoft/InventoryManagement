// Repairs the one-way job->invoice link bug: MovingJob.invoice was being set
// without the reciprocal MovingInvoice.job, so invoices never learned a job
// existed for them. For each job with an `invoice` set, if that invoice's
// `job` is empty, fill it in — first match wins per invoice (reported below
// so duplicates from repeated "Create Job" clicks are visible, not silently
// merged).
import 'dotenv/config';
import dns from 'node:dns'; dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';
import { MovingJob, MovingInvoice } from '../src/models/index.js';

const dry = process.argv.includes('--dry');
await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || 'PurpleBox' });

const jobs = await MovingJob.find({ invoice: { $ne: null } }).select('jobNo invoice title notes').lean();
const byInvoice = new Map();
for (const j of jobs) {
  const key = String(j.invoice);
  if (!byInvoice.has(key)) byInvoice.set(key, []);
  byInvoice.get(key).push(j);
}

let fixed = 0;
for (const [invoiceId, matchingJobs] of byInvoice) {
  const invoice = await MovingInvoice.findById(invoiceId).select('invoiceNo job');
  if (!invoice) { console.log(`invoice ${invoiceId} not found (referenced by ${matchingJobs.map(j => j.jobNo).join(', ')})`); continue; }
  if (matchingJobs.length > 1) {
    console.log(`DUPLICATE: invoice ${invoice.invoiceNo} is referenced by ${matchingJobs.length} jobs: ${matchingJobs.map(j => j.jobNo).join(', ')} — linking the first, review the rest manually`);
  }
  if (invoice.job) continue; // already linked, nothing to fix
  const chosen = matchingJobs[0];
  console.log(`${dry ? '[dry] ' : ''}${invoice.invoiceNo} -> job ${chosen.jobNo}`);
  if (!dry) {
    invoice.job = chosen._id;
    await invoice.save();
    fixed++;
  }
}

console.log(dry ? 'Dry run complete.' : `Fixed ${fixed} invoice(s).`);
await mongoose.disconnect();
