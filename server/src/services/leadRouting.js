/**
 * Who gets the next WhatsApp lead.
 *
 * Every inbound chat went to whichever user was created first — one admin
 * ended up owning 252 of them — so the reps who should have been working them
 * never saw them. This decides properly: by share, by availability, and by
 * what the shop has already handed out today.
 *
 * Weighted round-robin rather than a dice roll. "50%" has to hold over ten
 * leads, not just over ten thousand, so the next lead goes to whoever is
 * furthest behind their share right now. That also means a rep who was away
 * catches up on their own once they are back, without anybody adjusting
 * anything.
 *
 * Deliberately pure: given the rules, the day's tally and the clock, it
 * returns a decision and a reason. The reason is stored on the lead's
 * timeline, so "why did Sara get this one" has an answer.
 */

/** Minutes since midnight, in the shop's timezone rather than the server's. */
export function minutesInDay(at, timeZone = 'Asia/Dubai') {
   const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
   }).formatToParts(at);
   const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
   const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
   return hh * 60 + mm;
}

/** 0 = Sunday, matching the Date.getDay() the UI shows. */
export function weekdayIn(at, timeZone = 'Asia/Dubai') {
   const name = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }).format(at);
   return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/** "09:00" → 540. Anything unparseable is treated as no restriction. */
export function parseClock(v) {
   const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim());
   if (!m) return null;
   const mins = Number(m[1]) * 60 + Number(m[2]);
   return mins >= 0 && mins <= 24 * 60 ? mins : null;
}

/**
 * Is this rep on shift?
 *
 * No hours set means always — a rule nobody filled in should not quietly stop
 * somebody receiving work. A shift that ends before it starts runs past
 * midnight, which is how a night shift is written.
 */
export function withinWorkingHours(rule, at, timeZone = 'Asia/Dubai') {
   const hours = rule?.workingHours;
   if (!hours) return true;

   const days = Array.isArray(hours.days) ? hours.days : null;
   if (days && days.length && !days.includes(weekdayIn(at, timeZone))) return false;

   const start = parseClock(hours.start);
   const end = parseClock(hours.end);
   if (start == null || end == null) return true;

   const now = minutesInDay(at, timeZone);
   return start <= end ? now >= start && now < end : now >= start || now < end;
}

/** Absent for a stretch of dates, so nobody has to remember to switch it back. */
export function isAbsent(rule, at) {
   if (rule?.status === 'paused') return true;
   if (rule?.status !== 'absent') return false;
   const from = rule.absentFrom ? new Date(rule.absentFrom) : null;
   const to = rule.absentTo ? new Date(rule.absentTo) : null;
   // No range means absent until somebody says otherwise.
   if (!from && !to) return true;
   if (from && at < from) return false;
   if (to && at > to) return false;
   return true;
}

/**
 * The reps who could take a lead right now, and why the others could not.
 *
 * `counts` is how many each has already been given today, keyed by user id.
 */
export function availability({ rules = [], counts = {}, at = new Date(), timeZone = 'Asia/Dubai' } = {}) {
   const available = [];
   const excluded = [];

   for (const rule of rules) {
      const id = String(rule.user?._id ?? rule.user);
      const taken = Number(counts[id] || 0);

      if (rule.status !== 'active') { excluded.push({ id, reason: rule.status === 'paused' ? 'paused' : 'absent' }); continue; }
      if (isAbsent(rule, at)) { excluded.push({ id, reason: 'absent' }); continue; }
      if (!withinWorkingHours(rule, at, timeZone)) { excluded.push({ id, reason: 'off shift' }); continue; }
      if (rule.dailyCap > 0 && taken >= rule.dailyCap) { excluded.push({ id, reason: `daily cap of ${rule.dailyCap} reached` }); continue; }

      available.push({ id, rule, taken });
   }

   return { available, excluded };
}

/**
 * The share each available rep should be getting, once the unavailable ones
 * have had theirs handed on.
 *
 * Two ways to hand it on, chosen per rep, because the two are wanted for
 * different reasons: `pool` spreads it across whoever is left in proportion to
 * what they already had, so 50/25 stays 2:1 and becomes 66.7/33.3; `user`
 * gives the whole share to a named stand-in, which is what somebody means when
 * they say "Bilal's leads go to Ahmed while he is away".
 *
 * A stand-in who is themselves unavailable hands the share on again, so a
 * chain of absences does not strand it. The loop is guarded: two reps naming
 * each other would otherwise never terminate.
 */
export function targetShares({ rules = [], available = [] }) {
   const byId = new Map(rules.map((r) => [String(r.user?._id ?? r.user), r]));
   const availableIds = new Set(available.map((a) => a.id));
   const shares = new Map(available.map((a) => [a.id, Number(a.rule.sharePct) || 0]));

   let pooled = 0;
   for (const rule of rules) {
      const id = String(rule.user?._id ?? rule.user);
      if (availableIds.has(id)) continue;
      const share = Number(rule.sharePct) || 0;
      if (share <= 0) continue;

      let target = rule;
      const seen = new Set([id]);
      while (target?.fallbackMode === 'user' && target.fallbackUser) {
         const nextId = String(target.fallbackUser?._id ?? target.fallbackUser);
         if (seen.has(nextId)) { target = null; break; }
         seen.add(nextId);
         if (availableIds.has(nextId)) {
            shares.set(nextId, (shares.get(nextId) || 0) + share);
            target = undefined;
            break;
         }
         target = byId.get(nextId);
      }
      if (target === undefined) continue;   // handed to a named stand-in
      pooled += share;                       // nobody named, or the chain ran out
   }

   if (pooled > 0) {
      const base = [...shares.values()].reduce((s, v) => s + v, 0);
      if (base > 0) {
         for (const [id, v] of shares) shares.set(id, v + (pooled * v) / base);
      } else if (shares.size) {
         // Everyone left is on 0% — an even split beats nobody getting it.
         for (const [id] of shares) shares.set(id, pooled / shares.size);
      }
   }

   return shares;
}

/**
 * Pick the next owner.
 *
 * Whoever is furthest below their share of what has gone out today. On the
 * first lead of the day everyone is at zero, so the biggest share goes first —
 * which is what somebody expects from "Ahmed takes half of them".
 */
export function pickOwner({ rules = [], counts = {}, at = new Date(), timeZone = 'Asia/Dubai' } = {}) {
   const { available, excluded } = availability({ rules, counts, at, timeZone });
   if (!available.length) {
      return { ownerId: null, reason: excluded.length ? 'nobody is available' : 'no distribution rules are set', excluded };
   }

   const shares = targetShares({ rules, available });
   const totalShare = [...shares.values()].reduce((s, v) => s + v, 0);
   const handedOutToday = available.reduce((s, a) => s + a.taken, 0);

   let best = null;
   for (const a of available) {
      const share = totalShare > 0 ? (shares.get(a.id) || 0) / totalShare : 1 / available.length;
      // What they should have had by now, counting the lead about to go out.
      const owed = share * (handedOutToday + 1) - a.taken;
      const candidate = { ...a, share, owed };
      if (!best
         || candidate.owed > best.owed + 1e-9
         || (Math.abs(candidate.owed - best.owed) <= 1e-9 && candidate.taken < best.taken)) {
         best = candidate;
      }
   }

   return {
      ownerId: best.id,
      reason: `${Math.round(best.share * 100)}% share, ${best.taken} of ${handedOutToday} today`,
      share: best.share,
      excluded,
   };
}

/* ── Applying it to the database ─────────────────────────────────────────────
 *
 * Everything above is arithmetic on plain objects. What follows reads the
 * rules and the day's tally and answers the one question the webhook asks:
 * who owns this chat?
 */

import { Customer, Lead, LeadRoutingConfig, LeadRoutingRule } from '../models/index.js';
import { notifyLeadAssigned } from './leadNotify.js';

/** The last nine digits of a number, however it was written down. */
export function digitTail(v) {
   const d = String(v || '').replace(/\D/g, '');
   return d.length >= 9 ? d.slice(-9) : '';
}

/**
 * The instant the day began where the shop is.
 *
 * Built from the wall-clock date in that zone, not from the server's own
 * midnight: a chat at 01:00 in Dubai belongs to the Dubai day, and the server
 * is somewhere else. The counters reset here.
 */
export function startOfDayIn(at = new Date(), timeZone = 'Asia/Dubai') {
   /* Read the wall clock in that zone, then treat those numbers as if they
      were UTC. The difference from the real instant is the zone's offset, and
      it is measured rather than assumed, so somewhere that shifts for daylight
      saving still lands right.

      Deliberately not toLocaleString round-tripped through `new Date`: that
      parses in whatever zone the server happens to be in, so the answer would
      change with the host. */
   const p = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
   }).formatToParts(at);
   const n = (type) => Number(p.find((x) => x.type === type)?.value ?? 0);

   const asIfUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
   const offset = asIfUtc - at.getTime();
   return new Date(Date.UTC(n('year'), n('month') - 1, n('day')) - offset);
}

/** How many leads each rep has been given today. This is the counter — there
 *  is no separate tally to drift out of step with the leads themselves. */
export async function countsForToday({ at = new Date(), timeZone = 'Asia/Dubai' } = {}) {
   const since = startOfDayIn(at, timeZone);
   const rows = await Lead.aggregate([
      /* Only what the rules themselves handed out.
       *
       * Counting every WhatsApp lead of the day meant the tally started full
       * of leads the old system had already given away, so the engine thought
       * whoever had none was owed a catch-up and gave them six in a row. The
       * rota is about what it has done, so it counts its own work: everyone
       * starts level and the leads alternate one by one. */
      { $match: { autoAssigned: true, owner: { $ne: null }, createdAt: { $gte: since } } },
      { $group: { _id: '$owner', n: { $sum: 1 } } },
   ]);
   return Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
}

/**
 * Who should own a chat from this number.
 *
 * Returns `{ ownerId, reason }`. A null owner is a real answer, not a failure:
 * out of hours the assistant handles the conversation and the lead waits for
 * whoever is due it in the morning, rather than landing on somebody asleep.
 */
export async function routeInboundLead({ phoneNormalized, at = new Date() } = {}) {
   const config = (await LeadRoutingConfig.findOne().lean()) ?? {};
   if (!config.enabled) return { ownerId: null, reason: 'distribution is off', off: true };

   const timeZone = config.timeZone || 'Asia/Dubai';

   /* Somebody we already deal with is not a new lead.
    *
    * This is the "Customer" tag the inbox shows, resolved the way the rest of
    * the app resolves it: the last nine digits of the number. */
   if (config.existingCustomerUser && phoneNormalized) {
      /* Compared as digits, not as text.
       *
       * Numbers are stored however somebody typed them — "+971 52 130 2290",
       * "0521302290", "971521302290" — so a regex against the stored string
       * misses the spaces and finds nothing. Same rule the inbox uses to
       * decide whether to show the green Customer tag: the last nine digits,
       * compared after stripping everything that is not a digit. */
      const tail = digitTail(phoneNormalized);
      if (tail) {
         const customers = await Customer.find({}).select('_id fullName phone phones').lean();
         const known = customers.find((c) => [c.phone, ...(c.phones || [])].some((p) => digitTail(p) === tail));
         if (known) {
            return { ownerId: String(config.existingCustomerUser), reason: `existing customer (${known.fullName})`, existingCustomer: true };
         }
      }
   }

   const rules = await LeadRoutingRule.find({}).lean();
   const counts = await countsForToday({ at, timeZone });
   const decision = pickOwner({ rules, counts, at, timeZone });
   if (decision.ownerId) return decision;

   // Nobody on shift.
   if (config.outOfHoursMode === 'user' && config.outOfHoursUser) {
      return { ownerId: String(config.outOfHoursUser), reason: `${decision.reason} — out-of-hours contact`, outOfHours: true };
   }
   return {
      ownerId: null,
      reason: decision.reason,
      outOfHours: true,
      // The assistant answers and the lead stays unowned until somebody is on.
      leaveToAssistant: config.outOfHoursMode === 'ai',
   };
}

/**
 * Hand out anything the webhook left unowned.
 *
 * The webhook assigns as each chat arrives, which covers the ordinary case
 * without anybody opening a page. Two things slip past it: a chat that came in
 * out of hours, which is deliberately left unowned so it does not land on
 * somebody asleep, and anything that arrived while distribution was switched
 * off. Both sit there until a person notices.
 *
 * This is the sweep that notices instead. It runs on a timer, and does nothing
 * at all unless somebody is on shift — so an overnight enquiry is handed to
 * whoever is due it at the start of the morning rather than at 3am.
 *
 * Deliberately narrow: only WhatsApp leads, only ones nobody owns, only the
 * last few days. It will not reassign anything, and it will not sweep up a
 * lead somebody deliberately left unassigned months ago.
 */
export async function sweepUnassignedLeads({ at = new Date(), limit = 25 } = {}) {
   const config = await LeadRoutingConfig.findOne().lean();
   if (!config?.enabled) return { assigned: 0, reason: 'distribution is off' };

   const since = new Date(at.getTime() - 3 * 86400000);
   const waiting = await Lead.find({
      source: 'whatsapp',
      owner: null,
      createdAt: { $gte: since },
      status: { $nin: ['won', 'lost'] },
   }).sort({ createdAt: 1 }).limit(limit).lean();
   if (!waiting.length) return { assigned: 0, reason: 'nothing waiting' };

   let assigned = 0;
   for (const lead of waiting) {
      /* Re-read the tally each time, so a sweep of twenty respects the shares
         rather than giving them all to whoever was furthest behind first. */
      const decision = await routeInboundLead({ phoneNormalized: lead.phoneNormalized, at });
      if (!decision.ownerId) break;   // still nobody on shift; try again later

      await Lead.updateOne({ _id: lead._id }, {
         $set: {
            owner: decision.ownerId,
            assignedAt: at,
            autoAssigned: true,
            assignedBy: null,        // the rules, not a person
            ownerSeenAt: null,
            firstResponseAt: null,
         },
         $push: { timeline: { type: 'note', text: `Assigned by distribution rules — ${decision.reason}` } },
      });
      assigned += 1;

      notifyLeadAssigned({ lead, ownerId: decision.ownerId, reason: decision.reason })
         .catch((e) => console.error('[LeadRouting] notify failed:', e.message));
   }

   return { assigned, waiting: waiting.length };
}
