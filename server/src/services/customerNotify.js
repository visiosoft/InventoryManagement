/**
 * Telling customers, in the app, about their own account: a booking moving
 * along, a payment that arrived, one coming due, an agreement nearing its
 * end, an inspection, and the occasional promotion.
 *
 * Every message is an inbox row first and a push second. The row is what the
 * app lists, so a customer with notifications switched off still sees it;
 * the push is only the tap on the shoulder. Sending goes through
 * services/expoPush.js, the same code the staff app's pushes use.
 *
 * The WhatsApp and email reminders (paymentReminders.js, automationEngine.js)
 * are left exactly as they are — this is an extra channel, not a replacement.
 *
 * Nothing here throws. A booking is moved along and a payment is recorded
 * whatever Expo is doing, the same rule expoPush.js keeps for staff.
 */

import { Contract, Customer, Invoice } from '../models/index.js';
import { CustomerNotification } from '../models/customerNotification.js';
import { expoPushConfigured, pushExpoToTokens } from './expoPush.js';
import { SERVICE_CATALOG, dubaiToday, slotById, workerEndTime } from './servicePricing.js';

// ── Wording helpers ─────────────────────────────────────────────────────────
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The Dubai calendar day of a stored Date, or a 'YYYY-MM-DD' left as it is. */
export const dubaiDay = (value) => (typeof value === 'string' ? value : dubaiToday(new Date(value).getTime()));

/** 'Thu 24 Oct' — the way the app writes a day. */
export function dayLabel(value) {
  const d = new Date(`${dubaiDay(value)}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** 'AED 1,305' — no decimals unless there are fils to show. */
export function aed(n) {
  const v = Math.round(Number(n || 0) * 100) / 100;
  const digits = Number.isInteger(v) ? 0 : 2;
  return `AED ${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

const daysBetween = (fromDay, toDay) => Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000);

// ── Sending ─────────────────────────────────────────────────────────────────
const unreadCount = (customerId) => CustomerNotification.countDocuments({ customer: customerId, readAt: null });

/**
 * Write one notification to a customer's inbox and push it to their phones.
 *
 * `key`, when given, makes it once-only for this customer: the unique index
 * turns a second attempt into a duplicate rather than a second push. A
 * promotion to somebody who switched promotions off is not written at all —
 * they said no, so it does not wait for them in the inbox either.
 *
 * Returns `{ created, sent }` (sent = devices Expo accepted) and never throws.
 */
export async function notifyCustomer(customerId, { kind, title, body = '', data = {}, key } = {}) {
  const out = { created: false, sent: 0 };
  try {
    const customer = await Customer.findById(customerId).select('pushTokens notificationPrefs').lean();
    if (!customer) return out;
    if (kind === 'promotion' && customer.notificationPrefs?.promotions === false) return out;

    let note;
    try {
      note = await CustomerNotification.create({ customer: customer._id, kind, title, body, data, ...(key ? { key } : {}) });
    } catch (e) {
      if (e.code === 11000) return out; // already told them
      throw e;
    }
    out.created = true;

    if (!expoPushConfigured() || !customer.pushTokens?.length) return out;
    const result = await pushExpoToTokens(customer.pushTokens, {
      title,
      body,
      data: { notificationId: String(note._id), route: data.route, params: data.params || {}, kind },
      badge: await unreadCount(customer._id),
      channelId: 'default',
    });
    out.sent = result.sent;
    if (result.dead.length) {
      await Customer.updateOne({ _id: customer._id }, { $pull: { pushTokens: { $in: result.dead } } });
    }
  } catch (e) {
    console.error('[CustomerNotify] could not notify', String(customerId), e.message);
  }
  return out;
}

// ── Service requests ────────────────────────────────────────────────────────
// What the customer calls the job, in a title.
const SERVICE_NOUN = {
  supplies: 'Boxes & labels delivery',
  pickup: 'Pickup',
  dropoff: 'Drop-off',
  both: 'Pickup & drop-off',
  worker: 'Worker booking',
  disposal: 'Dump truck booking',
};
// "In progress" means something different for each: a van driving to them,
// or a worker already at their unit.
const ON_THE_WAY = {
  supplies: 'Boxes & labels on their way',
  pickup: 'Pickup van on its way',
  dropoff: 'Drop-off on its way',
  both: 'Pickup & drop-off on its way',
  worker: 'Your worker has started',
  disposal: 'Dump truck on its way',
};
const SERVICE_TITLES = {
  confirmed: (type) => `${SERVICE_NOUN[type]} confirmed`,
  scheduled: (type) => `${SERVICE_NOUN[type]} scheduled`,
  in_progress: (type) => ON_THE_WAY[type],
  completed: (type) => `${SERVICE_NOUN[type]} completed`,
  cancelled: (type) => `${SERVICE_NOUN[type]} cancelled`,
};
export const SERVICE_NOTIFY_STATUSES = Object.keys(SERVICE_TITLES);

/** 'SR-0003 · Thu 24 Oct, 10:00 – 12:00' */
export function serviceWhen(r) {
  const time = r.type === 'worker'
    ? (r.startTime && r.hours ? `${r.startTime} – ${workerEndTime(r.startTime, r.hours)}` : '')
    : slotById(r.slot)?.label || '';
  return `${r.ref} · ${dayLabel(r.date)}${time ? `, ${time}` : ''}`;
}

/** A staff member moved a booking along. 'requested' is the customer's own
 *  doing, so it is never announced back to them. */
export async function notifyServiceStatus(r) {
  if (!SERVICE_NOTIFY_STATUSES.includes(r.status) || !SERVICE_CATALOG.some((s) => s.type === r.type)) return { created: false, sent: 0 };
  const id = String(r._id);
  return notifyCustomer(r.customer?._id || r.customer, {
    kind: 'service',
    title: SERVICE_TITLES[r.status](r.type),
    body: serviceWhen(r),
    data: { route: '/service/[id]', params: { id } },
    key: `service:${id}:${r.status}`,
  });
}

// ── Payments ────────────────────────────────────────────────────────────────
/** A storage invoice was paid online (the Stripe webhook). */
export function notifyInvoicePaid(invoice, amount) {
  return notifyCustomer(invoice.customer?._id || invoice.customer, {
    kind: 'payment',
    title: 'Payment received',
    body: `${aed(amount)} for ${invoice.invoiceNo}. Thank you!`,
    data: { route: '/(tabs)/payments' },
    key: `paid:${invoice._id}`,
  });
}

const OPEN_INVOICE_STATUSES = ['sent', 'partial', 'overdue'];
const balanceOf = (inv) => Math.max(0, Math.round((Number(inv.total || 0) - Number(inv.paymentMade || 0)) * 100) / 100);

/* Which reminder a due date calls for today. Ranges, not exact days, so a
 * sweep that missed a day (a deploy, a restart over the hour) still sends the
 * stage — the key keeps it to once. Overdue stops after a week: the first
 * sweep after this shipped must not push every invoice that went unpaid last
 * year; those are for a person to chase, which WhatsApp and email already do. */
function dueStage(daysLeft) {
  if (daysLeft >= 1 && daysLeft <= 3) return 'soon';
  if (daysLeft === 0) return 'today';
  if (daysLeft <= -1 && daysLeft >= -7) return 'overdue';
  return null;
}

const DUE_TEXT = {
  soon: (inv, amount) => ({ title: `Payment due on ${dayLabel(inv.dueDate)}`, body: `${aed(amount)} for ${inv.invoiceNo}. You can pay in the app in a few taps.` }),
  today: (inv, amount) => ({ title: 'Payment due today', body: `${aed(amount)} for ${inv.invoiceNo} is due today. You can pay in the app in a few taps.` }),
  overdue: (inv, amount) => ({ title: 'Payment overdue', body: `${aed(amount)} for ${inv.invoiceNo} was due on ${dayLabel(inv.dueDate)}. Please pay in the app, or talk to us if something's wrong.` }),
};

async function sweepDueInvoices(now, today) {
  const invoices = await Invoice.find({
    status: { $in: OPEN_INVOICE_STATUSES },
    customer: { $ne: null },
    // Wide enough for any day boundary; the exact stage is worked out below.
    dueDate: { $gte: new Date(now.getTime() - 9 * 86_400_000), $lte: new Date(now.getTime() + 5 * 86_400_000) },
  }).select('invoiceNo customer dueDate total paymentMade').lean();

  let sent = 0;
  for (const inv of invoices) {
    const amount = balanceOf(inv);
    const stage = amount > 0 ? dueStage(daysBetween(today, dubaiDay(inv.dueDate))) : null;
    if (!stage) continue;
    const out = await notifyCustomer(inv.customer, {
      kind: 'payment', ...DUE_TEXT[stage](inv, amount), data: { route: '/(tabs)/payments' }, key: `due:${inv._id}:${stage}`,
    });
    if (out.created) sent += 1;
  }
  return sent;
}

// ── Renewals ────────────────────────────────────────────────────────────────
/* Days before the end at which the customer hears about it. Each milestone
 * owns the week up to it (30 is 23 < daysLeft <= 30), so a once-a-day sweep
 * cannot step over one, and a contract signed with 20 days left is not told
 * "a month to go" a day before it hears "two weeks to go". */
export const RENEWAL_MILESTONES = [30, 14, 7];
const renewalMilestone = (daysLeft) => RENEWAL_MILESTONES.find((m) => daysLeft > m - 7 && daysLeft <= m) ?? null;

async function sweepRenewals(now, today) {
  const contracts = await Contract.find({
    status: 'active',
    archived: { $ne: true },
    endDate: { $gt: now, $lte: new Date(now.getTime() + 31 * 86_400_000) },
  }).select('customer endDate').lean();

  let sent = 0;
  for (const c of contracts) {
    const endDay = dubaiDay(c.endDate);
    const milestone = renewalMilestone(daysBetween(today, endDay));
    if (milestone == null) continue;
    // The end day is in the key because a renewal extends this same contract:
    // next year's reminders must not be swallowed by this year's.
    const out = await notifyCustomer(c.customer, {
      kind: 'renewal',
      title: `Your agreement ends on ${dayLabel(endDay)}`,
      body: "Staying on? Renew in the app to keep your unit. Moving out? You can book your check-out there too.",
      data: { route: '/checkout' },
      key: `renewal:${c._id}:${endDay}:${milestone}`,
    });
    if (out.created) sent += 1;
  }
  return sent;
}

/**
 * The daily sweep: payments coming due and agreements coming to an end.
 * Safe to run any number of times a day — every message is keyed, so each
 * stage and milestone reaches a customer once. `now` is a parameter so tests
 * can stand on any day they like.
 */
export async function runCustomerNotificationSweep({ now = new Date() } = {}) {
  const today = dubaiToday(now.getTime());
  const out = { due: 0, renewal: 0 };
  try { out.due = await sweepDueInvoices(now, today); } catch (e) { console.error('[CustomerNotify] due sweep failed:', e.message); }
  try { out.renewal = await sweepRenewals(now, today); } catch (e) { console.error('[CustomerNotify] renewal sweep failed:', e.message); }
  return out;
}

// ── Promotions ──────────────────────────────────────────────────────────────
/* Who a promotion goes to. 'tenants' is everybody renting right now; 'all' is
 * everybody who has used the app — a push token, or a sign-in. Customers who
 * never opened the app are left alone: this is not a mailing list. */
export async function promotionAudience(audience) {
  if (audience === 'tenants') {
    return Contract.distinct('customer', { status: 'active', archived: { $ne: true } });
  }
  return Customer.distinct('_id', { $or: [{ 'pushTokens.0': { $exists: true } }, { appLoginAt: { $ne: null } }] });
}

// A few at a time: hundreds of customers one after another would keep the
// person who pressed Send waiting, and all at once would hammer Expo.
const BROADCAST_BATCH = 10;

export async function broadcastPromotion({ title, body, audience }) {
  const ids = await promotionAudience(audience);
  const out = { recipients: 0, sent: 0 };
  for (let i = 0; i < ids.length; i += BROADCAST_BATCH) {
    const results = await Promise.all(ids.slice(i, i + BROADCAST_BATCH).map((id) => notifyCustomer(id, {
      kind: 'promotion', title, body, data: { route: '/(tabs)' },
    })));
    for (const r of results) { if (r.created) out.recipients += 1; out.sent += r.sent; }
  }
  return out;
}

