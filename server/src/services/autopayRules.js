/**
 * When, and for how much, a saved card is charged automatically. Pure (no database, no Stripe) so the rules that decide
 * whether somebody's card is touched can be read and tested in one place.
 *
 * The principles:
 *  - only a customer who turned auto-pay on, with a saved card, is ever charged;
 *  - only an invoice that is already due (or overdue) with something owing;
 *  - at most one attempt per invoice per day, and three failed attempts in a row switch it off;
 *  - the card fee is charged on top of what is owed, exactly as it is at checkout.
 */

export const MAX_FAILURES = 3;
export const AUTOPAY_CONSENT_VERSION = '2026-10';
export const AUTOPAY_CONSENT_TEXT =
  'I authorise PurpleBox to charge this card automatically for my storage invoices when they fall due, until I turn auto-pay off in the app. '
  + 'I can change or remove the card at any time.';

const DAY = 86_400_000;
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

export const balanceOf = (invoice) => Math.max(0, Math.round((Number(invoice.total || 0) - Number(invoice.paymentMade || 0)) * 100) / 100);

/** Amounts in fils: what is owed, the fee on top, and what the card is charged. */
export function autopayAmounts(invoice) {
  const owedFils = Math.round(balanceOf(invoice) * 100);
  const pct = invoice.cardFeeEnabled ? Number(invoice.cardFeePct) || 0 : 0;
  const feeFils = owedFils > 0 && pct > 0 ? Math.round(owedFils * (pct / 100)) : 0;
  return { owedFils, feeFils, totalFils: owedFils + feeFils, feePct: pct };
}

/** Is this customer set up to be charged? */
export function autopayReady(customer) {
  const a = customer?.autopay || {};
  return !!(a.enabled && a.paymentMethodId && customer?.stripeCustomerId && (a.failureCount || 0) < MAX_FAILURES);
}

/** Should this invoice be charged now? `now` is a Date. */
export function invoiceDueForAutopay(invoice, now = new Date()) {
  if (!['sent', 'partial', 'overdue'].includes(invoice.status)) return false;
  if (balanceOf(invoice) <= 0) return false;
  // due today or earlier (compared by calendar day so "due today" is charged today)
  if (dayKey(invoice.dueDate) > dayKey(now)) return false;
  const last = invoice.autopay?.lastAttemptAt;
  if (last && dayKey(last) === dayKey(now)) return false; // one attempt per day
  if (invoice.autopay?.lastStatus === 'processing') return false;
  return true;
}

/** After a failed attempt: how the customer's auto-pay record should change. */
export function afterFailure(autopay, reason, now = new Date()) {
  const failureCount = (autopay?.failureCount || 0) + 1;
  return { failureCount, lastFailureAt: now, lastFailureReason: String(reason || '').slice(0, 200), enabled: failureCount >= MAX_FAILURES ? false : !!autopay?.enabled };
}

export const afterSuccess = () => ({ failureCount: 0, lastFailureReason: '' });

/** Idempotency key: one charge per invoice per calendar day, even if the job runs twice. */
export const autopayIdempotencyKey = (invoiceId, now = new Date()) => `autopay-${invoiceId}-${dayKey(now)}`;

export { DAY };
