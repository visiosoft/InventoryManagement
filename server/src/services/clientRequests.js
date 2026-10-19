import { Contract, ContractRenewal, Customer, CustomerRequest, Document, Invoice, Lead, Quote, Unit, User } from '../models/index.js';
import { ServiceRequest } from '../models/serviceRequest.js';
import {
  ClientRequest, CLIENT_REQUEST_TEAMS, CLIENT_REQUEST_TYPES, CLOSED_STATUSES, OPEN_STATUSES, nextClientRequestNo,
} from '../models/clientRequest.js';
import { StoredContainer } from '../models/warehouse.js';
import { pushConfigured, pushToUser } from './push.js';
import { pushExpoToUser } from './expoPush.js';
import { aed, notifyCustomer } from './customerNotify.js';
import { SERVICE_CATALOG, slotById, workerEndTime } from './servicePricing.js';
import { describeRequest, paymentView } from './servicePayments.js';
import { priceRenewal, renewalMonthlyRate, validateNewEndDate } from './renewalPricing.js';
import { refreshAgreementDates } from './agreementText.js';
import { notifyResignNeeded } from './contractResign.js';
import { ID_TYPES } from './identityDocs.js';
import { syncUnitStatus } from '../utils/unitStatus.js';

/**
 * The staff side of everything a customer does in the app that needs a person:
 * who owns it, how long they have, and what was decided. See
 * models/clientRequest.js for why this sits on top of the records it points at.
 *
 * Two kinds of caller:
 *  - customer routes and webhooks, through the `on…` hooks. These NEVER throw:
 *    a booking or an upload must succeed whether or not the inbox row could be
 *    written, so each hook catches and logs (console.error) by itself.
 *  - the staff routes (routes/clientRequests.js), which do want errors, with a
 *    status, to answer with.
 */

export const TEAM_OF = {
  service: 'warehouse',
  extend: 'sales',
  moveout: 'sales',
  id_check: 'sales',
  booking_review: 'sales',
  new_signup: 'sales',
  deposit_refund: 'accounts',
};

// Plain clock hours, not working hours: a request at 23:00 is due at 01:00.
// The escalation is a nudge to a lead, not a penalty, so the simple clock is
// good enough until somebody asks for office hours.
export const SLA_HOURS = { service: 2, extend: 2, moveout: 2, deposit_refund: 2, booking_review: 2, id_check: 4, new_signup: 24 };

// Same VAT the renewal page charges (routes/contractsPublic.js).
const VAT_PCT = 5;
// The app offers 6 or 12 months; the online renewal page stops at 28 weeks
// because longer is "a conversation" — this is that conversation, approved.
const MAX_APPROVED_WEEKS = 60;

const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };
const idOf = (v) => (v?._id ?? v ?? null);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const nameOf = (u) => u?.name || u?.email || 'Staff';
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Log and swallow: what every customer-facing hook is wrapped in. */
async function safely(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[ClientRequests] ${label}:`, e.message);
    return null;
  }
}

// ── Teams ───────────────────────────────────────────────────────────────────
const isAdmin = (user) => ['admin', 'accounts_admin'].includes(user?.role);

/** Which team inboxes a person works. Admins (and accounts admins) see them all. */
export function teamsOf(user) {
  if (!user || user.isActive === false) return [];
  if (isAdmin(user)) return [...CLIENT_REQUEST_TEAMS];
  const perms = new Set(user.permissions || []);
  const teams = [];
  if (perms.has('warehouse') || perms.has('warehouse_supervisor')) teams.push('warehouse');
  if (user.role === 'sales_rep' || ['leads', 'sales_board', 'contracts'].some((p) => perms.has(p))) teams.push('sales');
  if (user.role === 'accounts' || perms.has('payments') || perms.has('invoices')) teams.push('accounts');
  return teams;
}

export const canSee = (user, r) => teamsOf(user).includes(r.team);

/** Mongo filter for what this person may see. */
export function visibleFilter(user) {
  return isAdmin(user) ? {} : { team: { $in: teamsOf(user) } };
}

export async function teamMembers(team) {
  const users = await User.find({ isActive: { $ne: false } }).select('name email role permissions isActive').sort({ name: 1 }).lean();
  return users.filter((u) => teamsOf(u).includes(team));
}

/** Who hears about an overdue request besides its assignee. */
async function teamLeads(team) {
  const users = await User.find({ isActive: { $ne: false } }).select('role permissions').lean();
  return users.filter((u) => u.role === 'admin'
    || (team === 'warehouse' && u.permissions?.includes('warehouse_supervisor'))
    || (team === 'accounts' && u.role === 'accounts_admin'));
}

/** Browser and phone, never throwing — a push is a tap on the shoulder, not the record. */
function pushStaff(userIds, { title, body, requestId }) {
  const url = `/client-requests/${requestId}`;
  for (const id of new Set(userIds.filter(Boolean).map(String))) {
    if (pushConfigured()) pushToUser(id, { title, body, url, tag: `client-request-${requestId}` }).catch(() => null);
    pushExpoToUser(id, { title, body, data: { type: 'client_request', id: String(requestId), url } }).catch(() => null);
  }
}

// ── Opening ─────────────────────────────────────────────────────────────────
/**
 * Open the inbox row for something a customer did. Idempotent on
 * (source, type): a second call returns the row already there — closed or not,
 * a decided request is never reopened by its source firing again.
 *
 * Sales requests go straight to the contract's sales rep when they are still
 * here; everything else waits in its team pool.
 */
export async function openClientRequest({ type, customer, contract = null, source, title = '', summary = '', priority = 'normal', documents = [], byName = 'Customer app' }) {
  if (!CLIENT_REQUEST_TYPES.includes(type)) fail(`Unknown client request type ${type}`);
  const team = TEAM_OF[type];
  const key = { 'source.kind': source.kind, 'source.id': idOf(source.id), type };
  const existing = await ClientRequest.findOne(key);
  if (existing) return { request: existing, created: false };

  let assignee = null;
  if (team === 'sales' && contract) {
    const c = contract.salesRep !== undefined ? contract : await Contract.findById(idOf(contract)).select('salesRep').lean();
    if (c?.salesRep) {
      const rep = await User.findById(idOf(c.salesRep)).select('name email isActive').lean();
      if (rep && rep.isActive !== false) assignee = rep;
    }
  }

  const now = new Date();
  const activity = [{ at: now, byName, kind: 'created', text: summary || title }];
  if (assignee) activity.push({ at: now, byName: 'System', kind: 'assigned', text: `Assigned to ${nameOf(assignee)} — the contract's sales rep` });

  let request;
  try {
    request = await ClientRequest.create({
      ref: await nextClientRequestNo(),
      type, team, priority,
      customer: idOf(customer),
      contract: idOf(contract),
      source: { kind: source.kind, id: idOf(source.id) },
      documents: documents.map(idOf),
      title, summary,
      assignee: assignee?._id || null,
      dueAt: new Date(now.getTime() + SLA_HOURS[type] * 3_600_000),
      activity,
    });
  } catch (e) {
    // Two hooks raced for the same source: the other one won, use its row.
    if (e.code === 11000 && e.keyPattern?.['source.kind']) return { request: await ClientRequest.findOne(key), created: false };
    throw e;
  }
  if (assignee) pushStaff([assignee._id], { title: `New client request ${request.ref}`, body: title, requestId: request._id });
  return { request, created: true };
}

// ── Service requests ────────────────────────────────────────────────────────
const SERVICE_TITLE = Object.fromEntries(SERVICE_CATALOG.map((s) => [s.type, s.title]));
// Statuses a valet job can be in without being a job for the warehouse yet
// (unpaid) or any more (over). Nothing is opened for those.
const NOT_A_JOB = ['awaiting_payment', 'cancelled', 'completed'];

function serviceSummary(sr) {
  try { return describeRequest(sr); } catch { return `${sr.type} ${sr.ref} on ${sr.date}`; }
}

async function openForServiceRequest(sr) {
  return openClientRequest({
    type: 'service',
    customer: sr.customer,
    contract: sr.contract,
    source: { kind: 'ServiceRequest', id: sr._id },
    title: `${SERVICE_TITLE[sr.type] || sr.type} · ${sr.ref}`,
    summary: serviceSummary(sr),
  });
}

/** A valet job was booked (not a paid delivery — that waits for its payment). */
export function onServiceRequestCreated(sr) {
  return safely(`service request ${sr?.ref}`, async () => {
    if (NOT_A_JOB.includes(sr.status)) return null;
    return (await openForServiceRequest(sr)).request;
  });
}

const SERVICE_TO_CASE = {
  requested: 'new', confirmed: 'in_progress', scheduled: 'in_progress', in_progress: 'in_progress', completed: 'resolved', cancelled: 'cancelled',
};

/**
 * Bring a request in line with what happened to its source. Only valet jobs
 * move by themselves — staff change them on the service request page, the
 * customer cancels, a payment lands — so only those are synced.
 *
 * Opens the row if there is none yet: that is how a paid delivery arrives.
 */
export function syncFromSource(kind, id) {
  return safely(`sync ${kind} ${id}`, async () => {
    if (kind !== 'ServiceRequest') return null;
    const sr = await ServiceRequest.findById(id).lean();
    if (!sr) return null;
    let r = await ClientRequest.findOne({ 'source.kind': 'ServiceRequest', 'source.id': sr._id, type: 'service' });
    if (!r) {
      if (NOT_A_JOB.includes(sr.status)) return null;
      r = (await openForServiceRequest(sr)).request;
    }
    const target = SERVICE_TO_CASE[sr.status];
    if (!target || r.status === target) return r;
    // A request already decided here stays decided; the job page is the place
    // to argue with it. 'requested' never pulls a case someone is working back to new.
    if (CLOSED_STATUSES.includes(r.status)) return r;
    if (target === 'new' && r.status !== 'new') return r;

    const now = new Date();
    r.status = target;
    r.activity.push({ at: now, byName: 'System', kind: 'synced', text: `${sr.ref} is now ${sr.status.replace('_', ' ')}` });
    if (CLOSED_STATUSES.includes(target)) {
      r.resolution = { at: now, by: null, byName: 'System', outcome: sr.status, reason: `Service request ${sr.status}` };
    }
    await r.save();
    return r;
  });
}

// ── Other customer actions ──────────────────────────────────────────────────
/** A check-out change or deposit refund asked for in the app (CustomerRequest). */
export function onCustomerRequest(cr, contract = null) {
  return safely(`customer request ${cr?._id}`, async () => {
    const c = contract || await Contract.findById(cr.contract).select('contractNo salesRep deposit endDate').lean();
    const no = c?.contractNo || 'contract';
    const p = cr.payload || {};
    let type; let title; let summary;
    if (cr.type === 'refund') {
      type = 'deposit_refund';
      title = `Deposit refund · ${no}`;
      summary = `Deposit refund of ${aed(p.deposit)} requested${p.note ? ` — "${p.note}"` : ''}`;
    } else if (p.action === 'extend') {
      type = 'extend';
      title = `Extend ${no} by ${p.months} months`;
      summary = `Extend by ${p.months} months, to ${fmtDate(p.requestedEndDate)}`;
    } else if (p.action === 'move_out_early') {
      type = 'moveout';
      title = `Early move-out · ${no}`;
      summary = `Move out early on ${fmtDate(p.requestedEndDate)} (agreement runs to ${fmtDate(c?.endDate)})`;
    } else {
      return null;
    }
    return (await openClientRequest({ type, customer: cr.customer, contract: c || cr.contract, source: { kind: 'CustomerRequest', id: cr._id }, title, summary })).request;
  });
}

const liveContractOf = (customerId) => Contract.findOne({ customer: customerId, status: { $in: ['active', 'pending_signature', 'draft'] } })
  .sort({ startDate: -1 }).select('contractNo salesRep').lean();

/**
 * An ID uploaded from the app. A front and a back are two uploads; while a
 * check is open the next upload joins it rather than opening a second one.
 */
export function onIdentityUpload(doc) {
  return safely(`identity upload ${doc?._id}`, async () => {
    if (doc.verification?.state == null) {
      await Document.updateOne({ _id: doc._id, 'verification.state': { $in: [null] } }, { $set: { 'verification.state': 'pending' } });
    }
    const open = await ClientRequest.findOne({ type: 'id_check', customer: doc.customer, status: { $in: OPEN_STATUSES } });
    if (open) {
      if (!open.documents.some((d) => String(d) === String(doc._id))) {
        open.documents.push(doc._id);
        open.activity.push({ at: new Date(), byName: 'Customer app', kind: 'synced', text: `Uploaded ${doc.name}` });
        await open.save();
      }
      return open;
    }
    const contract = await liveContractOf(doc.customer);
    const customer = await Customer.findById(doc.customer).select('fullName').lean();
    return (await openClientRequest({
      type: 'id_check', customer: doc.customer, contract,
      source: { kind: 'Document', id: doc._id }, documents: [doc._id],
      title: `Check ID · ${customer?.fullName || 'customer'}`,
      summary: `Uploaded ${doc.name} in the app`,
    })).request;
  });
}

/** A paid app booking that could not become a contract (services/appBooking.js). */
export function onBookingNeedsReview(quote, reason) {
  return safely(`booking review ${quote?.quoteNo}`, async () => (await openClientRequest({
    type: 'booking_review', customer: quote.customer, contract: quote.contract || null,
    source: { kind: 'Quote', id: quote._id }, priority: 'high',
    title: `Booking needs staff · ${quote.quoteNo}`,
    summary: reason || quote.appBooking?.reviewReason || '',
  })).request);
}

/** Somebody new signed up in the app. */
export function onNewSignup(customer) {
  return safely(`new sign-up ${customer?._id}`, async () => (await openClientRequest({
    type: 'new_signup', customer: customer._id,
    source: { kind: 'Customer', id: customer._id },
    title: `New app sign-up · ${customer.fullName || customer.phone || ''}`.trim(),
    summary: `Signed up in the app${customer.phone ? ` with ${customer.phone}` : ''}`,
  })).request);
}

// ── Escalation ──────────────────────────────────────────────────────────────
/**
 * Every request past its due time that nobody has picked up or finished:
 * tell the team leads (and the assignee) once. `escalatedAt` is claimed with a
 * conditional update, so two servers running this cannot both push.
 */
export async function escalateOverdue({ now = new Date() } = {}) {
  const due = await ClientRequest.find({ status: { $in: ['new', 'in_progress'] }, dueAt: { $lt: now }, escalatedAt: null })
    .populate('customer', 'fullName').limit(200).lean();
  let escalated = 0;
  for (const r of due) {
    const claimed = await ClientRequest.updateOne(
      { _id: r._id, escalatedAt: null },
      { $set: { escalatedAt: now }, $push: { activity: { at: now, byName: 'System', kind: 'escalated', text: `Overdue — was due ${new Date(r.dueAt).toISOString().slice(0, 16).replace('T', ' ')} UTC; team leads told` } } },
    );
    if (!claimed.modifiedCount) continue;
    escalated += 1;
    const leads = await teamLeads(r.team);
    pushStaff([...leads.map((u) => u._id), r.assignee], {
      title: `Overdue: ${r.ref}`,
      body: `${r.title}${r.customer?.fullName ? ` — ${r.customer.fullName}` : ''}`,
      requestId: r._id,
    });
  }
  return { escalated };
}

// ── Views ───────────────────────────────────────────────────────────────────
export const ROW_POPULATE = [
  { path: 'customer', select: 'fullName phone' },
  { path: 'contract', select: 'contractNo unit units', populate: [{ path: 'unit', select: 'unitNumber' }, { path: 'units', select: 'unitNumber' }] },
  { path: 'assignee', select: 'name email' },
];

const unitNumbers = (c) => (c?.units?.length ? c.units : [c?.unit]).filter((u) => u?.unitNumber).map((u) => u.unitNumber);
export const isOverdue = (r, now = new Date()) => ['new', 'in_progress'].includes(r.status) && !!r.dueAt && new Date(r.dueAt) < now;

export function rowView(r, now = new Date()) {
  const c = r.contract?._id ? r.contract : null;
  const cu = r.customer?._id ? r.customer : null;
  const a = r.assignee?._id ? r.assignee : null;
  return {
    id: String(r._id),
    ref: r.ref,
    type: r.type,
    team: r.team,
    status: r.status,
    priority: r.priority,
    title: r.title,
    summary: r.summary,
    customer: cu ? { id: String(cu._id), name: cu.fullName || '', phone: cu.phone || '' } : null,
    contract: c ? { id: String(c._id), contractNo: c.contractNo, units: unitNumbers(c) } : null,
    assignee: a ? { id: String(a._id), name: nameOf(a) } : null,
    dueAt: r.dueAt,
    overdue: isOverdue(r, now),
    escalatedAt: r.escalatedAt || null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const customerRequestView = (cr) => (cr ? { id: String(cr._id), status: cr.status, payload: cr.payload || {}, staffNote: cr.staffNote || '', createdAt: cr.createdAt } : null);

async function contractWithUnits(id) {
  if (!id) return null;
  return Contract.findById(id).populate('unit', 'unitNumber price').populate('units', 'unitNumber price').lean();
}
const contractUnits = (c) => (c?.units?.length ? c.units : [c?.unit]).filter(Boolean);

/** What the extension would cost, at today's price — the figure approval raises the invoice for. */
function extensionPrice(contract, newEndDate) {
  const rate = renewalMonthlyRate(contract, contractUnits(contract));
  return priceRenewal({ monthlyRate: rate.monthlyRate, from: contract.endDate, to: newEndDate, vatPct: VAT_PCT });
}

async function contextFor(r) {
  switch (r.type) {
    case 'service': {
      const sr = await ServiceRequest.findById(r.source.id).lean();
      if (!sr) return { serviceRequest: null };
      const items = sr.items?.length
        ? await StoredContainer.find({ _id: { $in: sr.items } }).select('displayCode description currentLocation').populate('currentLocation', 'displayCode name').lean()
        : [];
      return {
        serviceRequest: {
          id: String(sr._id), ref: sr.ref, type: sr.type, status: sr.status, date: sr.date,
          slotLabel: slotById(sr.slot)?.label || '',
          startTime: sr.startTime || null,
          endTime: sr.startTime && sr.hours ? workerEndTime(sr.startTime, sr.hours) : null,
          address: { label: sr.address?.label || '', line: sr.address?.line || '' },
          items: items.map((i) => ({ id: String(i._id), label: i.displayCode, name: i.description || '', location: i.currentLocation?.displayCode || i.currentLocation?.name || '' })),
          estimate: { lines: sr.estimate?.lines || [], total: sr.estimate?.total || 0 },
          payment: paymentView(sr.payment),
          driverName: sr.driverName || '', driverPhone: sr.driverPhone || '',
          charged: sr.charged ?? null, staffNote: sr.staffNote || '', notes: sr.notes || '',
        },
      };
    }
    case 'extend':
    case 'moveout': {
      const cr = await CustomerRequest.findById(r.source.id).lean();
      const c = await contractWithUnits(cr?.contract || r.contract);
      const newEndDate = cr?.payload?.requestedEndDate || null;
      const preview = { newEndDate };
      if (r.type === 'extend' && c?.endDate && newEndDate && new Date(newEndDate) > new Date(c.endDate)) {
        preview.amount = extensionPrice(c, newEndDate).total;
      }
      return {
        customerRequest: customerRequestView(cr),
        contract: c ? { id: String(c._id), contractNo: c.contractNo, endDate: c.endDate, rate: c.rate, billingCycle: c.billingPeriod, units: unitNumbers(c) } : null,
        preview,
      };
    }
    case 'deposit_refund': {
      const cr = await CustomerRequest.findById(r.source.id).lean();
      const c = await Contract.findById(cr?.contract || r.contract).select('contractNo endDate status deposit').lean();
      return {
        customerRequest: customerRequestView(cr),
        contract: c ? { id: String(c._id), contractNo: c.contractNo, endDate: c.endDate, status: c.status, deposit: c.deposit || 0 } : null,
      };
    }
    case 'id_check': {
      const ids = r.documents?.length ? r.documents : [r.source.id];
      const docs = await Document.find({ _id: { $in: ids } }).sort({ createdAt: 1 }).lean();
      return {
        documents: docs.map((d) => ({
          id: String(d._id), type: d.type, side: d.side || '', uploadedAt: d.createdAt,
          // The staff documents route streams it from Drive or disk, behind the staff login.
          url: `/api/documents/${d._id}/file`,
          verification: { state: d.verification?.state || 'pending', byName: d.verification?.byName || '', at: d.verification?.at || null, reason: d.verification?.reason || '' },
        })),
      };
    }
    case 'booking_review': {
      const q = await Quote.findById(r.source.id).select('quoteNo appBooking stripePaidAt units total').lean();
      return {
        quote: q ? { id: String(q._id), quoteNo: q.quoteNo, reviewReason: q.appBooking?.reviewReason || '', stripePaidAt: q.stripePaidAt || null, units: (q.units || []).map((u) => u.unitNumber).filter(Boolean), total: q.total || 0 } : null,
      };
    }
    case 'new_signup': {
      const cu = await Customer.findById(r.customer).select('fullName phone email createdAt stage').lean();
      const lead = await leadFor(r, cu);
      return {
        customer: cu ? { id: String(cu._id), name: cu.fullName || '', phone: cu.phone || '', email: cu.email || '', createdAt: cu.createdAt, stage: cu.stage } : null,
        existingLead: lead ? { id: String(lead._id), status: lead.status, owner: lead.owner?._id ? { id: String(lead.owner._id), name: nameOf(lead.owner) } : null } : null,
      };
    }
    default:
      return {};
  }
}

async function leadFor(r, customer) {
  if (r.lead) return Lead.findById(r.lead).select('status owner').populate('owner', 'name email').lean();
  const phoneNormalized = await normalizedPhone(customer?.phone);
  if (!phoneNormalized) return null;
  return Lead.findOne({ phoneNormalized }).select('status owner').populate('owner', 'name email').lean();
}

// The leads route owns phone normalisation; imported lazily so a customer
// route loading this file does not pull the whole leads router in with it.
async function normalizedPhone(phone) {
  if (!phone) return '';
  const { normalizeLeadPhone } = await import('../routes/leads.js');
  return normalizeLeadPhone(phone);
}

const ACTION_ORDER = ['claim', 'assign', 'status', 'note', 'message', 'approve', 'decline', 'verify', 'reject', 'mark_refunded', 'create_lead', 'not_interested', 'resolve'];

export function actionsFor(r, user, context = {}) {
  if (!canSee(user, r)) return [];
  const acts = new Set(['note']);
  if (OPEN_STATUSES.includes(r.status)) {
    if (String(idOf(r.assignee) || '') !== String(user._id)) acts.add('claim');
    ['assign', 'status', 'message', 'resolve'].forEach((a) => acts.add(a));
    const pending = context.customerRequest?.status === 'pending';
    if (['extend', 'moveout'].includes(r.type) && pending) { acts.add('approve'); acts.add('decline'); }
    if (r.type === 'deposit_refund' && pending) { acts.add('mark_refunded'); acts.add('decline'); }
    if (r.type === 'id_check') { acts.add('verify'); acts.add('reject'); }
    if (r.type === 'new_signup') { if (!r.lead) acts.add('create_lead'); acts.add('not_interested'); }
  }
  return ACTION_ORDER.filter((a) => acts.has(a));
}

export async function detailView(id, user) {
  const r = await ClientRequest.findById(id).populate(ROW_POPULATE).lean();
  if (!r) fail('Request not found.', 404);
  const context = await contextFor(r);
  return {
    ...rowView(r),
    activity: (r.activity || []).map((a) => ({ at: a.at, byName: a.byName || '', kind: a.kind, text: a.text || '' })),
    resolution: r.resolution ? { at: r.resolution.at, byName: r.resolution.byName || '', outcome: r.resolution.outcome || '', reason: r.resolution.reason || '' } : null,
    context,
    actions: actionsFor(r, user, context),
  };
}

// ── Staff changes ───────────────────────────────────────────────────────────
const log = (r, user, kind, text) => r.activity.push({ at: new Date(), by: user?._id || null, byName: user ? nameOf(user) : 'System', kind, text });
const assertOpen = (r) => { if (!OPEN_STATUSES.includes(r.status)) fail(`This request is already ${r.status}.`, 409); };

export async function claim(r, user) {
  assertOpen(r);
  r.assignee = user._id;
  if (r.status === 'new') r.status = 'in_progress';
  log(r, user, 'claimed', `Claimed by ${nameOf(user)}`);
  await r.save();
}

export async function assign(r, user, userId) {
  assertOpen(r);
  if (userId == null || userId === '') {
    r.assignee = null;
    log(r, user, 'assigned', `Returned to the ${r.team} pool by ${nameOf(user)}`);
    return r.save();
  }
  if (!/^[a-f0-9]{24}$/i.test(String(userId))) fail('Choose someone to assign this to.');
  const target = await User.findById(userId).select('name email role permissions isActive').lean();
  if (!target || target.isActive === false || !teamsOf(target).includes(r.team)) fail(`That person is not on the ${r.team} team.`);
  r.assignee = target._id;
  log(r, user, 'assigned', String(target._id) === String(user._id) ? `${nameOf(user)} took it` : `Assigned to ${nameOf(target)} by ${nameOf(user)}`);
  await r.save();
  if (String(target._id) !== String(user._id)) {
    pushStaff([target._id], { title: `${r.ref} assigned to you`, body: r.title, requestId: r._id });
  }
}

export async function setStatus(r, user, status) {
  if (!OPEN_STATUSES.includes(status)) fail('Status must be new, in progress or waiting for the customer.');
  assertOpen(r);
  if (r.status === status) return;
  log(r, user, 'status', `${r.status.replace('_', ' ')} → ${status.replace('_', ' ')}`);
  r.status = status;
  await r.save();
}

export async function addNote(r, user, text) {
  const t = clean(text, 2000);
  if (!t) fail('Write a note first.');
  log(r, user, 'note', t);
  await r.save();
}

// Where a message about this request opens in the customer app, and which
// inbox kind (icon) it is filed under there.
function deepLink(r) {
  const contractId = r.contract ? String(idOf(r.contract)) : undefined;
  switch (r.type) {
    case 'service': return { kind: 'service', data: { route: '/service/[id]', params: { id: String(r.source.id) } } };
    case 'extend':
    case 'moveout': return { kind: 'renewal', data: { route: '/checkout', params: contractId ? { contractId } : {} } };
    case 'deposit_refund': return { kind: 'payment', data: { route: '/refund', params: contractId ? { contractId } : {} } };
    case 'id_check': return { kind: 'service', data: { route: '/id-upload' } };
    case 'booking_review': return { kind: 'service', data: { route: '/book/status', params: { id: String(r.source.id) } } };
    default: return { kind: 'service', data: {} };
  }
}

const tellCustomer = (r, { title, body, data }) => {
  const link = deepLink(r);
  return notifyCustomer(idOf(r.customer), { kind: link.kind, title, body, data: data || link.data });
};

export async function messageCustomer(r, user, text) {
  const t = String(text ?? '').trim().slice(0, 1000);
  if (!t) fail('Write a message first.');
  const out = await tellCustomer(r, { title: 'Message from PurpleBox', body: t });
  log(r, user, 'customer_message', out.created ? t : `${t} (could not be delivered)`);
  await r.save();
  return out;
}

async function contractNote(contractId, text, author) {
  if (!contractId) return;
  await Contract.updateOne({ _id: idOf(contractId) }, { $push: { timeline: { at: new Date(), text, author } } })
    .catch((e) => console.error('[ClientRequests] contract timeline:', e.message));
}

/** Write the decision, close the request, and say so on the contract. */
async function close(r, user, { status = 'resolved', outcome, reason = '', text }) {
  const now = new Date();
  r.status = status;
  r.resolution = { at: now, by: user._id, byName: nameOf(user), outcome, reason };
  log(r, user, 'action', text || `${outcome}${reason ? ` — ${reason}` : ''}`);
  await r.save();
  await contractNote(r.contract, `Client request ${r.ref} (${r.type.replace('_', ' ')}) ${outcome}${reason ? ` — ${reason}` : ''}`, nameOf(user));
}

async function pendingCustomerRequest(r) {
  const cr = await CustomerRequest.findById(r.source.id);
  if (!cr) fail('The customer request behind this is gone.', 404);
  if (cr.status !== 'pending') fail(`The customer request was already ${cr.status}.`, 409);
  return cr;
}

const needReason = (v) => {
  const reason = clean(v, 1000);
  if (!reason) fail('Give a reason — the customer is told it.');
  return reason;
};

/**
 * Approve an extension: the same ContractRenewal the tenant's own renewal page
 * writes (frozen at today's price), then applyRenewal — the one function that
 * means "renewed". Applied with paid=false: the end date moves now and the
 * invoice is raised as owed, which the tenant pays in the app like any other.
 * (The online page waits for the money first because nobody has agreed
 * anything; here a colleague has.)
 */
async function approveExtension(r, user, note) {
  const cr = await pendingCustomerRequest(r);
  const contract = await contractWithUnits(cr.contract);
  if (!contract) fail('Contract not found.', 404);
  if (['ended', 'cancelled'].includes(contract.status)) fail(`The contract is ${contract.status} — it cannot be extended.`, 409);
  const newEnd = new Date(cr.payload?.requestedEndDate);
  const check = validateNewEndDate({ currentEndDate: contract.endDate, newEndDate: newEnd, maxWeeks: MAX_APPROVED_WEEKS });
  if (!check.ok) fail(check.error, 409);

  const rate = renewalMonthlyRate(contract, contractUnits(contract));
  const priced = priceRenewal({ monthlyRate: rate.monthlyRate, from: contract.endDate, to: newEnd, vatPct: VAT_PCT });
  // One live renewal per contract, as on the renewal page.
  await ContractRenewal.updateMany({ contract: contract._id, status: { $in: ['pending', 'awaiting_transfer'] } }, { $set: { status: 'cancelled' } });
  const renewal = await ContractRenewal.create({
    contract: contract._id, customer: contract.customer,
    currentEndDate: contract.endDate, newEndDate: newEnd,
    weeks: priced.weeks, monthlyRate: priced.monthlyRate, weeklyRate: priced.weeklyRate, rateSource: rate.source,
    subTotal: priced.subTotal, vatPct: priced.vatPct, vatAmount: priced.vatAmount, total: priced.total,
    cardFeePct: 0, cardFeeAmount: 0,
    method: 'bank_transfer', status: 'awaiting_transfer',
  });
  const { applyRenewal } = await import('./renewalApply.js');
  const out = await applyRenewal(renewal._id, { byName: nameOf(user), paid: false, viaAppRequest: true });
  if (!out.ok) fail(out.error || 'Could not apply the extension.', 409);
  const invoice = out.invoiceId ? await Invoice.findById(out.invoiceId).select('invoiceNo total').lean() : null;

  cr.status = 'approved';
  cr.staffNote = note || `Approved by ${nameOf(user)}`;
  await cr.save();
  await tellCustomer(r, {
    title: 'Extension approved',
    body: `${contract.contractNo} now runs to ${fmtDate(newEnd)}.${invoice ? ` Invoice ${invoice.invoiceNo} for ${aed(invoice.total)} is in Payments.` : ''}`,
    data: { route: '/payments' },
  });
  await close(r, user, {
    outcome: 'approved',
    reason: `Extended to ${day(newEnd)}${invoice ? `; invoice ${invoice.invoiceNo} (${aed(invoice.total)}) raised, payment due` : ''}${note ? ` — ${note}` : ''}`,
  });
}

/**
 * Move a contract's check-out, with the side effects a check-out change made
 * on the contract page has (routes/contracts.js PUT /:id): agreement wording
 * brought up to date, a Renewal History row, unpaid card renewals quoted from
 * the old date cancelled, and — the contract being signed — flagged for
 * re-signing with the rep told.
 */
async function changeContractEndDate(contractId, newEnd, { byName }) {
  const contract = await Contract.findById(contractId).populate('customer', 'fullName');
  if (!contract) fail('Contract not found.', 404);
  const previousEnd = contract.endDate;
  if (day(previousEnd) === day(newEnd)) return contract;
  if (String(contract.agreementText || '').trim()) {
    contract.agreementText = refreshAgreementDates(contract.agreementText, contract, { startDate: contract.startDate, endDate: newEnd });
  }
  contract.endDate = newEnd;
  contract.renewalIntent = 'not_renewing';
  contract.timeline.push({ at: new Date(), text: `Updated Check Out: ${day(newEnd)}`, author: byName });
  contract.renewalHistory.push({ at: new Date(), previousEndDate: previousEnd, newEndDate: newEnd, author: byName });
  if (contract.status === 'active') {
    contract.resignNeeded = { at: new Date(), reason: 'Check-out date changed after signing', previousStart: contract.startDate, newStart: contract.startDate, previousEnd, newEnd, by: byName };
    contract.timeline.push({ at: new Date(), text: `Check-out moved ${day(previousEnd)} → ${day(newEnd)} — contract needs to be signed again`, author: byName });
  }
  await contract.save();
  await ContractRenewal.updateMany({ contract: contract._id, status: 'pending' }, { $set: { status: 'cancelled' } });
  if (contract.status === 'active') {
    await notifyResignNeeded({ contract, previousStart: contract.startDate, newStart: contract.startDate, previousEnd, newEnd, byName });
  }
  for (const u of new Set([contract.unit, ...(contract.units || [])].filter(Boolean).map(String))) {
    await syncUnitStatus(u).catch((e) => console.error('[ClientRequests] unit status:', e.message));
  }
  return contract;
}

async function approveMoveOut(r, user, note) {
  const cr = await pendingCustomerRequest(r);
  const contract = await Contract.findById(cr.contract).select('status contractNo').lean();
  if (!contract) fail('Contract not found.', 404);
  if (contract.status !== 'active') fail(`The contract is ${contract.status}.`, 409);
  const newEnd = new Date(cr.payload?.requestedEndDate);
  if (Number.isNaN(newEnd.getTime())) fail('The request has no move-out date.', 409);
  await changeContractEndDate(cr.contract, newEnd, { byName: nameOf(user) });
  cr.status = 'approved';
  cr.staffNote = note || `Approved by ${nameOf(user)}`;
  await cr.save();
  await tellCustomer(r, { title: 'Move-out date confirmed', body: `${contract.contractNo} now ends on ${fmtDate(newEnd)}. We will be in touch about handing back your unit.` });
  await close(r, user, { outcome: 'approved', reason: `Check-out moved to ${day(newEnd)}${note ? ` — ${note}` : ''}` });
}

async function declineCustomerRequest(r, user, reason) {
  const cr = await pendingCustomerRequest(r);
  cr.status = 'declined';
  cr.staffNote = reason;
  await cr.save();
  const what = { extend: 'extension', moveout: 'move-out change', deposit_refund: 'deposit refund' }[r.type] || 'request';
  await tellCustomer(r, { title: `Your ${what} request`, body: `We could not approve it: ${reason}` });
  await close(r, user, { status: 'declined', outcome: 'declined', reason });
}

const REFUND_METHODS = ['bank_transfer', 'cash', 'card', 'cheque', 'other'];

/**
 * The deposit was paid back. There is no refund ledger in the CRM — a Payment
 * row is income and a negative one would quietly lower the contract's
 * "Received" — so the record is the CustomerRequest (payload.refund), the
 * contract timeline and this request's resolution.
 */
async function markRefunded(r, user, { amount, method, note }) {
  const cr = await pendingCustomerRequest(r);
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0 || value > 1e6) fail('Enter the amount refunded in AED.');
  const how = REFUND_METHODS.includes(method) ? method : 'bank_transfer';
  const n = clean(note, 1000);
  const amt = Math.round(value * 100) / 100;
  cr.status = 'approved';
  cr.staffNote = n || `Refunded by ${nameOf(user)}`;
  cr.payload = { ...(cr.payload || {}), refund: { amount: amt, method: how, note: n, at: new Date(), by: nameOf(user) } };
  cr.markModified('payload');
  await cr.save();
  await tellCustomer(r, { title: 'Deposit refunded', body: `${aed(amt)} has been refunded${how === 'bank_transfer' ? ' by bank transfer' : how === 'cash' ? ' in cash' : ''}.${n ? ` ${n}` : ''}` });
  await close(r, user, { outcome: 'refunded', reason: `${aed(amt)} by ${how.replace('_', ' ')}${n ? ` — ${n}` : ''}` });
}

/** Mark the batch, and the copies linkIdentityToContract made of it on contracts. */
async function setVerification(r, user, state, reason = '') {
  const ids = r.documents?.length ? r.documents : [r.source.id];
  const docs = await Document.find({ _id: { $in: ids } }).select('driveFileId url').lean();
  const copies = docs.flatMap((d) => [d.driveFileId ? { driveFileId: d.driveFileId } : null, d.url ? { url: d.url } : null]).filter(Boolean);
  const verification = { state, by: user._id, byName: nameOf(user), at: new Date(), reason };
  await Document.updateMany({ $or: [{ _id: { $in: ids } }, ...(copies.length ? [{ customer: idOf(r.customer), $or: copies }] : [])] }, { $set: { verification } });
}

async function createLead(r, user) {
  if (r.lead) fail('A lead was already made from this sign-up.', 409);
  const customer = await Customer.findById(r.customer).select('fullName phone email').lean();
  if (!customer) fail('Customer not found.', 404);
  const phoneNormalized = await normalizedPhone(customer.phone);
  if (!phoneNormalized) fail('This sign-up has no mobile number to make a lead from.', 409);
  const now = new Date();

  let lead = await Lead.findOne({ phoneNormalized });
  let reason;
  if (lead) {
    lead.timeline.push({ type: 'note', text: `Signed up in the customer app (${r.ref})`, user: user._id });
    await lead.save();
    reason = 'Linked to the lead already on this number';
  } else {
    const fullName = customer.fullName || customer.phone;
    const [firstName, ...rest] = String(fullName).trim().split(/\s+/);
    lead = await Lead.create({
      firstName, lastName: rest.join(' '), fullName,
      phone: customer.phone, phoneNormalized, email: customer.email || '',
      source: 'mobile_app', status: 'new', leadDateTime: now, unitsNeeded: 1,
      timeline: [{ type: 'created', text: `Signed up in the customer app — lead made from ${r.ref} by ${nameOf(user)}`, user: user._id }],
    });
    // A rep making it keeps it, as on the Leads page; anyone else hands it to
    // the distribution rules like every other new lead.
    let ownerId = null; let why = '';
    if (user.role === 'sales_rep') { ownerId = String(user._id); why = `made by ${nameOf(user)}`; } else {
      const { routeInboundLead } = await import('./leadRouting.js');
      const decision = await routeInboundLead({ phoneNormalized, at: now }).catch(() => null);
      if (decision?.ownerId) { ownerId = String(decision.ownerId); why = decision.reason || 'distribution rules'; }
    }
    if (ownerId) {
      const self = ownerId === String(user._id);
      const res = await Lead.updateOne({ _id: lead._id, owner: null }, {
        $set: { owner: ownerId, assignedAt: now, autoAssigned: !self, assignedBy: self ? user._id : null, ownerSeenAt: null, firstResponseAt: null },
        $push: { timeline: { type: 'note', text: self ? `Owned by ${nameOf(user)}` : `Assigned by distribution rules — ${why}` } },
      });
      if (res.modifiedCount && !self) {
        const { notifyLeadAssigned } = await import('./leadNotify.js');
        notifyLeadAssigned({ lead, ownerId, reason: why }).catch((e) => console.error('[ClientRequests] lead notify:', e.message));
      }
    }
    reason = ownerId ? 'New lead created' : 'New lead created, waiting for distribution';
  }
  r.lead = lead._id;
  await close(r, user, { outcome: 'lead_created', reason });
}

export async function runAction(r, user, body = {}) {
  const action = String(body.action || '');
  const allowed = actionsFor(r, user, await contextFor(r));
  if (!allowed.includes(action) || ['claim', 'assign', 'status', 'note', 'message'].includes(action)) {
    fail(OPEN_STATUSES.includes(r.status) ? `"${action}" is not available for this request.` : `This request is already ${r.status}.`, 409);
  }
  const note = clean(body.note, 1000);
  switch (action) {
    case 'approve':
      return r.type === 'extend' ? approveExtension(r, user, note) : approveMoveOut(r, user, note);
    case 'decline':
      return declineCustomerRequest(r, user, needReason(body.reason));
    case 'mark_refunded':
      return markRefunded(r, user, body);
    case 'verify':
      await setVerification(r, user, 'verified');
      return close(r, user, { outcome: 'verified', reason: note });
    case 'reject': {
      const reason = needReason(body.reason);
      await setVerification(r, user, 'rejected', reason);
      await tellCustomer(r, { title: 'Please upload your ID again', body: reason, data: { route: '/id-upload' } });
      return close(r, user, { status: 'declined', outcome: 'rejected', reason });
    }
    case 'create_lead':
      return createLead(r, user);
    case 'not_interested':
      return close(r, user, { outcome: 'not_interested', reason: clean(body.reason, 1000) || note });
    case 'resolve':
      return close(r, user, { outcome: 'resolved', reason: note });
    default:
      return fail('Unknown action.');
  }
}

// ── Backfill ────────────────────────────────────────────────────────────────
/**
 * Open a request for everything already waiting from before the inbox
 * existed. Idempotent like every hook — re-running opens nothing twice.
 * Due times count from now, not from when the customer asked, so the first
 * run does not escalate a month of backlog to every admin at once.
 */
export async function backfillClientRequests({ now = new Date() } = {}) {
  const counts = Object.fromEntries(CLIENT_REQUEST_TYPES.map((t) => [t, 0]));
  // Counted once per row: a second ID upload joins the first one's check.
  const tally = (r, seen) => { if (r && !seen.has(String(r._id))) { counts[r.type] += 1; seen.add(String(r._id)); } };
  const before = new Set((await ClientRequest.find({}).select('_id').lean()).map((r) => String(r._id)));

  for (const cr of await CustomerRequest.find({ status: 'pending' }).lean()) tally(await onCustomerRequest(cr), before);
  for (const sr of await ServiceRequest.find({ status: { $in: ['requested', 'confirmed', 'scheduled', 'in_progress'] } }).lean()) {
    tally(await onServiceRequestCreated(sr), before);
    await syncFromSource('ServiceRequest', sr._id);
  }
  for (const q of await Quote.find({ 'appBooking.needsReview': true }).select('quoteNo customer contract appBooking').lean()) {
    tally(await onBookingNeedsReview(q, q.appBooking?.reviewReason), before);
  }
  const docs = await Document.find({
    source: 'customer_app', contract: null, type: { $in: ID_TYPES },
    'verification.state': { $in: [null] }, createdAt: { $gte: new Date(now.getTime() - 30 * 86_400_000) },
  }).sort({ createdAt: 1 }).lean();
  for (const d of docs) tally(await onIdentityUpload(d), before);
  const prospects = await Customer.find({ stage: 'prospect', appLoginAt: { $ne: null }, createdAt: { $gte: new Date(now.getTime() - 14 * 86_400_000) } })
    .select('fullName phone').lean();
  for (const c of prospects) tally(await onNewSignup(c), before);

  return { created: counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}
