import { Contract } from '../models/index.js';
import { ServiceRequest } from '../models/serviceRequest.js';
import { SERVICE_CATALOG, slotById, workerEndTime } from './servicePricing.js';
import { notifyDeliveryPaid } from './customerNotify.js';

/**
 * Paying for a delivery when it is booked. The request is created in
 * 'awaiting_payment' with half an hour to pay; Stripe's webhook (never the
 * app) moves it to 'requested'. A booking left unpaid lapses on its own: there
 * is no sweep — anything that reads it treats it as cancelled once
 * `payment.expiresAt` has passed, and the customer's own reads write that down.
 */
export const PAY_WINDOW_MINUTES = 30;
// A Checkout session lives 30 minutes; the booking outlives it by ten, so a
// customer mid-payment never has the booking lapse under them.
export const PAYING_WINDOW_MINUTES = 40;

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Unpaid, and out of time to pay. */
export const paymentExpired = (r, now = new Date()) =>
  r?.status === 'awaiting_payment' && !!r.payment?.expiresAt && new Date(r.payment.expiresAt).getTime() < now.getTime();

/** A query fragment that leaves out lapsed unpaid bookings — for slot counts
 *  and "is this item already on a delivery", where they must not hold anything. */
export const notExpired = (now = new Date()) => ({
  $or: [{ status: { $ne: 'awaiting_payment' } }, { 'payment.expiresAt': { $gte: now } }],
});

/**
 * Writes down that these unpaid bookings lapsed, and updates the objects in
 * hand to match (lean or documents). Conditional, so a payment that landed a
 * moment ago is never overwritten.
 */
export async function expireStale(requests, now = new Date()) {
  for (const r of requests) {
    if (!paymentExpired(r, now)) continue;
    const entry = { status: 'cancelled', at: now };
    const { modifiedCount } = await ServiceRequest.updateOne(
      { _id: r._id, status: 'awaiting_payment', 'payment.state': 'pending' },
      { $set: { status: 'cancelled', 'payment.state': 'expired' }, $push: { statusLog: entry } },
    );
    if (!modifiedCount) continue;
    r.status = 'cancelled';
    r.payment.state = 'expired';
    r.statusLog.push(entry);
  }
  return requests;
}

/** What the customer sees of the payment. Null for jobs not paid in the app. */
export function paymentView(p) {
  if (!p?.required) return null;
  const iso = (d) => (d ? new Date(d).toISOString() : null);
  return {
    state: p.state,
    amount: round2(p.amount),
    cardFee: round2(p.cardFee),
    totalCharged: round2(Number(p.amount || 0) + Number(p.cardFee || 0)),
    expiresAt: iso(p.expiresAt),
    paidAt: iso(p.paidAt),
  };
}

/** 'drop-off SR-0004 on 2026-11-02, 08:00 – 10:00 (est. AED 310)' — for the contract timeline. */
export function describeRequest(r) {
  const title = SERVICE_CATALOG.find((s) => s.type === r.type).title.toLowerCase();
  const when = r.type === 'worker'
    ? `${r.startTime}–${workerEndTime(r.startTime, r.hours)}, ${r.workers || 1} worker${(r.workers || 1) > 1 ? 's' : ''}`
    : slotById(r.slot).label;
  return `${title} ${r.ref} on ${r.date}, ${when} (est. AED ${r.estimate.total})`;
}

/**
 * Stripe says a delivery was paid (Checkout or the payment sheet). Idempotent:
 * a repeated webhook finds nothing pending and does nothing. Money that
 * arrives after the booking lapsed is still taken and the booking reinstated —
 * refusing it would only mean a refund and an unhappy customer; staff are told
 * to check the van still has room.
 */
export async function settleServiceRequestPayment({ serviceRequestId, sessionId = null, paymentIntentId = null }) {
  if (!/^[a-f\d]{24}$/i.test(String(serviceRequestId || ''))) return { settled: false };
  const now = new Date();
  const set = { 'payment.state': 'paid', 'payment.paidAt': now };
  if (sessionId) set['payment.stripeCheckoutSessionId'] = sessionId;
  if (paymentIntentId) set['payment.stripePaymentIntentId'] = paymentIntentId;
  const r = await ServiceRequest.findOneAndUpdate(
    { _id: serviceRequestId, 'payment.required': true, 'payment.state': { $in: ['pending', 'expired'] } },
    { $set: set },
    { new: true },
  );
  if (!r) return { settled: false };

  const late = r.status === 'cancelled';
  if (['awaiting_payment', 'cancelled'].includes(r.status)) {
    r.status = 'requested';
    r.statusLog.push({ status: 'requested', at: now });
  }
  if (late) {
    r.staffNote = [r.staffNote, `Paid after the booking had lapsed (${now.toISOString()}) — check the slot still has room.`].filter(Boolean).join('\n');
    console.warn('[ServicePayments] late payment accepted for', r.ref);
  }
  await r.save();
  // Only now is it a real request — the contract hears of it once, paid.
  if (r.contract) {
    await Contract.updateOne({ _id: r.contract }, { $push: { timeline: { text: `Tenant requested via app (paid by card): ${describeRequest(r)}`, author: 'customer app' } } })
      .catch((e) => console.error('[ServicePayments] timeline:', e.message));
  }
  await notifyDeliveryPaid(r);
  // Paid, so now it is a job: into the warehouse's Client Requests inbox.
  // Imported here, not at the top — that module imports this one.
  await import('./clientRequests.js').then((m) => m.syncFromSource('ServiceRequest', r._id))
    .catch((e) => console.error('[ServicePayments] client request:', e.message));
  return { settled: true, late };
}
