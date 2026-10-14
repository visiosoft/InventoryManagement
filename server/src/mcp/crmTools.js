import { Lead, WhatsAppMessage, Invoice, Payment, Quote, Contract, User } from '../models/index.js';

/**
 * What Claude may read from the CRM: sales discipline (how fast people answer,
 * who is waiting), who the team should chase, and the money side (quotes,
 * invoices, payments). Everything here only reads.
 */

const HOUR = 36e5;
const DAY = 864e5;
const CLOSED = ['won', 'lost', 'already_customer'];
const iso = (d) => (d ? new Date(d).toISOString() : null);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const money = (n) => (n == null ? null : Number(Number(n).toFixed(2)));
const mins = (ms) => Math.round(ms / 60000);
const cap = (n, d = 50, max = 200) => Math.min(max, Math.max(1, Number(n) || d));
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const humanMins = (m) => (m == null ? null : m < 90 ? `${m} min` : m < 2880 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} days`);

/** The last message of each conversation, by phone. */
async function chatState(phones) {
  const keys = [...new Set(phones.filter(Boolean))];
  const out = new Map();
  if (!keys.length) return out;
  const rows = await WhatsAppMessage.aggregate([
    { $match: { phoneNormalized: { $in: keys }, deletedAt: null, type: { $nin: ['reaction', 'status'] } } },
    { $sort: { occurredAt: -1 } },
    { $group: {
      _id: '$phoneNormalized',
      last: { $first: { direction: '$direction', at: '$occurredAt', text: '$text', ai: '$sentByAi' } },
      lastInbound: { $max: { $cond: [{ $eq: ['$direction', 'inbound'] }, '$occurredAt', null] } },
      lastOutbound: { $max: { $cond: [{ $eq: ['$direction', 'outbound'] }, '$occurredAt', null] } },
    } },
  ]);
  for (const r of rows) out.set(r._id, r);
  return out;
}

const ownerNames = async (ids) => new Map((await User.find({ _id: { $in: ids.filter(Boolean) } }).select('name').lean()).map((u) => [String(u._id), u.name]));

/* ── sales discipline ─────────────────────────────────────────────────────── */

export async function responseTimeReport({ days = 30 } = {}) {
  const since = new Date(Date.now() - Math.min(365, Math.max(1, days)) * DAY);
  const leads = await Lead.find({ deletedAt: null, owner: { $ne: null }, $or: [{ assignedAt: { $gte: since } }, { leadDateTime: { $gte: since } }] })
    .select('owner assignedAt leadDateTime firstResponseAt status fullName phone').lean();
  const names = await ownerNames([...new Set(leads.map((l) => String(l.owner)))]);
  const per = new Map();
  const all = [];
  let never = 0;
  for (const l of leads) {
    const key = String(l.owner);
    const row = per.get(key) || { rep: names.get(key) || 'Unknown', leads: 0, answered: [], neverAnswered: 0 };
    row.leads += 1;
    const start = new Date(l.assignedAt || l.leadDateTime).getTime();
    if (l.firstResponseAt) {
      const wait = Math.max(0, new Date(l.firstResponseAt).getTime() - start);
      row.answered.push(wait); all.push(wait);
    } else if (!CLOSED.includes(l.status)) { row.neverAnswered += 1; never += 1; }
    per.set(key, row);
  }
  const summarise = (a) => ({ answered: a.length, averageMinutes: a.length ? mins(a.reduce((x, y) => x + y, 0) / a.length) : null, medianMinutes: a.length ? mins(median(a)) : null, within5MinPct: a.length ? Math.round((a.filter((x) => x <= 5 * 60000).length / a.length) * 100) : null, within1HourPct: a.length ? Math.round((a.filter((x) => x <= HOUR).length / a.length) * 100) : null, over24HoursPct: a.length ? Math.round((a.filter((x) => x > 24 * HOUR).length / a.length) * 100) : null });
  const avg = summarise(all);
  return {
    periodDays: days,
    note: 'Response time = from the lead being assigned (or arriving) to the first thing a rep did about it: a logged attempt or a stage change. Opening a lead does not count.',
    team: { ...avg, averageReadable: humanMins(avg.averageMinutes), medianReadable: humanMins(avg.medianMinutes), leadsNeverAnswered: never, leadsConsidered: leads.length },
    perRep: [...per.values()].map((r) => { const s = summarise(r.answered); return { rep: r.rep, leads: r.leads, ...s, averageReadable: humanMins(s.averageMinutes), neverAnswered: r.neverAnswered }; }).sort((a, b) => (b.neverAnswered - a.neverAnswered) || ((b.averageMinutes ?? 0) - (a.averageMinutes ?? 0))),
  };
}

export async function slowFirstReplies({ days = 30, overMinutes = 60, limit = 50 } = {}) {
  const since = new Date(Date.now() - days * DAY);
  const leads = await Lead.find({ deletedAt: null, owner: { $ne: null }, assignedAt: { $gte: since } })
    .populate('owner', 'name').select('owner assignedAt leadDateTime firstResponseAt status fullName phone').lean();
  const now = Date.now();
  const rows = [];
  for (const l of leads) {
    const start = new Date(l.assignedAt || l.leadDateTime).getTime();
    const end = l.firstResponseAt ? new Date(l.firstResponseAt).getTime() : (CLOSED.includes(l.status) ? null : now);
    if (end == null) continue;
    const wait = end - start;
    if (wait >= overMinutes * 60000) rows.push({ name: l.fullName, phone: l.phone, rep: l.owner?.name || null, status: l.status, assignedAt: iso(l.assignedAt || l.leadDateTime), waitedMinutes: mins(wait), waited: humanMins(mins(wait)), stillUnanswered: !l.firstResponseAt });
  }
  rows.sort((a, b) => b.waitedMinutes - a.waitedMinutes);
  return { overMinutes, total: rows.length, rows: rows.slice(0, cap(limit)) };
}

export async function customersWaitingForReply({ minHours = 2, maxDays = 14, limit = 60 } = {}) {
  const now = Date.now();
  const rows = await WhatsAppMessage.aggregate([
    { $match: { occurredAt: { $gte: new Date(now - maxDays * DAY) }, deletedAt: null, type: { $nin: ['reaction', 'status'] } } },
    { $sort: { occurredAt: -1 } },
    { $group: { _id: '$phoneNormalized', last: { $first: { direction: '$direction', at: '$occurredAt', text: '$text' } } } },
    { $match: { 'last.direction': 'inbound', 'last.at': { $lt: new Date(now - minHours * HOUR) } } },
    { $sort: { 'last.at': 1 } },
    { $limit: 400 },
  ]);
  const leads = await Lead.find({ phoneNormalized: { $in: rows.map((r) => r._id) }, deletedAt: null }).populate('owner', 'name').select('fullName phone status owner phoneNormalized').lean();
  const byPhone = new Map(leads.map((l) => [l.phoneNormalized, l]));
  const out = [];
  for (const r of rows) {
    const l = byPhone.get(r._id);
    if (l && CLOSED.includes(l.status)) continue;
    const waited = mins(now - new Date(r.last.at).getTime());
    out.push({ name: l?.fullName || null, phone: r._id, rep: l?.owner?.name || null, status: l?.status || 'no lead record', lastMessageAt: iso(r.last.at), waitingMinutes: waited, waiting: humanMins(waited), lastMessage: String(r.last.text || '').slice(0, 160) });
  }
  return { minHours, total: out.length, rows: out.slice(0, cap(limit, 60)) };
}

/* ── who to chase ─────────────────────────────────────────────────────────── */

export const FOLLOW_UP_LISTS = {
  visit_confirmed: 'Agreed to visit: a visit date is booked, today or later',
  visit_invited_unconfirmed: 'Invited to visit but no date confirmed',
  visit_past_no_outcome: 'Visit date has passed and the lead was never moved on — find out what happened',
  quoted_no_decision: 'Quotation sent more than 3 days ago, no decision',
  overdue_followups: 'A follow-up was due and not done',
  hot_or_warm_gone_quiet: 'Hot or warm leads with no contact for 5+ days and no follow-up booked',
  no_next_step: 'Open leads with no follow-up date and no visit booked',
  customers_waiting: 'Customer wrote last and nobody replied for 2+ hours',
};

export async function followUpList({ list, limit = 100 } = {}) {
  const now = new Date();
  const open = { deletedAt: null, status: { $nin: CLOSED } };
  const sel = 'fullName phone phoneNormalized status owner followUpAt siteVisitAt temperature updatedAt leadDateTime';
  let leads = [];
  let reason = () => '';
  if (list === 'customers_waiting') {
    const w = await customersWaitingForReply({ minHours: 2, limit });
    return { list, meaning: FOLLOW_UP_LISTS[list], total: w.total, rows: w.rows.map((r) => ({ name: r.name, phone: r.phone, rep: r.rep, status: r.status, why: `Waiting ${r.waiting} — "${r.lastMessage}"` })) };
  }
  if (list === 'visit_confirmed') { leads = await Lead.find({ ...open, siteVisitAt: { $gte: new Date(now.getTime() - DAY) } }).sort({ siteVisitAt: 1 }).limit(300).select(sel).populate('owner', 'name').lean(); reason = (l) => `Visit booked for ${day(l.siteVisitAt)}`; }
  else if (list === 'visit_invited_unconfirmed') { leads = await Lead.find({ ...open, status: 'site_visit_scheduled', siteVisitAt: null }).sort({ updatedAt: -1 }).limit(300).select(sel).populate('owner', 'name').lean(); reason = () => 'Marked site-visit stage but no visit date set'; }
  else if (list === 'visit_past_no_outcome') { leads = await Lead.find({ ...open, siteVisitAt: { $lt: new Date(now.getTime() - DAY) }, status: { $in: ['site_visit_scheduled', 'contacted', 'follow_up_scheduled'] } }).sort({ siteVisitAt: -1 }).limit(300).select(sel).populate('owner', 'name').lean(); reason = (l) => `Visit was ${day(l.siteVisitAt)}, still ${l.status}`; }
  else if (list === 'quoted_no_decision') { leads = await Lead.find({ ...open, status: 'quotation_sent', updatedAt: { $lt: new Date(now.getTime() - 3 * DAY) } }).sort({ updatedAt: 1 }).limit(300).select(sel).populate('owner', 'name').lean(); reason = (l) => `Quote sent, untouched since ${day(l.updatedAt)}`; }
  else if (list === 'overdue_followups') { leads = await Lead.find({ ...open, followUpAt: { $ne: null, $lt: now } }).sort({ followUpAt: 1 }).limit(300).select(sel).populate('owner', 'name').lean(); reason = (l) => `Follow-up was due ${day(l.followUpAt)}`; }
  else if (list === 'hot_or_warm_gone_quiet') { leads = await Lead.find({ ...open, temperature: { $in: ['hot', 'warm'] }, followUpAt: null, updatedAt: { $lt: new Date(now.getTime() - 5 * DAY) } }).sort({ updatedAt: 1 }).limit(300).select(sel).populate('owner', 'name').lean(); reason = (l) => `${l.temperature} lead, last touched ${day(l.updatedAt)}`; }
  else if (list === 'no_next_step') { leads = await Lead.find({ ...open, owner: { $ne: null }, followUpAt: null, siteVisitAt: null }).sort({ leadDateTime: -1 }).limit(300).select(sel).populate('owner', 'name').lean(); reason = (l) => `No next step; came in ${day(l.leadDateTime)}`; }
  else return { error: `Unknown list. Choose one of: ${Object.keys(FOLLOW_UP_LISTS).join(', ')}` };
  return { list, meaning: FOLLOW_UP_LISTS[list], total: leads.length, rows: leads.slice(0, cap(limit, 100)).map((l) => ({ name: l.fullName, phone: l.phone, rep: l.owner?.name || null, status: l.status, why: reason(l) })) };
}

/* ── money ────────────────────────────────────────────────────────────────── */

const rx = (q) => new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

export async function listInvoices({ status, customer, overdueOnly = false, from, to, limit = 50 } = {}) {
  const f = { deletedAt: null };
  if (status) f.status = status;
  if (overdueOnly) { f.status = { $in: ['sent', 'partial', 'overdue'] }; f.dueDate = { $lt: new Date() }; }
  if (from || to) f.invoiceDate = { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59Z`) } : {}) };
  let ids = null;
  if (customer) { const { Customer } = await import('../models/index.js'); ids = (await Customer.find({ fullName: rx(customer) }).select('_id').limit(50).lean()).map((c) => c._id); f.customer = { $in: ids }; }
  const rows = await Invoice.find(f).populate('customer', 'fullName phone email').sort({ invoiceDate: -1 }).limit(cap(limit)).lean();
  return { total: rows.length, rows: rows.map((i) => ({ invoiceNo: i.invoiceNo, customer: i.customer?.fullName, phone: i.customer?.phone, contractNo: i.orderNumber, date: day(i.invoiceDate), due: day(i.dueDate), total: money(i.total), paid: money(i.paymentMade), balance: money((i.total || 0) - (i.paymentMade || 0)), status: i.status })) };
}

export async function pendingPayments({ overdueOnly = false, limit = 100 } = {}) {
  const f = { deletedAt: null, status: { $in: ['pending', 'overdue'] } };
  if (overdueOnly) f.dueDate = { $lt: new Date() };
  const rows = await Payment.find(f).populate({ path: 'contract', select: 'contractNo customer unit', populate: [{ path: 'customer', select: 'fullName phone' }, { path: 'unit', select: 'unitNumber' }] }).sort({ dueDate: 1 }).limit(cap(limit, 100)).lean();
  const total = rows.reduce((s, p) => s + (p.amount || 0), 0);
  return { count: rows.length, totalAed: money(total), rows: rows.map((p) => ({ paymentId: String(p._id), customer: p.contract?.customer?.fullName, phone: p.contract?.customer?.phone, contractNo: p.contract?.contractNo, unit: p.contract?.unit?.unitNumber, amount: money(p.amount), due: day(p.dueDate), daysOverdue: p.dueDate < new Date() ? Math.floor((Date.now() - new Date(p.dueDate)) / DAY) : 0 })) };
}

export async function paymentsReceived({ from, to, limit = 100 } = {}) {
  const f = { deletedAt: null, status: 'paid' };
  const start = from ? new Date(from) : new Date(Date.now() - 30 * DAY);
  const end = to ? new Date(`${to}T23:59:59Z`) : new Date();
  f.paidDate = { $gte: start, $lte: end };
  const rows = await Payment.find(f).populate({ path: 'contract', select: 'contractNo customer', populate: { path: 'customer', select: 'fullName' } }).sort({ paidDate: -1 }).limit(cap(limit, 100)).lean();
  return { from: day(start), to: day(end), count: rows.length, totalAed: money(rows.reduce((s, p) => s + (p.amount || 0), 0)), rows: rows.map((p) => ({ customer: p.contract?.customer?.fullName, contractNo: p.contract?.contractNo, amount: money(p.amount), paidOn: day(p.paidDate), method: p.method })) };
}

export async function listQuotes({ status, customer, limit = 50 } = {}) {
  const f = { deletedAt: null };
  if (status) f.status = status;
  if (customer) { const { Customer } = await import('../models/index.js'); f.customer = { $in: (await Customer.find({ fullName: rx(customer) }).select('_id').limit(50).lean()).map((c) => c._id) }; }
  const rows = await Quote.find(f).populate('customer', 'fullName phone').sort({ createdAt: -1 }).limit(cap(limit)).lean();
  return { total: rows.length, rows: rows.map((q) => ({ quoteNo: q.quoteNo, customer: q.customer?.fullName, phone: q.customer?.phone, status: q.status, total: money(q.total), expires: day(q.expiryDate), created: day(q.createdAt), converted: Boolean(q.contract) })) };
}

export async function contractDetail({ contractNo }) {
  const c = await Contract.findOne({ contractNo: rx(`^${String(contractNo).trim()}$`) }).populate('customer', 'fullName phone email').populate('unit', 'unitNumber sizeSqf').lean();
  if (!c) return { error: 'No contract with that number' };
  const [invoices, payments] = await Promise.all([
    Invoice.find({ orderNumber: c.contractNo, deletedAt: null }).sort({ invoiceDate: 1 }).select('invoiceNo invoiceDate dueDate total paymentMade status').lean(),
    Payment.find({ contract: c._id, deletedAt: null }).sort({ dueDate: 1 }).select('amount dueDate paidDate status method').lean(),
  ]);
  return { contractNo: c.contractNo, status: c.status, customer: c.customer, unit: c.unit?.unitNumber, checkIn: day(c.startDate), checkOut: day(c.endDate), rate: money(c.rate), leased: money(c.leasedPrice), deposit: money(c.deposit), renewalIntent: c.renewalIntent, needsResign: Boolean(c.resignNeeded),
    paymentVerified: c.paymentGate?.since ? Boolean(c.paymentGate.verified) : null,
    invoices: invoices.map((i) => ({ invoiceNo: i.invoiceNo, date: day(i.invoiceDate), due: day(i.dueDate), total: money(i.total), paid: money(i.paymentMade), status: i.status })),
    payments: payments.map((p) => ({ amount: money(p.amount), due: day(p.dueDate), paidOn: day(p.paidDate), status: p.status, method: p.method })) };
}
