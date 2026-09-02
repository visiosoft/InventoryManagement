/**
 * What a moving quote or invoice adds up to.
 *
 * One rule, used by the routes that store the figure, the PDFs that print it
 * and the pages that show it. The totals used to be worked out in the browser
 * and posted up, so the server stored whatever it was handed — two screens
 * could disagree and the document would follow whichever saved last. Storage
 * quotes learned this the hard way; this is the same fix, applied before it
 * costs anybody a wrong invoice.
 *
 * Order matters: the discount comes off first, and VAT is charged on what is
 * left. Charging VAT on the pre-discount figure would bill tax on money the
 * customer was never asked for.
 */

export const MOVING_VAT_RATE = 5;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param items      [{ amount }] — the priced lines
 * @param discount   percent off the sub total, 0–100
 * @param vatEnabled false turns VAT off entirely; absent means on
 * @param vatRate    percent, defaults to 5
 */
/**
 * Does this document charge VAT?
 *
 * Three states, and they are all different:
 *   true       — it charges VAT, decided when it was saved
 *   false      — somebody turned it off
 *   undefined  — it was raised before VAT existed here
 *
 * The last one is settled by status. A draft has not gone to anybody, so it is
 * priced at today's rules; anything sent, accepted or paid keeps the figures
 * it was agreed at. That is why the schema stores no default: a default makes
 * "never had the field" indistinguishable from "deliberately off".
 */
export function chargesVat({ vatEnabled, status } = {}) {
   if (vatEnabled === true) return true;
   if (vatEnabled === false) return false;
   return status === 'draft';
}

export function movingTotals({ items = [], discount = 0, vatEnabled, vatRate, status } = {}) {
   const subTotal = round2((items || []).reduce((s, i) => s + (Number(i?.amount) || 0), 0));

   const pct = Math.min(100, Math.max(0, Number(discount) || 0));
   const discountAmount = round2((subTotal * pct) / 100);
   const net = round2(subTotal - discountAmount);

   // See chargesVat: a settled document keeps its own figures, a draft is
   // priced at today's rules.
   const rate = chargesVat({ vatEnabled, status }) ? Number(vatRate ?? MOVING_VAT_RATE) || 0 : 0;
   const vatAmount = round2((Math.max(0, net) * rate) / 100);

   return {
      subTotal,
      discount: pct,
      discountAmount,
      net,
      vatRate: rate,
      vatAmount,
      total: round2(net + vatAmount),
   };
}

/**
 * What is still owed, once the deposit and any payments are counted.
 *
 * Kept beside the totals because a balance derived from a different total than
 * the one printed is how an invoice ends up asking for the wrong money.
 */
export function movingBalance({ total, depositPaid = 0, paymentHistory = [] }) {
   const paid = round2(
      (Number(depositPaid) || 0) + (paymentHistory || []).reduce((s, p) => s + (Number(p?.amount) || 0), 0),
   );
   return { paid, balanceDue: Math.max(0, round2((Number(total) || 0) - paid)) };
}
