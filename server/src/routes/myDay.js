/**
 * What one person has to do today.
 *
 * Everything a rep needs already existed and was scattered across four
 * screens: reminders they set from a chat, tasks on the board, customers
 * waiting for an answer in the inbox, and chats that had gone silent. A rep
 * opening the app landed on a list of every lead they own, sorted by nothing
 * in particular, and had to assemble their own morning out of it.
 *
 * This assembles it once, for the person asking, in the order it should be
 * done:
 *
 *   overdue      reminders and tasks whose day has passed — yesterday's debt
 *   today        reminders and tasks due today — the plan
 *   waiting      customers who wrote and have had no reply — the money
 *   quiet        chats that went silent on us — the slow leak
 *   new          leads handed over that have not been opened yet
 *
 * Every row carries the phone number, because the answer to nearly all of it
 * is to open the chat and say something. Nothing here writes.
 */

import { Router } from 'express';
import { Types } from 'mongoose';
import { Contract, Lead, SalesGoal, Task, Unit, WhatsAppMessage } from '../models/index.js';
import { QUIET_DAYS, wentQuiet, quietDays } from '../services/chatFollowUp.js';

const router = Router();

/* The eight buckets, in the order the pipeline is worked, with the wording the
   stage picker uses. Kept here rather than derived from the enum so the labels
   and the order are a deliberate choice rather than whatever Mongo returns. */
export const STAGES = [
   { key: 'new', label: 'New Lead' },
   { key: 'contact_attempted', label: 'Contact Attempted' },
   { key: 'contacted', label: 'Contacted' },
   { key: 'site_visit_scheduled', label: 'Site Visit Scheduled' },
   { key: 'follow_up_scheduled', label: 'Follow-Up Scheduled' },
   { key: 'quotation_sent', label: 'Quotation Sent' },
   { key: 'won', label: 'Customer / Won' },
   { key: 'lost', label: 'Dead Lead / Lost' },
];

/** Local midnight tonight, Dubai, so "today" means the day the rep is having. */
const TZ_OFFSET_HOURS = 4;
function endOfLocalDay(now = new Date()) {
   const local = new Date(new Date(now).getTime() + TZ_OFFSET_HOURS * 36e5);
   local.setUTCHours(23, 59, 59, 999);
   return new Date(local.getTime() - TZ_OFFSET_HOURS * 36e5);
}
function startOfLocalDay(now = new Date()) {
   return new Date(endOfLocalDay(now).getTime() - 864e5 + 1);
}
/** Monday as the first day: a sales week is not a calendar accident. */
function startOfLocalWeek(now = new Date()) {
   const start = startOfLocalDay(now);
   const local = new Date(start.getTime() + TZ_OFFSET_HOURS * 36e5);
   const back = (local.getUTCDay() + 6) % 7;
   return new Date(start.getTime() - back * 864e5);
}
/** How many days of this month are left, counted in local days. */
function daysLeftInMonth(now = new Date()) {
   const local = new Date(new Date(now).getTime() + TZ_OFFSET_HOURS * 36e5);
   const lastDay = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
   return Math.max(0, lastDay - local.getUTCDate());
}

function startOfLocalMonth(now = new Date()) {
   const local = new Date(new Date(now).getTime() + TZ_OFFSET_HOURS * 36e5);
   const first = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 0, 0, 0, 0));
   return new Date(first.getTime() - TZ_OFFSET_HOURS * 36e5);
}

/** "WhatsApp Contact 5521" is not a name worth putting on a dashboard. */
function leadName(lead) {
   const name = String(lead?.fullName || '').trim();
   if (name && !/^whatsapp\s*contact/i.test(name)) return name;
   return lead?.whatsappProfileName || lead?.phone || 'an enquiry';
}

router.get('/', async (req, res) => {
   try {
      const me = String(req.user?.id || '');
      if (!me) return res.status(401).json({ error: 'Not signed in' });

      const now = new Date();
      const endToday = endOfLocalDay(now);

      /* Four independent reads, issued together. Each is a round trip to Atlas
         whatever it asks for, and this route is opened every morning by
         everybody at once. */
      const [reminders, tasks, myLeads] = await Promise.all([
         // Reminders set from a chat, or from the lead itself.
         Lead.find({
            owner: me,
            followUpAt: { $ne: null, $lte: endToday },
            status: { $nin: ['won', 'lost'] },
         }).select('fullName phone phoneNormalized whatsappProfileName followUpAt status').sort({ followUpAt: 1 }).lean(),

         Task.find({
            assignedTo: me,
            status: { $ne: 'done' },
            dueDate: { $ne: null, $lte: endToday },
         }).select('taskNo title dueDate priority leadName leadId leadType').sort({ dueDate: 1 }).lean(),

         // Everything they own, for the chat-shaped questions below.
         Lead.find({ owner: me, status: { $nin: ['won', 'lost'] } })
            .select('fullName phone phoneNormalized whatsappProfileName status assignedAt ownerSeenAt followUpAt')
            .lean(),
      ]);

      const phones = [...new Set(myLeads.map((l) => l.phoneNormalized).filter(Boolean))];

      /* The state of each of their conversations. One aggregate over their
         numbers rather than one query per lead: a rep with 270 chats would
         otherwise be 270 round trips for a page they open every morning. */
      const convos = phones.length
         ? await WhatsAppMessage.aggregate([
            { $match: { phoneNormalized: { $in: phones } } },
            {
               $group: {
                  _id: '$phoneNormalized',
                  lastInboundAt: { $max: { $cond: [{ $eq: ['$direction', 'inbound'] }, '$occurredAt', null] } },
                  lastOutboundAt: { $max: { $cond: [{ $eq: ['$direction', 'outbound'] }, '$occurredAt', null] } },
                  lastText: { $last: '$text' },
               },
            },
         ])
         : [];
      const byPhone = new Map(convos.map((c) => [c._id, c]));

      const waiting = [];
      const quiet = [];
      for (const lead of myLeads) {
         const c = byPhone.get(lead.phoneNormalized);
         if (!c) continue;

         const owed = Boolean(c.lastInboundAt) && (!c.lastOutboundAt || c.lastInboundAt > c.lastOutboundAt);
         if (owed) {
            waiting.push({
               leadId: String(lead._id),
               name: leadName(lead),
               phone: lead.phone || lead.phoneNormalized,
               phoneNormalized: lead.phoneNormalized,
               since: c.lastInboundAt,
               lastText: String(c.lastText || '').slice(0, 120),
            });
            continue;
         }

         if (wentQuiet({
            lastInboundAt: c.lastInboundAt,
            lastOutboundAt: c.lastOutboundAt,
            leadStatus: lead.status,
            followUpAt: lead.followUpAt,
            now,
         })) {
            quiet.push({
               leadId: String(lead._id),
               name: leadName(lead),
               phone: lead.phone || lead.phoneNormalized,
               phoneNormalized: lead.phoneNormalized,
               since: c.lastOutboundAt,
               days: quietDays(c.lastOutboundAt, now),
            });
         }
      }

      // Longest first in both: the ones closest to being lost for good.
      waiting.sort((a, b) => new Date(a.since) - new Date(b.since));
      quiet.sort((a, b) => new Date(a.since) - new Date(b.since));

      /* Handed over and not yet opened. `ownerSeenAt` is cleared whenever a
         lead is reassigned, so this is "new to you" rather than "new". */
      const fresh = myLeads
         .filter((l) => l.assignedAt && !l.ownerSeenAt)
         .sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt))
         .slice(0, 20)
         .map((l) => ({
            leadId: String(l._id),
            name: leadName(l),
            phone: l.phone || l.phoneNormalized,
            phoneNormalized: l.phoneNormalized,
            assignedAt: l.assignedAt,
         }));

      const overdue = (d) => new Date(d) < startOfLocalDay(now);

      /* The pipeline, counted for every temperature at once.
       *
       * Four small counts rather than a query per click: the filter is then
       * instant and, more to the point, honest. A prototype approximated the
       * hot/warm/cold split with fixed ratios; a rep looking at "3 hot in
       * Quotation Sent" is entitled to have that be three actual leads. */
      /* An aggregate matches types exactly: `owner` is an ObjectId in the
         collection, and a string would match nothing and report a pipeline of
         zeros — the kind of wrong that looks like a quiet month. */
      const pipelineRows = await Lead.aggregate([
         { $match: { owner: new Types.ObjectId(me) } },
         { $group: { _id: { status: '$status', temperature: '$temperature' }, n: { $sum: 1 } } },
      ]).catch(() => []);

      const pipeline = { all: {}, hot: {}, warm: {}, cold: {} };
      for (const { key } of STAGES) { for (const t of Object.keys(pipeline)) pipeline[t][key] = 0; }
      for (const row of pipelineRows) {
         const stage = String(row._id?.status || '');
         const temp = String(row._id?.temperature || '');
         if (!(stage in pipeline.all)) continue;
         pipeline.all[stage] += row.n;
         if (temp && temp in pipeline) pipeline[temp][stage] += row.n;
      }

      /* Contracts credited to this rep, which is what "booked" means — the
         same field the leaderboard counts, so two pages cannot disagree. */
      const monthStart = startOfLocalMonth(now);
      const weekStart = startOfLocalWeek(now);
      const dayStart = startOfLocalDay(now);

      const myContracts = await Contract.find({ salesRep: me, createdAt: { $gte: monthStart } })
         .select('contractNo customer unit units rate startDate status createdAt')
         .populate('customer', 'fullName')
         .sort({ createdAt: -1 })
         .lean();

      const unitIds = [...new Set(myContracts.flatMap((c) => [c.unit, ...(c.units || [])]).filter(Boolean).map(String))];
      const units = unitIds.length
         ? await Unit.find({ _id: { $in: unitIds } }).select('unitNumber sizeSqf').lean()
         : [];
      const unitById = new Map(units.map((u) => [String(u._id), u]));

      const bookings = myContracts.slice(0, 10).map((c) => {
         const first = unitById.get(String(c.unit ?? (c.units || [])[0]));
         return {
            contractNo: c.contractNo,
            unit: first?.unitNumber || '—',
            sizeSqf: first?.sizeSqf ?? null,
            rate: Number(c.rate) || 0,
            tenant: c.customer?.fullName || '',
            status: c.status,
            startDate: c.startDate,
         };
      });

      const inRange = (from) => myContracts.filter((c) => new Date(c.createdAt) >= from);
      const value = (list) => Math.round(list.reduce((sum, c) => sum + (Number(c.rate) || 0), 0));

      // Leads handed over in each window, which is the denominator of everything.
      const [leadsToday, leadsWeek, leadsMonth] = await Promise.all([
         Lead.countDocuments({ owner: me, assignedAt: { $gte: dayStart } }),
         Lead.countDocuments({ owner: me, assignedAt: { $gte: weekStart } }),
         Lead.countDocuments({ owner: me, assignedAt: { $gte: monthStart } }),
      ]);

      const goal = await SalesGoal.findOne({ owner: me }).select('monthly').lean();
      const goalUnits = Number(goal?.monthly?.units) || 0;

      res.json({
         now,
         stages: STAGES,
         pipeline,
         bookings,
         counters: {
            today: { leads: leadsToday, booked: inRange(dayStart).length, value: value(inRange(dayStart)) },
            week: { leads: leadsWeek, booked: inRange(weekStart).length, value: value(inRange(weekStart)) },
            month: { leads: leadsMonth, booked: myContracts.length, value: value(myContracts) },
         },
         target: {
            goal: goalUnits,
            booked: myContracts.length,
            // Days left in the month, so the pace line can be written honestly.
            daysLeft: daysLeftInMonth(now),
         },
         reminders: reminders.map((l) => ({
            leadId: String(l._id),
            name: leadName(l),
            phone: l.phone || l.phoneNormalized,
            phoneNormalized: l.phoneNormalized,
            at: l.followUpAt,
            overdue: overdue(l.followUpAt),
         })),
         tasks: tasks.map((t) => ({
            _id: String(t._id),
            taskNo: t.taskNo || '',
            title: t.title,
            dueDate: t.dueDate,
            priority: t.priority,
            leadName: t.leadName || '',
            leadId: t.leadId ? String(t.leadId) : null,
            leadType: t.leadType || null,
            overdue: overdue(t.dueDate),
         })),
         waiting,
         quiet,
         fresh,
         quietAfterDays: QUIET_DAYS,
      });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

export default router;
