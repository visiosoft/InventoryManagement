// Recomputes every quote's subTotal/total with the single total rule:
//   total = units + add-ons + items + adjustment
//         + refundable advance for terms of 4 weeks or less
//         + security deposit
// and refreshes totalQuotation on linked contracts that are not yet booked.
//
// Usage:  node scripts/recompute-quote-totals.mjs --dry   (report only)
//         node scripts/recompute-quote-totals.mjs         (write changes)
import { connectDb } from '../src/db.js';
import { Quote, Contract } from '../src/models/index.js';

const DRY = process.argv.includes('--dry');
const r2 = (n) => Math.round(n * 100) / 100;

await connectDb();

const quotes = await Quote.find({}).sort({ quoteNo: 1 }).lean();
let changed = 0;
let contractsTouched = 0;

for (const q of quotes) {
  const unitsTotal = (q.units ?? []).reduce((s, u) => s + Number(u.amount || 0), 0);
  const addOnsTotal = (q.addOns ?? []).reduce((s, a) => s + Number(a.amount || 0), 0);
  const itemsTotal = (q.items ?? []).reduce((s, it) => s + Number(it.amount || 0), 0);
  const subTotal = r2(unitsTotal + addOnsTotal + itemsTotal);
  const adjustment = Number(q.adjustment || 0);
  const deposit = Number(q.deposit || 0);

  const advanceExtra = (q.units ?? []).reduce((sum, u) => {
    if (!u.startDate || !u.endDate) return sum;
    const days = Math.round((new Date(u.endDate) - new Date(u.startDate)) / 86400000);
    const tw = Math.max(1, Math.ceil(days / 7));
    if (tw > 4) return sum;
    return sum + (Number(u.rate || 0) / 4) * tw;
  }, 0);

  const total = r2(subTotal + adjustment + advanceExtra + deposit);

  const oldSub = r2(Number(q.subTotal || 0));
  const oldTotal = r2(Number(q.total || 0));
  if (oldSub === subTotal && oldTotal === total) continue;

  changed++;
  console.log(`${q.quoteNo}: subTotal ${oldSub} -> ${subTotal} · total ${oldTotal} -> ${total}`
    + (advanceExtra ? ` (advance ${r2(advanceExtra)})` : '')
    + (deposit ? ` (deposit ${r2(deposit)})` : ''));

  if (DRY) continue;
  await Quote.updateOne({ _id: q._id }, { $set: { subTotal, total } });

  // Refresh Total Quotation on the linked contract only while it isn't booked;
  // active/ended contracts are driven by their payment records.
  if (q.contract) {
    const res = await Contract.updateOne(
      { _id: q.contract, status: { $in: ['draft', 'pending_signature'] } },
      { $set: { totalQuotation: total } },
    );
    if (res.modifiedCount) {
      contractsTouched++;
      console.log(`  contract ${q.contract} totalQuotation -> ${total}`);
    }
  }
}

console.log(`\n${DRY ? '[DRY] would change' : 'Changed'} ${changed} of ${quotes.length} quotes`
  + (DRY ? '' : `, refreshed ${contractsTouched} contract(s)`));
process.exit(0);
