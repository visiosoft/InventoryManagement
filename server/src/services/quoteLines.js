/**
 * What a quote actually charges, as a list of lines.
 *
 * These lines were written inside the PDF renderer, which made the printed
 * quotation the only place that knew what a quote consisted of. Everything
 * else re-derived it: the stored total in routes/quotes.js has its own copy of
 * the rules, the page has a third, and the task email to accounts had none at
 * all — it sent the monthly rate and a deposit of zero, so a fortnight's
 * booking that came to 750.25 arrived as "Rate AED 650" and nothing else.
 *
 * One list, one place. The renderer draws it, the email prints it, and the
 * sub total is the sum of it — so a rule that changes here changes everywhere
 * at once rather than in whichever copy somebody remembered.
 *
 * Money rules, all of which the first invoice also applies:
 *   - rent is the discounted weekly rate for the first four weeks and the full
 *     rate thereafter, the discount being a first-period offer;
 *   - the refundable deposit is four weeks, or the whole term if it is
 *     shorter, at the undiscounted weekly rate;
 *   - the refundable deposit and the security deposit are held and given back,
 *     so they sit outside the VAT base, as does any add-on or line item named
 *     as refundable (see quoteVat.js).
 */

import { isRefundableRow } from './quoteVat.js';

function dt(d) {
   if (!d) return '-';
   return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Whole weeks in a unit's term, rounded up; 0 when the dates are missing. */
export function termWeeks(unit) {
   const days = unit?.startDate && unit?.endDate
      ? Math.round((new Date(unit.endDate) - new Date(unit.startDate)) / 86400000)
      : 0;
   return days > 0 ? Math.ceil(days / 7) : 0;
}

/**
 * Every charged line on a quote, in the order they are printed.
 *
 * Each line is { title, sub, qty, rate, amount, taxable }. `taxable` is the
 * line's own flag rather than something worked out again later, so the tax
 * base cannot drift from the list it is drawn from.
 */
export function quoteLines(quote) {
   const rows = [];

   for (const u of quote.units || []) {
      const size = u.sizeSqf ? `${u.sizeSqf} sqft` : '';
      const floor = u.floor ? `Floor ${u.floor}` : '';
      const meta = [size, floor].filter(Boolean).join(', ');
      const disc = Number(u.discountPct || 0);
      const uTotalWk = termWeeks(u);
      const durationStr = uTotalWk > 0 ? ` · ${uTotalWk} week${uTotalWk !== 1 ? 's' : ''}` : '';
      const wkFull = Number((u.rate / 4).toFixed(2));
      const wkDisc = Number((wkFull - (wkFull * disc) / 100).toFixed(2));
      const discWks = Math.min(4, uTotalWk || 1);
      const fullWks = Math.max(0, (uTotalWk || 1) - 4);
      rows.push({
         title: `Storage Unit ${u.unitNumber}${meta ? ` (${meta})` : ''}`,
         sub: `${dt(u.startDate)} – ${dt(u.endDate)}${durationStr}${disc > 0 ? ` · ${disc}% off first 4 weeks` : ''}`,
         qty: uTotalWk || 1,
         rate: wkFull,
         amount: Number((discWks * wkDisc + fullWks * wkFull).toFixed(2)),
         taxable: true,
      });
   }

   if (quote.holdAdvance !== false) {
      for (const u of quote.units || []) {
         const advWeeks = Math.min(4, termWeeks(u) || 1);
         const wkFull = Number((u.rate / 4).toFixed(2));
         rows.push({
            title: `Refundable Deposit · Unit ${u.unitNumber}`,
            sub: 'Held and refunded or adjusted at the end of the rental',
            qty: advWeeks,
            rate: wkFull,
            amount: Number((wkFull * advWeeks).toFixed(2)),
            taxable: false,
         });
      }
   }

   for (const a of quote.addOns || []) {
      rows.push({
         title: a.name,
         sub: a.description || '',
         qty: a.quantity,
         rate: a.rate,
         amount: a.amount,
         taxable: !isRefundableRow(a.name),
      });
   }

   for (const it of quote.items || []) {
      rows.push({
         title: it.itemDetails || '-',
         sub: '',
         qty: it.quantity ?? 0,
         rate: it.rate,
         amount: it.amount,
         taxable: !isRefundableRow(it.itemDetails),
      });
   }

   const depositAmt = Number(quote.deposit || 0);
   if (depositAmt > 0) {
      rows.push({
         title: 'Security Deposit (refundable)',
         sub: '',
         qty: 1,
         rate: depositAmt,
         amount: depositAmt,
         taxable: false,
      });
   }

   return rows;
}

/**
 * The money at the foot of a quote, summed from the lines above it.
 *
 * VAT is charged on the taxable lines only — the sub total includes money that
 * is held and handed back, and charging 5% of that bills the customer for a
 * sum they are owed.
 */
export function quoteTotals(quote, rows = quoteLines(quote)) {
   const subTotal = Number(rows.reduce((s, r) => s + Number(r.amount || 0), 0).toFixed(2));
   const adjustment = Number(quote.adjustment || 0);
   const vatRate = quote.vatEnabled === false ? 0 : Number(quote.vatRate || 5);
   const taxable = rows.reduce((s, r) => s + (r.taxable ? Number(r.amount || 0) : 0), 0);
   const vatAmount = Number((Math.max(0, taxable + adjustment) * (vatRate / 100)).toFixed(2));
   return {
      subTotal,
      adjustment,
      vatRate,
      vatAmount,
      total: Number((subTotal + adjustment + vatAmount).toFixed(2)),
   };
}
