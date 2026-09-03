/**
 * How many of the leads sent to somebody actually closed.
 *
 * Deliberately readable by anybody signed in, unlike /sales-team, which is
 * manager-only. Recognition that only the manager can see is not recognition.
 *
 * The counting is kept honest by two decisions:
 *
 *   - "Closed" is a contract, not a status somebody set on themselves. It is
 *     counted off Contract.salesRep, the same field and the same bucketing as
 *     routes/salesTeam.js and the rep_performance report block, so two pages
 *     cannot tell a rep different numbers.
 *   - "Received" is leads that were deliberately handed to them (assignedAt),
 *     not every lead that carries their name. Every WhatsApp conversation
 *     auto-creates a lead with a default owner, and on this database that is
 *     the admin on 274 of 521 leads — counting those would make his conversion
 *     rate meaningless and everybody else's look better than it is.
 */

import { Router } from 'express';
import { Contract, Lead, User } from '../models/index.js';
import { awardsFor, rank, AWARDS } from '../services/awards.js';

const router = Router();

/** The window being asked about, and the one before it to compare against. */
export function periodRange(period = 'month', now = new Date()) {
   const end = new Date(now);
   const start = new Date(now);
   start.setHours(0, 0, 0, 0);

   if (period === 'all') {
      return { start: new Date(2000, 0, 1), end, prevStart: null, prevEnd: null, label: 'All time' };
   }
   if (period === 'year') {
      start.setMonth(0, 1);
      const prevStart = new Date(start); prevStart.setFullYear(start.getFullYear() - 1);
      return { start, end, prevStart, prevEnd: new Date(start), label: String(start.getFullYear()) };
   }
   if (period === 'quarter') {
      start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
      const prevStart = new Date(start); prevStart.setMonth(start.getMonth() - 3);
      return { start, end, prevStart, prevEnd: new Date(start), label: 'This quarter' };
   }
   start.setDate(1);
   const prevStart = new Date(start); prevStart.setMonth(start.getMonth() - 1);
   return { start, end, prevStart, prevEnd: new Date(start), label: 'This month' };
}

/** Middle value, so one forgotten lead does not define somebody's speed. */
function median(values) {
   if (!values.length) return 0;
   const s = [...values].sort((a, b) => a - b);
   const mid = Math.floor(s.length / 2);
   return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

router.get('/', async (req, res) => {
   try {
      const { start, end, prevStart, prevEnd, label } = periodRange(String(req.query.period || 'month'));

      const people = await User.find({ isActive: true, role: { $in: ['sales_rep', 'admin', 'accounts', 'staff'] } })
         .select('name email role').sort({ name: 1 }).lean();

      const closedIn = (from, to) => Contract.aggregate([
         { $match: { salesRep: { $ne: null }, createdAt: { $gte: from, $lte: to } } },
         { $group: { _id: '$salesRep', closed: { $sum: 1 }, value: { $sum: { $ifNull: ['$totalQuotation', 0] } } } },
      ]);

      const [now_, before, everBefore, leadRows] = await Promise.all([
         closedIn(start, end),
         prevStart ? closedIn(prevStart, prevEnd) : Promise.resolve([]),
         Contract.aggregate([
            { $match: { salesRep: { $ne: null }, createdAt: { $lt: start } } },
            { $group: { _id: '$salesRep', n: { $sum: 1 } } },
         ]),
         /* Leads handed to somebody in this window. assignedAt, not createdAt:
            what is being measured is what they were given, when they were
            given it. */
         Lead.find({ assignedAt: { $gte: start, $lte: end }, owner: { $ne: null } })
            .select('owner assignedAt firstResponseAt attempts status').lean(),
      ]);

      const get = (list, id) => list.find((r) => String(r._id) === String(id));

      const rows = people.map((u) => {
         const mine = leadRows.filter((l) => String(l.owner) === String(u._id));
         const responses = mine
            .filter((l) => l.firstResponseAt && l.assignedAt)
            .map((l) => Math.round((new Date(l.firstResponseAt) - new Date(l.assignedAt)) / 60000))
            .filter((m) => m >= 0);
         const c = get(now_, u._id);
         return {
            userId: String(u._id),
            name: u.name || u.email,
            role: u.role,
            received: mine.length,
            contacted: mine.filter((l) => (l.attempts || []).length > 0).length,
            /* Two different things, kept apart.
             *
             * `closed` is every contract credited to them, which is the deal
             * count. `closedFromLeads` is how many of the leads they were
             * handed in this window ended up won — the question actually being
             * asked, and the only one a conversion rate can be built from.
             * Dividing deals by leads received gave Mahmoud Gohar 450%: he
             * raised 18 contracts and was handed 4 leads. */
            closedFromLeads: mine.filter((l) => l.status === 'won').length,
            closed: c?.closed ?? 0,
            value: Math.round(c?.value ?? 0),
            medianResponseMins: median(responses),
            // How many that median is built from — a fast answer to three
            // leads is not a fast rep. See MIN_REPLIES_FOR_SPEED.
            responsesMeasured: responses.length,
            closedPreviously: get(before, u._id)?.closed ?? 0,
            closedEverBefore: (get(everBefore, u._id)?.n ?? 0) > 0,
         };
      });

      // Nobody with nothing at all: an empty row is not a person on a board.
      const active = rows.filter((r) => r.received || r.closed || r.value);
      const ranked = rank(active);
      const awards = awardsFor(active, { hasPreviousPeriod: Boolean(prevStart) });

      res.json({
         period: String(req.query.period || 'month'),
         label,
         from: start,
         to: end,
         rows: ranked.map((r) => ({
            ...r,
            conversionPct: r.received ? Math.round((r.closedFromLeads / r.received) * 100) : null,
            awards: awards[r.userId] ?? [],
         })),
         totals: {
            closed: active.reduce((s, r) => s + r.closed, 0),
            value: active.reduce((s, r) => s + r.value, 0),
            received: active.reduce((s, r) => s + r.received, 0),
         },
         awardTypes: AWARDS,
      });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

export default router;
