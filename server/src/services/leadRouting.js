/**
 * Who gets the next lead: strictly the weekly roster calendar.
 *
 * Whoever is on the calendar at that hour takes it. An hour with its own
 * split (70 / 15 / 15) is drawn by those percentages; an hour without one is
 * shared evenly, the reps on it taking turns. Nobody on: the out-of-hours
 * people take turns, or, with none chosen, the lead waits unassigned until a
 * shift starts.
 *
 * Deliberately pure down to the database section: given the roster, the
 * tallies and the clock, it returns a decision and a reason. The reason is
 * stored on the lead's timeline, so "why did Sara get this one" has an answer.
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

/** On the roster calendar at this instant. No shifts means off. */
export function onShift(rule, at, timeZone = 'Asia/Dubai') {
   return onRosterShift(rule?.weeklyShifts, weekdayIn(at, timeZone), minutesInDay(at, timeZone));
}

/**
 * On shift by the weekly roster, at this weekday and minute of the day.
 *
 * A shift whose end is not after its start runs past midnight: Saturday
 * 22:00-06:00 covers Saturday night and the small hours of Sunday.
 */
export function onRosterShift(shifts, weekday, minute) {
   for (const sh of shifts || []) {
      const start = parseClock(sh.start);
      const end = parseClock(sh.end);
      const day = Number(sh.day);
      if (start == null || end == null || !(day >= 0 && day <= 6)) continue;
      if (start < end) {
         if (weekday === day && minute >= start && minute < end) return true;
      } else if ((weekday === day && minute >= start) || (weekday === (day + 1) % 7 && minute < end)) {
         return true;
      }
   }
   return false;
}

/** A roster as sent by the settings page, cleaned: valid days and clocks only. */
export function cleanWeeklyShifts(input) {
   if (!Array.isArray(input)) return [];
   return input
      .map((sh) => ({ day: Number(sh?.day), start: String(sh?.start || '').trim(), end: String(sh?.end || '').trim() }))
      .filter((sh) => Number.isInteger(sh.day) && sh.day >= 0 && sh.day <= 6 && parseClock(sh.start) != null && parseClock(sh.end) != null && sh.start !== sh.end)
      .slice(0, 60);
}

/**
 * Who is on the calendar right now, and who is not.
 *
 * `counts` is how many each has been given today, keyed by user id. `exclude`
 * leaves somebody out of this one decision (a lead being taken off them).
 */
export function availability({ rules = [], counts = {}, at = new Date(), timeZone = 'Asia/Dubai', exclude = [] } = {}) {
   const available = [];
   const excluded = [];
   const skip = new Set([...exclude].filter(Boolean).map(String));
   for (const rule of rules) {
      const id = String(rule.user?._id ?? rule.user);
      if (skip.has(id)) { excluded.push({ id, reason: 'already had it' }); continue; }
      if (!onShift(rule, at, timeZone)) { excluded.push({ id, reason: 'off shift' }); continue; }
      available.push({ id, rule, taken: Number(counts[id] || 0) });
   }
   return { available, excluded };
}

/** The next owner, by the calendar: see pickForHour. */
export function pickOwner({ rules = [], counts = {}, hourCounts = {}, at = new Date(), timeZone = 'Asia/Dubai', exclude = [], splits = [], random } = {}) {
   const { available, excluded } = availability({ rules, counts, at, timeZone, exclude });
   if (!available.length) {
      return { ownerId: null, reason: rules.length ? 'nobody is on the roster at this hour' : 'nobody is on the roster', excluded };
   }
   return pickForHour({ available, excluded, hourCounts, at, timeZone, splits, random });
}

/**
 * Out of hours: the chosen people take turns (fewest this hour, then fewest
 * today). None chosen: null, and the lead waits for the next shift.
 */
export function pickOutOfHours({ userIds = [], counts = {}, hourCounts = {} } = {}) {
   const ids = [...new Set(userIds.map(String).filter(Boolean))];
   if (!ids.length) return null;
   const available = ids.map((id) => ({ id, taken: Number(counts[id] || 0) }));
   const d = pickForHour({ available, hourCounts, splits: [] });
   return { ...d, reason: ids.length > 1 ? `out of hours — ${d.reason}` : 'out of hours' };
}

/* ── Per hour, as set on the roster calendar ─────────────────────────────────
 *
 * Each hour of the week can carry its own split between the reps on then
 * ("Mon 3pm: Randa 70, Mahmoud 15, Emad 15"). An hour without one is shared
 * evenly: the reps on take turns, one by one.
 */

/** The calendar cell an instant falls in: weekday (0 = Sunday) and hour, in the shop's zone. */
export function hourCell(at = new Date(), timeZone = 'Asia/Dubai') {
   return { day: weekdayIn(at, timeZone), hour: Math.floor(minutesInDay(at, timeZone) / 60) };
}

/** Splits as sent by the calendar, cleaned: real cells, real people, positive percentages. */
export function cleanHourSplits(input) {
   if (!Array.isArray(input)) return [];
   const seen = new Map();
   for (const c of input) {
      const day = Number(c?.day);
      const hour = Number(c?.hour);
      if (!Number.isInteger(day) || day < 0 || day > 6 || !Number.isInteger(hour) || hour < 0 || hour > 23) continue;
      const shares = (Array.isArray(c.shares) ? c.shares : [])
         .map((x) => ({ user: String(x?.user || ''), pct: Math.round(Number(x?.pct) * 10) / 10 }))
         .filter((x) => /^[0-9a-f]{24}$/i.test(x.user) && x.pct > 0 && x.pct <= 100);
      if (shares.length) seen.set(`${day}:${hour}`, { day, hour, shares });
   }
   return [...seen.values()];
}

/**
 * Even split: strict turns within the hour — whoever has had fewest this hour
 * goes next, and between two level, whoever has had fewer today, so the first
 * lead of each hour does not always go to the same person.
 *
 * Custom split: each lead is a draw weighted by the percentages. With a lead
 * or two an hour, strict turns would give the 70% rep every one; a weighted
 * draw lands at 70/15/15 over the week.
 */
export function pickForHour({ available = [], excluded = [], hourCounts, at = new Date(), timeZone = 'Asia/Dubai', splits = [], random }) {
   const { day, hour } = hourCell(at, timeZone);
   const cell = (splits || []).find((c) => c.day === day && c.hour === hour);
   const pctOf = (id) => Number(cell?.shares?.find((x) => String(x.user) === id)?.pct) || 0;
   const weighted = cell ? available.map((a) => ({ a, w: pctOf(a.id) })).filter((x) => x.w > 0) : [];
   if (weighted.length) {
      const total = weighted.reduce((s, x) => s + x.w, 0);
      let roll = (typeof random === 'function' ? random() : Math.random()) * total;
      let pick = weighted[weighted.length - 1];
      for (const x of weighted) { if (roll < x.w) { pick = x; break; } roll -= x.w; }
      const share = pick.w / total;
      return { ownerId: pick.a.id, reason: `${Math.round(share * 100)}% of this hour (set on the roster)`, share, excluded };
   }
   const hc = hourCounts || {};
   let best = null;
   for (const a of available) {
      const thisHour = Number(hc[a.id] || 0);
      if (!best || thisHour < best.thisHour || (thisHour === best.thisHour && a.taken < best.taken)) best = { ...a, thisHour };
   }
   return {
      ownerId: best.id,
      reason: `taking turns: ${best.thisHour} this hour, ${best.taken} today, ${available.length} on`,
      share: 1 / available.length,
      excluded,
   };
}

/* ── Applying it to the database ─────────────────────────────────────────────
 *
 * Everything above is arithmetic on plain objects. What follows reads the
 * rules and the day's tally and answers the one question the webhook asks:
 * who owns this chat?
 */

import { Lead, LeadRoutingConfig, LeadRoutingRule, User } from '../models/index.js';
import { notifyLeadAssigned } from './leadNotify.js';
import { starterOfChat, keptNote } from './chatStarter.js';

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
   return countsSince(startOfDayIn(at, timeZone));
}

/** The same count from a given instant — the start of this hour, for taking turns within it. */
export async function countsSince(since) {
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

/** The instant the current hour began. */
export const startOfHour = (at = new Date()) => new Date(Math.floor(at.getTime() / 3600000) * 3600000);

/**
 * Who should own a chat from this number — strictly by the roster calendar.
 *
 * Returns `{ ownerId, reason }`. Out of hours it goes to the out-of-hours
 * people, taking turns; with none chosen the owner is null, a real answer:
 * the lead waits and the sweep below hands it out when a shift starts.
 */
export async function routeInboundLead({ at = new Date(), deps = {} } = {}) {
   // `deps` lets tests run the whole decision without a database.
   const d = {
      config: async () => (await LeadRoutingConfig.findOne().lean()) ?? {},
      rules: () => LeadRoutingRule.find({}).lean(),
      activeIds: async (ids) => (await User.find({ _id: { $in: ids }, isActive: { $ne: false } }).select('_id').lean()).map((u) => String(u._id)),
      counts: (opts) => countsForToday(opts),
      hourCounts: (since) => countsSince(since),
      random: Math.random,
      ...deps,
   };
   const config = await d.config();
   if (!config.enabled) return { ownerId: null, reason: 'distribution is off', off: true };

   const timeZone = config.timeZone || 'Asia/Dubai';
   // Only people who can actually take a lead: a deactivated user left on the roster is not handed anything.
   const allRules = await d.rules();
   const outIds = outOfHoursIds(config);
   const live = new Set(await d.activeIds([...allRules.map((r) => String(r.user?._id ?? r.user)), ...outIds]));
   const rules = allRules.filter((r) => live.has(String(r.user?._id ?? r.user)));
   const [counts, hourCounts] = await Promise.all([d.counts({ at, timeZone }), d.hourCounts(startOfHour(at))]);
   const decision = pickOwner({ rules, counts, hourCounts, at, timeZone, splits: config.hourSplits || [], random: d.random });
   if (decision.ownerId) return decision;

   const out = pickOutOfHours({ userIds: outIds.filter((id) => live.has(id)), counts, hourCounts });
   if (out) return { ...out, outOfHours: true };
   return { ownerId: null, reason: `${decision.reason} — waits for the next shift`, outOfHours: true };
}

/** The out-of-hours people: the list, or the single person the old setting named. */
export function outOfHoursIds(config = {}) {
   const list = (config.outOfHoursUsers || []).map(String).filter(Boolean);
   if (list.length) return list;
   return config.outOfHoursMode === 'user' && config.outOfHoursUser ? [String(config.outOfHoursUser)] : [];
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
export async function sweepUnassignedLeads({ at = new Date(), limit = 25, deps = {} } = {}) {
   // `deps` lets tests run the sweep without a database.
   const d = {
      config: () => LeadRoutingConfig.findOne().lean(),
      waiting: () => Lead.find({ owner: null, status: { $nin: ['won', 'lost', 'already_customer'] } }).sort({ createdAt: 1 }).limit(limit).lean(),
      starter: (phone) => starterOfChat(phone),
      route: (lead) => routeInboundLead({ phoneNormalized: lead.phoneNormalized, at }),
      claim: (lead, set, note) => Lead.updateOne({ _id: lead._id, owner: null }, { $set: set, $push: { timeline: { type: 'note', text: note } } }),
      notify: (lead, ownerId, reason) => notifyLeadAssigned({ lead, ownerId, reason }),
      leadless: (n) => leadsForChatsWithoutOne({ at, limit: n }),
      ...deps,
   };
   const config = await d.config();
   if (!config?.enabled) return { assigned: 0, reason: 'distribution is off' };

   /* Every lead nobody owns gets one — whatever its age or where it came
      from. This used to look back one day only, so a lead that arrived when
      nobody was on shift and was not picked up by the next morning stayed
      unassigned for good (16 of them, 7 Sep – 3 Oct). Closed leads (won,
      lost) and existing customers are not handed out. Batches of `limit`
      per run, oldest first, so a backlog spreads over a few runs instead of
      landing on the reps at once. */
   const waiting = await d.waiting();

   let assigned = 0;
   let nobodyOnShift = false;
   for (const lead of waiting) {
      /* Re-read the tally each time, so a sweep of twenty takes turns
         rather than giving them all to the same person. */
      /* A rep who messaged this chat from their CRM login keeps it; the rules
         place the rest. A lead someone assigned by hand already has an owner
         and never reaches this loop. */
      const starter = await Promise.resolve(d.starter(lead.phoneNormalized)).catch(() => null);
      const decision = starter
         ? { ownerId: starter._id, reason: keptNote(starter.name), kept: true }
         : await d.route(lead);
      // Nobody on the roster: try again later. The out-of-hours people take
      // new leads as they arrive, never the backlog this sweep would hand out.
      if (!decision.ownerId || decision.outOfHours) { nobodyOnShift = true; break; }

      // owner: null in the filter too — a lead somebody was given in the meantime
      // is never overwritten, even in a race with this sweep.
      const claimed = await d.claim(lead, {
         owner: decision.ownerId,
         assignedAt: at,
         autoAssigned: !decision.kept,
         assignedBy: null,        // the rules, not a person
         ownerSeenAt: null,
         firstResponseAt: null,
      }, decision.kept ? decision.reason : `Assigned by distribution rules — ${decision.reason}`);
      if (!claimed.modifiedCount) continue;   // somebody got it first; leave it
      assigned += 1;

      Promise.resolve(d.notify(lead, decision.ownerId, decision.reason))
         .catch((e) => console.error('[LeadRouting] notify failed:', e.message));
   }

   // Chats with no lead at all (one of ours that the customer never answered,
   // from before outbound chats created leads): give them one, distributed.
   const created = nobodyOnShift ? 0 : await Promise.resolve(d.leadless(Math.max(0, limit - assigned)))
      .catch((e) => { console.error('[LeadRouting] leadless chats:', e.message); return 0; });

   return { assigned: assigned + created, waiting: waiting.length, created };
}

/**
 * WhatsApp chats from the last 30 days that have no lead behind them, turned
 * into leads the distribution rules assign. Tenants are left out: a signed
 * customer writing about an invoice is not a sales lead, and the inbox does
 * not count them as unassigned either.
 */
async function leadsForChatsWithoutOne({ at = new Date(), limit = 25 } = {}) {
   if (limit <= 0) return 0;
   const { WhatsAppMessage, WhatsAppBlockedNumber } = await import('../models/index.js');
   const since = new Date(at.getTime() - 30 * 86400000);
   const phones = await WhatsAppMessage.distinct('phoneNormalized', { occurredAt: { $gte: since } });
   if (!phones.length) return 0;
   const withLead = new Set(await Lead.find({ phoneNormalized: { $in: phones } }, null, { includeDeleted: true }).distinct('phoneNormalized'));
   const blocked = new Set(WhatsAppBlockedNumber ? await WhatsAppBlockedNumber.distinct('phoneNormalized').catch(() => []) : []);
   const { isExistingCustomerPhone } = await import('./customerLeads.js');
   const { createLeadFromWhatsAppPhone } = await import('./whatsappLeadSync.js');

   let created = 0;
   for (const phone of phones) {
      if (created >= limit) break;
      if (!phone || withLead.has(phone) || blocked.has(phone)) continue;
      if (await isExistingCustomerPhone(phone).catch(() => false)) continue;
      const sample = await WhatsAppMessage.findOne({ phoneNormalized: phone }).sort({ occurredAt: -1 }).select('phone direction').lean();
      const starter = await starterOfChat(phone).catch(() => null);
      const lead = await createLeadFromWhatsAppPhone({
         phone: sample?.phone || phone,
         phoneNormalized: phone,
         status: 'new',
         timelineText: 'Lead created for a WhatsApp chat that had none, so it could be assigned',
         ...(starter ? { ownerId: starter._id, ownerNote: keptNote(starter.name) } : {}),
      }).catch((e) => { console.error('[LeadRouting] create for chat:', e.message); return null; });
      if (!lead) break;            // nobody on shift, or distribution off
      if (!lead.owner) break;      // created but nobody available: stop, retry later
      await WhatsAppMessage.updateMany({ phoneNormalized: phone, lead: null }, { $set: { lead: lead._id } });
      created += 1;
   }
   return created;
}

/** Whether the coverage calendar has been saved for anybody yet. */
export async function rosterInUse() {
   return !!(await LeadRoutingRule.exists({ rosterManaged: true }));
}

/**
 * A new sales rep joins the roster by themselves — but off: no hours, so no
 * leads until an admin gives them hours on the calendar.
 *
 * Somebody an admin took out of the rotation earlier (a soft-deleted row) is
 * not put back: that was a decision.
 */
export async function addRepToRotation(userId, { Rule = LeadRoutingRule } = {}) {
   if (!userId) return null;
   if (await Rule.findOne({ user: userId }, null, { includeDeleted: true }).select('_id').lean()) return null;
   return Rule.create({ user: userId, status: 'active', rosterManaged: true, weeklyShifts: [] });
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STEP_MIN = 15;

/** "14:00", or "Mon 08:00" when it is not today. */
function whenLabel(t, at, timeZone) {
   const m = minutesInDay(t, timeZone);
   const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
   return weekdayIn(t, timeZone) === weekdayIn(at, timeZone) && t - at < 86400000 ? hhmm : `${DAY_NAMES[weekdayIn(t, timeZone)]} ${hhmm}`;
}

/**
 * Who takes new leads right now, until when, and who comes on next — the
 * roster read forward for the coming week in 15-minute steps. Daily caps are
 * left out of the look-ahead (they reset), absences and pauses are not.
 *
 * activity: { [userId]: { lastReplyAt, repliesToday, waiting } }
 */
export function coverageNow({ rules = [], counts = {}, at = new Date(), timeZone = 'Asia/Dubai', activity = {} } = {}) {
   const onAt = (t) => new Set(availability({ rules, at: t, timeZone }).available.map((a) => a.id));
   const { available, excluded } = availability({ rules, counts, at, timeZone });
   const nowIds = new Set(available.map((a) => a.id));

   // Step forward: when each rep next changes, and the handovers in the next 24h.
   const changeAt = {};
   const handovers = [];
   let prev = onAt(at);
   const start = new Date(Math.ceil(at.getTime() / (STEP_MIN * 60000)) * STEP_MIN * 60000);
   for (let t = start; t - at <= 7 * 86400000; t = new Date(t.getTime() + STEP_MIN * 60000)) {
      const cur = onAt(t);
      const joins = [...cur].filter((id) => !prev.has(id));
      const leaves = [...prev].filter((id) => !cur.has(id));
      for (const id of [...joins, ...leaves]) if (!changeAt[id]) changeAt[id] = t;
      if ((joins.length || leaves.length) && t - at <= 86400000 && handovers.length < 8) {
         handovers.push({ at: t, label: whenLabel(t, at, timeZone), joins, leaves, onAfter: [...cur] });
      }
      prev = cur;
   }

   const reps = rules.map((r) => {
      const id = String(r.user?._id ?? r.user);
      const on = nowIds.has(id);
      const next = changeAt[id];
      const a = activity[id] || {};
      return {
         id,
         name: r.user?.name || '',
         color: r.color || '',
         on,
         why: on ? null : excluded.find((e) => e.id === id)?.reason || 'off shift',
         until: on && next ? whenLabel(next, at, timeZone) : null,
         nextOn: !on && next ? whenLabel(next, at, timeZone) : null,
         leadsToday: Number(counts[id] || 0),
         lastReplyAt: a.lastReplyAt || null,
         repliesToday: a.repliesToday || 0,
         waiting: a.waiting || 0,
      };
   }).sort((x, y) => (Number(y.on) - Number(x.on)) || x.name.localeCompare(y.name));

   return { reps, handovers, nobodyOn: nowIds.size === 0 };
}

/**
 * The dashboard's traffic light. Green: a rep is on shift to take new leads.
 * Amber: nobody is, but the AI assistant is answering customers by itself.
 * Red: nobody is on and nothing is answering.
 */
export function coverageSignal({ nobodyOn, aiAnswering }) {
   if (!nobodyOn) return 'green';
   return aiAnswering ? 'amber' : 'red';
}
