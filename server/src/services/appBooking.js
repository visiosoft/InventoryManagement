import { Contract, Customer, Quote, Unit, nextQuoteNo } from '../models/index.js';
import { computeUnitAvailability } from './unitAvailability.js';
import { buildFirstInvoice, normalizeBody } from './quotePricing.js';
import { convertQuoteToContract } from './quoteConversion.js';
import { applyInvoicePayment, syncLinkedPayment } from './invoicePayments.js';
import { candidatesFor, claimFirstAvailable } from '../routes/publicBooking.js';
import { syncUnitStatus } from '../utils/unitStatus.js';
import { retrieveCheckoutSession, stripeConfigured } from './stripe.js';

/**
 * Self-serve unit booking for the customer app.
 *
 * reserve  -> claims one unit of the chosen size and holds it in a Quote
 * (priced by the same normalizeBody the staff screens use);
 * pay      -> Stripe Checkout for the first invoice (see routes/customerBooking.js);
 * finalize -> run by the Stripe webhook once the money is in: converts the quote
 * to a contract + first invoice and records the payment, leaving the contract
 * ready for the customer to sign, which activates it.
 */

// A term is a whole number of weeks, 4 to 32. Older app builds send months
// (1, 3, 6 or 12), read as 4 weeks each since a billing month is 28 days.
export const MIN_TERM_WEEKS = 4;
export const MAX_TERM_WEEKS = 32;
const LEGACY_TERM_MONTHS = [1, 3, 6, 12];
export const HOLD_MINUTES = 15;
// While a customer is on Stripe's page the hold must outlive the session
// (Stripe's minimum session life is 30 minutes).
export const PAYING_HOLD_MINUTES = 40;
export const CARD_FEE_PCT = 3;
export const MAX_START_DAYS_AHEAD = 30;

const DAY = 86_400_000;

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export function parseTerm({ startDate, weeks, months }) {
  const w = weeks !== undefined && weeks !== null && weeks !== ''
    ? Number(weeks)
    : (LEGACY_TERM_MONTHS.includes(Number(months)) ? Number(months) * 4 : NaN);
  if (!Number.isInteger(w) || w < MIN_TERM_WEEKS || w > MAX_TERM_WEEKS) {
    throw fail(400, `Choose a term of ${MIN_TERM_WEEKS} to ${MAX_TERM_WEEKS} weeks`);
  }
  const start = startDate ? new Date(startDate) : new Date();
  if (Number.isNaN(start.getTime())) throw fail(400, 'Choose a valid start date');
  start.setUTCHours(0, 0, 0, 0);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  if (start < today) throw fail(400, 'The start date cannot be in the past');
  if (start.getTime() - today.getTime() > MAX_START_DAYS_AHEAD * DAY) throw fail(400, `The start date must be within ${MAX_START_DAYS_AHEAD} days`);
  return { start, end: new Date(start.getTime() + w * 7 * DAY), weeks: w };
}

const unitLine = (unit, start, end) => ({
  unit: String(unit._id), unitNumber: unit.unitNumber, sizeSqf: unit.sizeSqf, floor: unit.floor || '',
  startDate: start, endDate: end, rate: Number(unit.price) || 0, discountPct: Number(unit.discountPct) || 0,
});

/** The figures a customer is shown and charged: the first invoice, plus the card fee Stripe adds. */
export function pricingFor(quoteLike) {
  const inv = buildFirstInvoice(quoteLike);
  const fee = Math.round(inv.invoiceTotal * CARD_FEE_PCT) / 100;
  return {
    lines: inv.items.map((i) => ({ label: i.itemDetails, amount: i.amount })),
    total: inv.invoiceTotal,
    cardFee: fee,
    totalWithFee: Math.round((inv.invoiceTotal + fee) * 100) / 100,
    dueDate: inv.dueDate,
  };
}

/** Sizes that can be booked for the chosen dates, with what the customer would pay today. */
export async function listSizes({ startDate, weeks, months }) {
  const { start, end } = parseTerm({ startDate, weeks, months });
  const available = await computeUnitAvailability({ from: start, to: end });
  const bySize = new Map();
  for (const u of available.allUnits) {
    if (!(Number(u.sizeSqf) > 0) || !(Number(u.price) > 0)) continue;
    if (available.bookedUnitIds.has(String(u._id)) || u.status !== 'available') continue;
    const row = bySize.get(u.sizeSqf) || { sizeSqf: u.sizeSqf, available: 0, unit: u };
    row.available += 1;
    if (Number(u.price) < Number(row.unit.price)) row.unit = u;
    bySize.set(u.sizeSqf, row);
  }
  return [...bySize.values()].sort((a, b) => a.sizeSqf - b.sizeSqf).map(({ sizeSqf, available: count, unit }) => {
    const body = normalizeBody({ units: [unitLine(unit, start, end)], cardFeeEnabled: true, cardFeePct: CARD_FEE_PCT, vatEnabled: true });
    return {
      sizeSqf, available: count, monthlyRate: Number(unit.price), discountPct: Number(unit.discountPct) || 0,
      payToday: pricingFor(body).total,
    };
  });
}

function profileGaps(customer) {
  const named = customer.fullName && !/^[+\d\s()-]+$/.test(customer.fullName);
  return { name: !named, email: !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email || '') };
}

async function releaseCustomerHolds(customerId) {
  const open = await Quote.find({
    customer: customerId, 'appBooking.active': true, status: 'sent', stripePaidAt: null, expiryDate: { $gt: new Date() },
  });
  for (const q of open) {
    q.expiryDate = new Date();
    q.status = 'expired';
    q.timeline.push({ type: 'updated', text: 'Hold released — customer started a new booking' });
    await q.save();
    await Promise.all(q.units.map((u) => syncUnitStatus(u.unit)));
  }
}

export async function reserve(customerId, { sizeSqf, startDate, weeks, months }) {
  const customer = await Customer.findById(customerId);
  if (!customer) throw fail(404, 'Customer not found');
  const gaps = profileGaps(customer);
  if (gaps.name || gaps.email) throw fail(422, 'Add your name and email to continue', { code: 'profile_incomplete', gaps });

  const { start, end, weeks: w } = parseTerm({ startDate, weeks, months });
  await releaseCustomerHolds(customerId);

  const available = await computeUnitAvailability({ from: start, to: end });
  const unit = await claimFirstAvailable(candidatesFor(available, sizeSqf));
  if (!unit) throw fail(409, 'Sorry, that size was just taken. Please pick another.', { code: 'unavailable' });

  try {
    const body = normalizeBody({
      units: [unitLine(unit, start, end)], cardFeeEnabled: true, cardFeePct: CARD_FEE_PCT, vatEnabled: true,
      customer: String(customer._id), status: 'sent',
      expiryDate: new Date(Date.now() + HOLD_MINUTES * 60_000),
    });
    const quote = await Quote.create({
      ...body,
      quoteNo: await nextQuoteNo(),
      customer: customer._id,
      flowStep: 3,
      notes: `Booked in the customer app — ${w} weeks.`,
      appBooking: { active: true },
      timeline: [{ type: 'created', text: 'Unit held from the customer app, pending payment.' }],
    });
    return { quote, unit };
  } catch (err) {
    // The unit was claimed above; never leave it reserved with nothing behind it.
    await Unit.updateOne({ _id: unit._id }, { $set: { status: 'available' } });
    throw err;
  }
}

/** Where a booking stands, in terms the app can act on. */
export async function bookingState(quote) {
  const base = { bookingId: quote._id, quoteNo: quote.quoteNo, holdExpiresAt: quote.expiryDate };
  if (quote.appBooking?.needsReview) return { ...base, state: 'needs_review', message: quote.appBooking.reviewReason };
  if (quote.contract) {
    const contract = await Contract.findById(quote.contract).select('status contractNo');
    if (contract) {
      return { ...base, state: contract.status === 'active' ? 'active' : 'ready_to_sign', contractId: contract._id, contractNo: contract.contractNo };
    }
  }
  if (quote.stripePaidAt) return { ...base, state: 'confirming' };
  if (quote.status === 'sent' && quote.expiryDate > new Date()) return { ...base, state: 'held' };
  return { ...base, state: 'expired' };
}

const flag = async (quote, reason) => {
  quote.appBooking.needsReview = true;
  quote.appBooking.reviewReason = reason;
  quote.timeline.push({ type: 'updated', text: `NEEDS STAFF: ${reason}` });
  await quote.save();
};

/**
 * Called by the Stripe webhook once an app booking is paid. Idempotent: a repeat
 * delivery finds the contract already made and does nothing.
 */
export async function finalizePaidBooking(paidQuote, { sessionId, amount }) {
  if (!paidQuote.appBooking?.active) return null;
  // The webhook and the app's status check can both arrive here for the same
  // payment, at the same moment. Only the one that wins this claim continues.
  const quote = await Quote.findOneAndUpdate(
    { _id: paidQuote._id, contract: null, 'appBooking.convertedAt': null, 'appBooking.convertingAt': null },
    { $set: { 'appBooking.convertingAt': new Date() } },
    { new: true },
  );
  if (!quote) return null;

  // The unit must still be ours. The hold outlasts the Stripe session, so this
  // only fails if staff changed something by hand.
  for (const line of quote.units) {
    const clash = await Contract.exists({
      $or: [{ unit: line.unit }, { units: line.unit }],
      status: { $in: ['draft', 'pending_signature', 'active'] },
      startDate: { $lt: line.endDate }, endDate: { $gt: line.startDate },
    });
    if (clash) {
      await flag(quote, `Paid AED ${amount} (Stripe ${sessionId}) but unit ${line.unitNumber} is no longer free — contact the customer or refund.`);
      return null;
    }
  }

  try {
    const { contract, invoice } = await convertQuoteToContract(quote, { actor: { name: 'customer app', userId: null }, paymentMethod: 'card' });
    applyInvoicePayment(invoice, { amount, method: 'card', notes: `Paid in the customer app via Stripe Checkout (${sessionId}) incl. ${CARD_FEE_PCT}% card fee paid separately` });
    if (invoice.status === 'draft') invoice.status = invoice.paymentMade >= invoice.total ? 'paid' : 'sent';
    await invoice.save();
    await syncLinkedPayment(invoice);

    contract.timeline.push({ at: new Date(), text: `First invoice ${invoice.invoiceNo} paid online in the app (AED ${amount}). Waiting for the customer to sign.`, author: 'customer app' });
    await contract.save();
    quote.appBooking.convertedAt = new Date();
    await quote.save();
    return { contract, invoice };
  } catch (err) {
    await flag(quote, `Paid AED ${amount} (Stripe ${sessionId}) but the contract could not be created: ${err.message}`);
    return null;
  }
}

/**
 * Ask Stripe whether this booking's checkout was paid, and if so do what the
 * webhook would have done. Covers a webhook that is late, misconfigured, or
 * cannot reach this server at all (a local test). Returns the current quote.
 */
export async function syncBookingPayment(quote) {
  if (!quote.appBooking?.active || quote.stripePaidAt || !quote.stripeCheckoutSessionId || !stripeConfigured()) return quote;
  let session;
  try {
    session = await retrieveCheckoutSession(quote.stripeCheckoutSessionId);
  } catch (err) {
    console.error('[appBooking] could not read Stripe session:', err.message);
    return quote;
  }
  if (session.payment_status !== 'paid' || session.metadata?.storageQuoteId !== String(quote._id)) return quote;

  const amountFils = Number(session.metadata?.amountFils);
  const amount = Number.isFinite(amountFils) ? amountFils / 100 : (session.amount_total ?? 0) / 100;
  const paid = await Quote.findOneAndUpdate(
    { _id: quote._id, stripePaidAt: null },
    {
      $set: { stripePaidAt: new Date(), status: 'accepted' },
      $push: { timeline: { type: 'accepted', text: `Paid online via Stripe Checkout (${session.id}) — confirmed from the app` } },
    },
    { new: true },
  );
  if (paid) await finalizePaidBooking(paid, { sessionId: session.id, amount });
  return Quote.findById(quote._id);
}
