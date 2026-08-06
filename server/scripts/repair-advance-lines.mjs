/**
 * Repair invoices whose "Advance Rent" line bills a flat 4 weeks instead of the
 * contract's final rental period (a 6-week term runs 4 + 2, so its advance is
 * 2 weeks). Only touches invoices with nothing paid against them.
 *
 * Idempotent: rows that already match are left alone. Pass --dry to preview.
 *   node scripts/repair-advance-lines.mjs [--dry]
 */
import { connectDb } from '../src/db.js';
import { Invoice, Contract, Payment } from '../src/models/index.js';

const DRY = process.argv.includes('--dry');
const ADVANCE_LINE = /^(Advance Rent|Refundable Advance|Refundable \/ Adjustable Security Deposit)/i;
const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

await connectDb();

const invoices = await Invoice.find({
  paymentMade: { $lte: 0 },
  status: { $in: ['draft', 'sent'] },
  'items.itemDetails': { $regex: ADVANCE_LINE },
});

let fixed = 0;
let skipped = 0;

for (const inv of invoices) {
  const contract = inv.orderNumber ? await Contract.findOne({ contractNo: inv.orderNumber }) : null;
  if (!contract?.startDate || !contract?.endDate) { skipped++; continue; }

  const days = Math.round((new Date(contract.endDate) - new Date(contract.startDate)) / 86400000);
  if (days <= 0) { skipped++; continue; }
  const fullMonths = Math.floor(days / 28);
  const rem = days % 28;
  const termWeeks = (fullMonths * 4 + (rem > 0 ? Math.ceil(rem / 7) : 0)) || 1;
  const advWeeks = termWeeks % 4 === 0 ? 4 : termWeeks % 4;

  const advIdx = inv.items.findIndex((it) => ADVANCE_LINE.test(it.itemDetails || ''));
  if (advIdx === -1) { skipped++; continue; }
  const adv = inv.items[advIdx];
  if (Number(adv.quantity) === advWeeks) { skipped++; continue; }

  // Only touch lines priced per week. Legacy invoices store the advance as
  // qty 1 x the whole monthly amount — rescaling those would inflate them.
  const wkRate = Number(adv.rate || 0);
  const expectedWeekly = Math.round((Number(contract.rate || 0) / 4) * 100) / 100;
  if (!expectedWeekly || Math.abs(wkRate - expectedWeekly) > 0.01) {
    console.log(`${inv.invoiceNo}: SKIP — advance rate ${wkRate} is not the weekly rate (${expectedWeekly})`);
    skipped++;
    continue;
  }

  const newAmount = Math.round(wkRate * advWeeks * 100) / 100;

  // Re-date the label to the period the advance actually prepays (the last one)
  const advStart = new Date(contract.endDate);
  advStart.setDate(advStart.getDate() - advWeeks * 7);
  const advEnd = new Date(contract.endDate);
  advEnd.setDate(advEnd.getDate() - 1);
  const unitPart = (adv.itemDetails.match(/·\s*(Unit .+)$/) || [])[1];
  const isShort = termWeeks <= 4;
  const newLabel = isShort
    ? `Refundable Advance${unitPart ? ` · ${unitPart}` : ''}`
    : `Advance Rent ${fmt(advStart)} – ${fmt(advEnd)}${unitPart ? ` · ${unitPart}` : ''}`;

  const oldAmount = Number(adv.amount || 0);
  const newTotal = Math.round((Number(inv.total || 0) - oldAmount + newAmount) * 100) / 100;

  console.log(
    `${inv.invoiceNo}: advance ${adv.quantity}wk (${oldAmount}) -> ${advWeeks}wk (${newAmount}); ` +
    `total ${inv.total} -> ${newTotal}`
  );

  if (!DRY) {
    inv.items[advIdx].quantity = advWeeks;
    inv.items[advIdx].amount = newAmount;
    inv.items[advIdx].itemDetails = newLabel;
    inv.subTotal = newTotal;
    inv.total = newTotal;
    await inv.save();

    // Realign the unpaid payment records with their invoice lines, so the
    // rent/advance split matches the invoice instead of the old amounts.
    const rentAmount = inv.items.find((it) => /^Storage Rent/i.test(it.itemDetails || ''))?.amount;
    const linked = await Payment.find({ invoice: inv._id, status: { $ne: 'paid' } });
    for (const p of linked) {
      const target = ADVANCE_LINE.test(p.notes || '') ? newAmount : rentAmount;
      if (target != null && Math.abs(p.amount - target) > 0.01) {
        p.amount = target;
        await p.save();
      }
    }
  }
  fixed++;
}

console.log(`\n${DRY ? '[dry run] would fix' : 'fixed'}: ${fixed} · unchanged: ${skipped}`);
process.exit(0);
