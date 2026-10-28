/**
 * What the staff phone app shows that no web page already returns in one go.
 *
 *   GET /admin/today   the business today against yesterday, for the admin's first screen
 *   GET /admin/team    per rep: what they were given, how fast they answered,
 *                      what they let slip, what they closed
 *   GET /person        one person, lead and tenant together, with every
 *                      WhatsApp, call, email and note in a single timeline
 *
 * Every figure is counted the way the page it already appears on counts it,
 * so the phone and the web never tell somebody two different numbers:
 * booked is Contract.salesRep (leaderboard.js), collected is Payment.paidDate
 * (reportBlocks revenue_collected), a missed follow-up is the follow-up
 * list's own "overdue" (leads.js /follow-ups).
 */

import { computeOccupancy } from '../services/occupancy.js';
import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { CallLog, Contract, Customer, Invoice, Lead, Payment, SentEmail, Unit, User, WhatsAppMessage } from '../models/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { dubaiDayStart } from '../services/followUpTeam.js';
import { normalizePhone, phoneTail9 } from '../services/phone.js';
import { findCustomersByContact } from '../services/customerLookup.js';

const router = Router();

const DAY = 86_400_000;
const CLOSED = ['won', 'lost', 'already_customer'];
const OPEN = { status: { $nin: CLOSED }, deletedAt: null };
// A contract somebody abandoned is not a booking.
const BOOKED = { status: { $ne: 'cancelled' }, deletedAt: null };

/** The window a team figure covers. Dubai days, like every other day boundary. */
export function periodWindow(period = 'today', now = new Date()) {
   const today = dubaiDayStart(now);
   if (period === 'week') return { from: new Date(today.getTime() - 6 * DAY), to: now, label: 'Last 7 days' };
   if (period === 'month') {
      // The 1st of this month, in Dubai.
      const local = new Date(today.getTime() + 4 * 3600_000);
      const first = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 4 * 3600_000;
      return { from: new Date(first), to: now, label: 'This month' };
   }
   return { from: today, to: now, label: 'Today' };
}

/**
 * A follow-up that was due before today and was not done. Same rule as the
 * follow-up list's "overdue": a visit booked for today or later is already
 * the next step, so the older chase date under it is not missed.
 */
export function missedFollowUpMatch(now = new Date()) {
   const today = dubaiDayStart(now);
   return {
      ...OPEN,
      followUpAt: { $ne: null, $lt: today },
      $or: [{ siteVisitAt: null }, { siteVisitAt: { $lt: today } }],
   };
}

export function median(values) {
   if (!values.length) return null;
   const s = [...values].sort((a, b) => a - b);
   const mid = Math.floor(s.length / 2);
   return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const sum = (rows) => rows[0]?.total || 0;

/**
 * Chats where the customer wrote last, at least an hour ago, and nobody has
 * answered — by the owner of the lead on that number. The same rule as the
 * assistant's customers_waiting (mcp/crmTools.js), counted here in full: that
 * one returns a capped list, and a per-rep figure built from a capped list
 * undercounts exactly the rep who is furthest behind.
 */
export async function waitingForReplyByOwner(now = new Date()) {
   const rows = await WhatsAppMessage.aggregate([
      { $match: { occurredAt: { $gte: new Date(now.getTime() - 14 * DAY) }, deletedAt: null, type: { $nin: ['reaction', 'status'] } } },
      { $sort: { occurredAt: -1 } },
      { $group: { _id: '$phoneNormalized', direction: { $first: '$direction' }, at: { $first: '$occurredAt' } } },
      { $match: { direction: 'inbound', at: { $lt: new Date(now.getTime() - 3600_000) } } },
   ]);
   const leads = await Lead.find({ phoneNormalized: { $in: rows.map((r) => r._id) } }).select('phoneNormalized owner status').lean();
   const byPhone = new Map(leads.map((l) => [l.phoneNormalized, l]));
   const byOwner = new Map();
   let total = 0;
   for (const r of rows) {
      const l = byPhone.get(r._id);
      if (l && CLOSED.includes(l.status)) continue;
      total += 1;
      if (l?.owner) byOwner.set(String(l.owner), (byOwner.get(String(l.owner)) || 0) + 1);
   }
   return { total, byOwner };
}
const countBy = (rows) => new Map(rows.map((r) => [String(r._id), r.n]));

/* ── admin: today ────────────────────────────────────────────────────────── */

router.get('/admin/today', requireAdmin, async (_req, res) => {
   try {
      const now = new Date();
      const today = dubaiDayStart(now);
      const yesterday = new Date(today.getTime() - DAY);
      const tomorrow = new Date(today.getTime() + DAY);
      const inDay = (from, to) => ({ $gte: from, $lt: to });

      const collected = (from, to) => Payment.aggregate([
         { $match: { status: 'paid', paidDate: inDay(from, to), deletedAt: null } },
         { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);

      const [
         leadsToday, leadsYesterday, bySource,
         bookedToday, bookedYesterday,
         collectedToday, collectedYesterday,
         moveIns, moveOuts, unitStats,
         unassigned, missed, visitsToday, waiting,
      ] = await Promise.all([
         Lead.countDocuments({ createdAt: inDay(today, tomorrow) }),
         Lead.countDocuments({ createdAt: inDay(yesterday, today) }),
         Lead.aggregate([
            { $match: { createdAt: inDay(today, tomorrow), deletedAt: null } },
            { $group: { _id: '$source', n: { $sum: 1 } } },
            { $sort: { n: -1 } },
         ]),
         Contract.find({ ...BOOKED, createdAt: inDay(today, tomorrow) })
            .select('contractNo customer unit units status salesRep totalQuotation startDate endDate createdAt')
            .populate('customer', 'fullName').populate('unit', 'unitNumber sizeSqf').populate('salesRep', 'name')
            .sort({ createdAt: -1 }).lean(),
         Contract.countDocuments({ ...BOOKED, createdAt: inDay(yesterday, today) }),
         collected(today, tomorrow),
         collected(yesterday, today),
         Contract.countDocuments({ status: { $in: ['active', 'pending_signature'] }, startDate: inDay(today, tomorrow) }),
         Contract.countDocuments({ status: { $in: ['active', 'ended'] }, endDate: inDay(today, tomorrow) }),
         Unit.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
         Lead.countDocuments({ ...OPEN, owner: null }),
         Lead.countDocuments(missedFollowUpMatch(now)),
         Lead.countDocuments({ ...OPEN, siteVisitAt: inDay(today, tomorrow) }),
         waitingForReplyByOwner(now),
      ]);

      const units = Object.fromEntries(unitStats.map((r) => [r._id, r.n]));
      const occ = await computeOccupancy();

      res.json({
         date: today,
         leads: {
            today: leadsToday,
            yesterday: leadsYesterday,
            bySource: bySource.map((r) => ({ source: r._id || 'other', n: r.n })),
         },
         booked: {
            today: bookedToday.length,
            yesterday: bookedYesterday,
            // A contract can hold several units; the headline is units.
            unitsToday: bookedToday.reduce((s, c) => s + Math.max(1, (c.units || []).length), 0),
            list: bookedToday.map((c) => ({
               _id: c._id,
               contractNo: c.contractNo,
               customer: c.customer?.fullName || '',
               unitNumber: c.unit?.unitNumber || '',
               sizeSqf: c.unit?.sizeSqf || null,
               units: Math.max(1, (c.units || []).length),
               rep: c.salesRep?.name || '',
               status: c.status,
               value: Math.round(c.totalQuotation || 0),
               startDate: c.startDate,
               endDate: c.endDate,
            })),
         },
         collected: { today: Math.round(sum(collectedToday)), yesterday: Math.round(sum(collectedYesterday)) },
         moveIns,
         moveOuts,
         occupancy: {
            pct: occ.occupancyPct,
            definition: occ.definition,
            available: units.available || 0,
            occupied: units.occupied || 0,
            reserved: units.reserved || 0,
         },
         unassigned,
         missedFollowUps: missed,
         visitsToday,
         waitingForReply: waiting.total,
      });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

/* ── admin: team ─────────────────────────────────────────────────────────── */

router.get('/admin/team', requireAdmin, async (req, res) => {
   try {
      const now = new Date();
      const period = ['today', 'week', 'month'].includes(String(req.query.period)) ? String(req.query.period) : 'today';
      const { from, to, label } = periodWindow(period, now);
      const today = dubaiDayStart(now);
      const tomorrow = new Date(today.getTime() + DAY);

      const byOwner = (match) => Lead.aggregate([
         { $match: { ...match, owner: { $ne: null } } },
         { $group: { _id: '$owner', n: { $sum: 1 } } },
      ]);

      const [people, open, dueToday, missed, visits, given, booked, calls, waiting] = await Promise.all([
         User.find({ isActive: { $ne: false }, role: { $in: ['sales_rep', 'admin', 'accounts_admin'] } }).select('name email role').lean(),
         byOwner(OPEN),
         byOwner({ ...OPEN, followUpAt: { $gte: today, $lt: tomorrow } }),
         byOwner(missedFollowUpMatch(now)),
         byOwner({ deletedAt: null, siteVisitAt: { $gte: from, $lt: period === 'today' ? tomorrow : to } }),
         // Handed to them in the window, as the leaderboard counts "received".
         Lead.find({ assignedAt: { $gte: from, $lte: to }, owner: { $ne: null }, deletedAt: null })
            .select('owner assignedAt firstResponseAt').lean(),
         Contract.aggregate([
            { $match: { ...BOOKED, salesRep: { $ne: null }, createdAt: { $gte: from, $lte: to } } },
            { $group: { _id: '$salesRep', n: { $sum: 1 }, value: { $sum: { $ifNull: ['$totalQuotation', 0] } } } },
         ]),
         CallLog.aggregate([
            { $match: { startedAt: { $gte: from, $lte: to }, direction: { $in: ['outgoing', 'incoming'] } } },
            { $group: { _id: '$user', n: { $sum: 1 } } },
         ]),
         waitingForReplyByOwner(now),
      ]);

      const maps = { open: countBy(open), dueToday: countBy(dueToday), missed: countBy(missed), visits: countBy(visits), calls: countBy(calls) };
      const bookedBy = new Map(booked.map((r) => [String(r._id), r]));

      const rows = people.map((u) => {
         const id = String(u._id);
         const mine = given.filter((l) => String(l.owner) === id);
         const replyMins = mine
            .filter((l) => l.firstResponseAt && l.assignedAt)
            .map((l) => Math.round((new Date(l.firstResponseAt) - new Date(l.assignedAt)) / 60000))
            .filter((m) => m >= 0);
         return {
            userId: id,
            name: u.name || u.email,
            role: u.role,
            openLeads: maps.open.get(id) || 0,
            given: mine.length,
            answered: replyMins.length,
            notAnswered: mine.filter((l) => !l.firstResponseAt).length,
            medianReplyMins: median(replyMins),
            dueToday: maps.dueToday.get(id) || 0,
            missedFollowUps: maps.missed.get(id) || 0,
            waitingForReply: waiting.byOwner.get(id) || 0,
            visits: maps.visits.get(id) || 0,
            booked: bookedBy.get(id)?.n || 0,
            bookedValue: Math.round(bookedBy.get(id)?.value || 0),
            calls: maps.calls.get(id) || 0,
         };
      })
         // An admin with nothing on their name is not on the sales team.
         .filter((r) => r.role === 'sales_rep' || r.openLeads || r.given || r.booked)
         // Whoever has the most slipping first: that is who the admin opens this for.
         .sort((a, b) => b.missedFollowUps - a.missedFollowUps || b.waitingForReply - a.waitingForReply || a.name.localeCompare(b.name));

      res.json({
         period,
         label,
         from,
         to,
         rows,
         totals: {
            given: rows.reduce((s, r) => s + r.given, 0),
            missedFollowUps: rows.reduce((s, r) => s + r.missedFollowUps, 0),
            booked: rows.reduce((s, r) => s + r.booked, 0),
            waitingForReply: waiting.total,
         },
      });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

/* ── one person ──────────────────────────────────────────────────────────── */

const WA_LABEL = { image: 'Photo', video: 'Video', audio: 'Voice note', document: 'Document', sticker: 'Sticker', location: 'Location', template: 'Template' };

/** WhatsApp, calls, emails and notes for one person, newest first. */
export function mergeTimeline({ messages = [], calls = [], emails = [], leads = [] }, limit = 80) {
   const items = [];
   for (const m of messages) {
      items.push({
         at: m.occurredAt,
         kind: 'whatsapp',
         direction: m.direction === 'outbound' ? 'out' : 'in',
         text: m.text || m.transcript || (WA_LABEL[m.type] ? `[${WA_LABEL[m.type]}]` : `[${m.type}]`),
         by: m.sentByAi ? 'AI' : (m.sentBy?.name || ''),
      });
   }
   for (const c of calls) {
      items.push({
         at: c.startedAt,
         kind: 'call',
         direction: c.direction === 'outgoing' ? 'out' : 'in',
         text: [c.direction === 'missed' ? 'Missed call' : c.direction === 'rejected' ? 'Declined call' : `${c.direction === 'outgoing' ? 'Called' : 'Call from customer'}${c.durationSec ? `, ${Math.max(1, Math.round(c.durationSec / 60))} min` : ''}`, c.note].filter(Boolean).join(' — '),
         by: c.user?.name || '',
      });
   }
   for (const e of emails) {
      items.push({ at: e.at, kind: 'email', direction: 'out', text: e.subject || '(no subject)', by: e.sentBy || '' });
   }
   for (const l of leads) {
      for (const c of l.comments || []) items.push({ at: c.createdAt, kind: 'note', text: c.text, by: c.userName || c.user?.name || '' });
      for (const a of l.attempts || []) {
         items.push({ at: a.at, kind: 'attempt', text: [`${a.channel} attempt: ${String(a.outcome || '').replace(/_/g, ' ')}`, a.note].filter(Boolean).join(' — '), by: '' });
      }
      for (const t of l.timeline || []) items.push({ at: t.at, kind: 'event', text: t.text, by: '' });
   }
   return items
      .filter((i) => i.at && i.text)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, limit);
}

router.get('/person', async (req, res) => {
   try {
      let phone = String(req.query.phone || '');
      let lead = null;
      let customer = null;
      if (req.query.leadId && isValidObjectId(req.query.leadId)) {
         lead = await Lead.findById(req.query.leadId).select('phone phoneNormalized').lean();
         phone = phone || lead?.phoneNormalized || lead?.phone || '';
      }
      if (req.query.customerId && isValidObjectId(req.query.customerId)) {
         customer = await Customer.findById(req.query.customerId).lean();
         phone = phone || customer?.phone || (customer?.phones || [])[0] || '';
      }
      const canonical = normalizePhone(phone);
      const tail = phoneTail9(canonical);
      if (!tail && !customer) return res.status(400).json({ error: 'Which person? Pass a phone, leadId or customerId.' });

      const leads = tail
         ? await Lead.find({ phoneNormalized: new RegExp(`${tail}$`), deletedAt: null })
            .select('fullName phone phoneNormalized email status temperature source owner followUpAt siteVisitAt storageSizeValue durationValue durationUnit intendedStartDate lostReason notes comments attempts timeline createdAt assignedAt')
            .populate('owner', 'name').populate('comments.user', 'name').lean()
         : [];
      const customers = customer ? [customer] : (tail ? (await findCustomersByContact({ kind: 'phone', value: canonical })).customers.map((c) => c.toObject()) : []);
      const main = customers[0] || null;

      // A rep sees the people they own, and tenants (who every rep may serve).
      const isAdmin = req.user?.role === 'admin';
      const owns = leads.some((l) => String(l.owner?._id || l.owner) === String(req.user?.id));
      if (!isAdmin && !owns && !main) return res.status(403).json({ error: 'Not your lead' });

      const phones = [...new Set([canonical, ...leads.map((l) => l.phoneNormalized), ...customers.flatMap((c) => [c.phone, ...(c.phones || [])].map(normalizePhone))].filter(Boolean))];
      const customerIds = customers.map((c) => c._id);
      const emailsTo = [...new Set([...leads.map((l) => l.email), ...customers.map((c) => c.email)].filter(Boolean))];

      const [contracts, messages, calls, emails] = await Promise.all([
         customerIds.length
            ? Contract.find({ customer: { $in: customerIds }, deletedAt: null }).select('contractNo status unit units startDate endDate rate billingPeriod totalQuotation salesRep createdAt')
               .populate('unit', 'unitNumber sizeSqf floor').populate('salesRep', 'name').sort({ createdAt: -1 }).lean()
            : [],
         phones.length ? WhatsAppMessage.find({ phoneNormalized: { $in: phones }, type: { $nin: ['reaction', 'status'] } }).sort({ occurredAt: -1 }).limit(80).populate('sentBy', 'name').lean() : [],
         phones.length ? CallLog.find({ phoneNormalized: { $in: phones } }).sort({ startedAt: -1 }).limit(40).populate('user', 'name').lean() : [],
         customerIds.length || emailsTo.length
            ? SentEmail.find({ $or: [...(customerIds.length ? [{ customer: { $in: customerIds } }] : []), ...emailsTo.map((e) => ({ to: new RegExp(e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }))] })
               .select('subject at sentBy kind status').sort({ at: -1 }).limit(30).lean()
            : [],
      ]);

      const contractIds = contracts.map((c) => c._id);
      const [payments, invoices] = await Promise.all([
         contractIds.length ? Payment.find({ contract: { $in: contractIds }, deletedAt: null }).select('contract amount status dueDate paidDate').lean() : [],
         customerIds.length || contracts.length
            ? Invoice.find({ deletedAt: null, $or: [{ customer: { $in: customerIds } }, { orderNumber: { $in: contracts.map((c) => c.contractNo) } }] })
               .select('invoiceNo orderNumber status dueDate invoiceDate total paymentMade').sort({ invoiceDate: -1 }).limit(20).lean()
            : [],
      ]);
      const paid = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
      const owed = payments.filter((p) => ['pending', 'overdue'].includes(p.status)).reduce((s, p) => s + p.amount, 0);
      const overdue = payments.filter((p) => p.status === 'overdue' || (p.status === 'pending' && new Date(p.dueDate) < new Date())).reduce((s, p) => s + p.amount, 0);

      const lastWa = messages[0];
      res.json({
         name: main?.fullName || leads[0]?.fullName || canonical,
         phone: canonical,
         email: main?.email || leads.find((l) => l.email)?.email || '',
         leads: leads.map(({ comments, attempts, timeline, ...l }) => ({ ...l, owner: l.owner ? { _id: l.owner._id, name: l.owner.name } : null })),
         customer: main ? { _id: main._id, fullName: main.fullName, clientId: main.clientId, email: main.email, company: main.company, stage: main.stage, tenantType: main.tenantType } : null,
         contracts: contracts.map((c) => ({
            _id: c._id, contractNo: c.contractNo, status: c.status,
            unitNumber: c.unit?.unitNumber || '', sizeSqf: c.unit?.sizeSqf || null, units: Math.max(1, (c.units || []).length),
            startDate: c.startDate, endDate: c.endDate, rate: c.rate, billingPeriod: c.billingPeriod,
            value: Math.round(c.totalQuotation || 0), rep: c.salesRep?.name || '',
         })),
         invoices,
         money: { paid: Math.round(paid), owed: Math.round(owed), overdue: Math.round(overdue) },
         lastMessage: lastWa ? { at: lastWa.occurredAt, mine: lastWa.direction === 'outbound' } : null,
         timeline: mergeTimeline({ messages, calls, emails, leads }),
      });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

export default router;
