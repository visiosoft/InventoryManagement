// One-off: where a contract's billed payment records exceed its stored
// totalQuotation, lift totalQuotation to match. After this the sidebar can
// show the stored value directly and manual edits stick.
//
// Usage:  node scripts/align-contract-quotations.mjs --dry
//         node scripts/align-contract-quotations.mjs
import { connectDb } from '../src/db.js';
import { Contract, Payment } from '../src/models/index.js';

const DRY = process.argv.includes('--dry');
await connectDb();

const agg = await Payment.aggregate([
  { $group: { _id: '$contract', total: { $sum: '$amount' } } },
]);
const payMap = new Map(agg.map((a) => [String(a._id), Math.round(a.total * 100) / 100]));

const contracts = await Contract.find({}).select('contractNo totalQuotation').lean();
let changed = 0;
for (const c of contracts) {
  const paid = payMap.get(String(c._id)) || 0;
  const stored = Math.round(Number(c.totalQuotation || 0) * 100) / 100;
  if (paid <= stored) continue;
  changed++;
  console.log(`${c.contractNo}: totalQuotation ${stored} -> ${paid}`);
  if (!DRY) await Contract.updateOne({ _id: c._id }, { $set: { totalQuotation: paid } });
}
console.log(`\n${DRY ? '[DRY] would change' : 'Changed'} ${changed} of ${contracts.length} contracts`);
process.exit(0);
