/**
 * What each person owes today, sent to them once each morning.
 *
 * The task board had 285 open tasks when this was written, 132 of them past
 * due — very nearly half. A list that far behind stops being a plan and starts
 * being wallpaper: nobody opens it, so nothing on it gets done, so more of it
 * goes overdue. The way out is not another column on a page people have
 * stopped visiting. It is a short message, in the morning, saying what is
 * late, what is due, and who is waiting for an answer.
 *
 * Three things go in it, and nothing else:
 *
 *   overdue    tasks past their due date, oldest first — the debt
 *   today      tasks due today — the plan
 *   waiting    customers who wrote and have had no reply — the money
 *
 * Managers get one extra section: what has been overdue for three days or
 * more, across everybody. That is the escalation. It is deliberately part of
 * the same message rather than a separate alarm, because an alarm that fires
 * every morning is one people learn to close.
 *
 * Nobody with an empty morning is written to. A digest that arrives saying
 * "nothing" teaches people the digest is safe to ignore, and then the one that
 * matters is ignored too.
 *
 * Nothing here throws. A brief that fails to send must never be the reason a
 * scheduler tick stops.
 */

import { Task, User, Lead, WhatsAppMessage } from '../models/index.js';
import { mailConfigured, sendMail } from './mail.js';
import { pushConfigured, pushToUser } from './push.js';
import { localHour } from './dailyDigest.js';

const escapeHtml = (s) => String(s ?? '')
   .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Overdue by this long is no longer slippage; it is stuck, and a manager
 *  should see it. */
export const ESCALATE_AFTER_DAYS = 3;

/** How many of anything a single message lists before it says "and N more".
 *  A brief that scrolls is a brief nobody finishes. */
export const LIST_LIMIT = 8;

/** Whole days late, counted from the due date. */
export function daysLate(dueDate, now = new Date()) {
   if (!dueDate) return 0;
   return Math.max(0, Math.floor((new Date(now) - new Date(dueDate)) / 864e5));
}

/** "3 days late", "1 day late", "today" — how a person says how late something is. */
export function lateness(dueDate, now = new Date()) {
   const days = daysLate(dueDate, now);
   if (days <= 0) return 'today';
   return days === 1 ? '1 day late' : `${days} days late`;
}

/** How long somebody has been waiting, in the same words the inbox uses. */
export function waitedFor(since, now = new Date()) {
   const mins = Math.max(0, Math.round((new Date(now) - new Date(since)) / 60000));
   if (mins < 60) return `${mins}m`;
   const hours = Math.round(mins / 60);
   if (hours < 48) return `${hours}h`;
   return `${Math.round(hours / 24)}d`;
}

/**
 * The message. Pure — no database, no mail server — so what it says can be
 * asserted directly.
 *
 * @param overdue  [{ taskNo, title, dueDate, leadName }]
 * @param today    the same, due today
 * @param waiting  [{ name, phone, since }]
 * @param stuck    team-wide, for managers: [{ taskNo, title, dueDate, who }]
 * @returns { subject, text, html, push, empty }
 */
export function buildDayBrief({ user, overdue = [], today = [], waiting = [], stuck = [], appUrl = '', now = new Date() }) {
   const empty = !overdue.length && !today.length && !waiting.length && !stuck.length;
   const firstName = String(user?.name || '').trim().split(/\s+/)[0] || 'there';

   /* The subject line is the whole message for most people — it is what shows
      on a phone before anything is opened — so it carries the numbers. */
   const parts = [];
   if (overdue.length) parts.push(`${overdue.length} overdue`);
   if (today.length) parts.push(`${today.length} due today`);
   if (waiting.length) parts.push(`${waiting.length} waiting on a reply`);
   /* A manager with nothing of their own still has the team's stuck work to
      look at, and "all clear" over a list of eleven late tasks reads as a lie.
      Their own work leads where they have some; the team's is the subject
      where they do not. */
   const subject = parts.length
      ? `Your morning: ${parts.join(', ')}`
      : stuck.length
         ? `Your morning: ${stuck.length} stuck ${ESCALATE_AFTER_DAYS}+ days across the team`
         : 'Your morning: all clear';

   const taskLine = (t) => `  ${t.taskNo ? `${t.taskNo} · ` : ''}${t.title}${t.leadName ? ` (${t.leadName})` : ''}`;
   const more = (list) => (list.length > LIST_LIMIT ? [`  …and ${list.length - LIST_LIMIT} more`] : []);

   const text = [
      `Morning ${firstName}.`,
      '',
      ...(overdue.length ? [
         `${overdue.length} task${overdue.length === 1 ? '' : 's'} overdue — oldest first:`,
         ...overdue.slice(0, LIST_LIMIT).map((t) => `${taskLine(t)} — ${lateness(t.dueDate, now)}`),
         ...more(overdue), '',
      ] : []),
      ...(today.length ? [
         'Due today:',
         ...today.slice(0, LIST_LIMIT).map(taskLine),
         ...more(today), '',
      ] : []),
      ...(waiting.length ? [
         `${waiting.length} customer${waiting.length === 1 ? '' : 's'} waiting for a reply — longest first:`,
         ...waiting.slice(0, LIST_LIMIT).map((w) => `  ${w.name} — waiting ${waitedFor(w.since, now)}`),
         ...more(waiting), '',
      ] : []),
      ...(stuck.length ? [
         `Across the team, stuck ${ESCALATE_AFTER_DAYS}+ days:`,
         ...stuck.slice(0, LIST_LIMIT).map((t) => `${taskLine(t)} — ${t.who}, ${lateness(t.dueDate, now)}`),
         ...more(stuck), '',
      ] : []),
      appUrl ? `Open the board: ${appUrl}/tasks` : 'Open the board in PurpleBox.',
      '',
      'PurpleBox',
   ].join('\n');

   const section = (title, rows, tone) => (rows.length ? `
      <p style="font-size:13px;font-weight:700;color:${tone};margin:16px 0 6px">${escapeHtml(title)}</p>
      <table style="border-collapse:collapse;width:100%">
        ${rows.slice(0, LIST_LIMIT).map((r) => `
          <tr>
            <td style="padding:4px 10px 4px 0;font-size:13px;color:#14081F">${escapeHtml(r.left)}</td>
            <td style="padding:4px 0;font-size:12px;color:#756E80;white-space:nowrap;text-align:right">${escapeHtml(r.right)}</td>
          </tr>`).join('')}
      </table>
      ${rows.length > LIST_LIMIT ? `<p style="font-size:12px;color:#756E80;margin:6px 0 0">and ${rows.length - LIST_LIMIT} more</p>` : ''}` : '');

   const label = (t) => `${t.taskNo ? `${t.taskNo} · ` : ''}${t.title}${t.leadName ? ` — ${t.leadName}` : ''}`;

   const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#14081F;max-width:560px">
      <p style="font-size:15px;font-weight:700;margin:0 0 2px">Morning ${escapeHtml(firstName)}.</p>
      <p style="font-size:13px;color:#756E80;margin:0">${escapeHtml(parts.length ? parts.join(' · ') : 'Nothing outstanding.')}</p>
      ${section(`Overdue (${overdue.length})`, overdue.map((t) => ({ left: label(t), right: lateness(t.dueDate, now) })), '#B91C1C')}
      ${section(`Due today (${today.length})`, today.map((t) => ({ left: label(t), right: '' })), '#14081F')}
      ${section(`Waiting for a reply (${waiting.length})`, waiting.map((w) => ({ left: w.name, right: `waiting ${waitedFor(w.since, now)}` })), '#9A3412')}
      ${section(`Stuck ${ESCALATE_AFTER_DAYS}+ days, across the team (${stuck.length})`, stuck.map((t) => ({ left: `${label(t)} — ${t.who}`, right: lateness(t.dueDate, now) })), '#B91C1C')}
      ${appUrl ? `<p style="margin-top:18px"><a href="${escapeHtml(`${appUrl}/tasks`)}" style="background:#5B2BC9;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600;display:inline-block">Open the board</a></p>` : ''}
    </div>`;

   return {
      subject,
      text,
      html,
      empty,
      push: {
         title: subject,
         body: overdue.length
            ? `Oldest: ${overdue[0].title} — ${lateness(overdue[0].dueDate, now)}`
            : waiting.length
               ? `${waiting[0].name} has been waiting ${waitedFor(waiting[0].since, now)}`
               : stuck.length
                  ? `Oldest across the team: ${stuck[0].title} — ${lateness(stuck[0].dueDate, now)}`
                  : 'Your day, at a glance.',
         url: '/tasks',
         tag: 'day-brief',
      },
   };
}

/** Midnight tonight, local, so "due today" means the calendar day people mean. */
export function endOfToday(now = new Date()) {
   const shift = (localHour(now) - new Date(now).getUTCHours() + 24) % 24;
   const local = new Date(new Date(now).getTime() + shift * 36e5);
   local.setUTCHours(23, 59, 59, 999);
   return new Date(local.getTime() - shift * 36e5);
}

/**
 * Who is owed an answer, grouped by the rep who owns them.
 *
 * The same rule the inbox uses: they wrote last, nobody replied, within the
 * last thirty days. Numbers are matched on their last nine digits, because
 * they are stored several different ways.
 */
export async function waitingByOwner({ now = new Date() } = {}) {
   const cutoff = new Date(new Date(now).getTime() - 30 * 864e5);
   const rows = await WhatsAppMessage.aggregate([
      { $match: { occurredAt: { $gte: cutoff } } },
      {
         $group: {
            _id: '$phoneNormalized',
            lastInboundAt: { $max: { $cond: [{ $eq: ['$direction', 'inbound'] }, '$occurredAt', null] } },
            lastOutboundAt: { $max: { $cond: [{ $eq: ['$direction', 'outbound'] }, '$occurredAt', null] } },
         },
      },
   ]);
   const unanswered = rows.filter((r) => r.lastInboundAt && (!r.lastOutboundAt || r.lastInboundAt > r.lastOutboundAt));
   if (!unanswered.length) return new Map();

   const suffix = (v) => {
      const d = String(v || '').replace(/\D/g, '');
      return d.length >= 9 ? d.slice(-9) : '';
   };
   const leads = await Lead.find({ owner: { $ne: null } })
      .select('fullName phone phoneNormalized owner whatsappProfileName').lean();
   const byNumber = new Map();
   for (const l of leads) {
      for (const candidate of [l.phoneNormalized, l.phone]) {
         const k = suffix(candidate);
         if (k && !byNumber.has(k)) byNumber.set(k, l);
      }
   }

   const out = new Map();
   for (const r of unanswered) {
      const lead = byNumber.get(suffix(r._id));
      if (!lead?.owner) continue;                    // nobody to tell
      const key = String(lead.owner);
      const name = String(lead.fullName || '').trim();
      const generated = /^whatsapp\s*contact/i.test(name);
      if (!out.has(key)) out.set(key, []);
      out.get(key).push({
         name: (generated ? '' : name) || lead.whatsappProfileName || lead.phone || r._id,
         phone: lead.phone || r._id,
         since: r.lastInboundAt,
      });
   }
   for (const list of out.values()) list.sort((a, b) => new Date(a.since) - new Date(b.since));
   return out;
}

/**
 * Build everybody's brief.
 *
 * One pass over the open tasks rather than a query per person: a dozen users
 * would otherwise be a dozen round trips to Atlas for a job that runs every
 * morning.
 */
export async function collectDayBriefs({ now = new Date() } = {}) {
   const users = await User.find({ isActive: true }).select('name email role dayBriefSentAt').lean();
   const open = await Task.find({ status: { $ne: 'done' }, dueDate: { $ne: null } })
      .select('taskNo title dueDate assignedTo leadName').lean();

   const todayEnds = endOfToday(now);
   const waiting = await waitingByOwner({ now });

   const overdueBy = new Map();
   const todayBy = new Map();
   const stuck = [];
   const nameOf = new Map(users.map((u) => [String(u._id), u.name || u.email || 'someone']));

   for (const t of open) {
      const key = String(t.assignedTo || '');
      const due = new Date(t.dueDate);
      if (due < now) {
         if (!overdueBy.has(key)) overdueBy.set(key, []);
         overdueBy.get(key).push(t);
         if (daysLate(t.dueDate, now) >= ESCALATE_AFTER_DAYS) {
            stuck.push({ ...t, who: nameOf.get(key) || 'unassigned' });
         }
      } else if (due <= todayEnds) {
         if (!todayBy.has(key)) todayBy.set(key, []);
         todayBy.get(key).push(t);
      }
   }
   const byOldest = (a, b) => new Date(a.dueDate) - new Date(b.dueDate);
   for (const list of overdueBy.values()) list.sort(byOldest);
   stuck.sort(byOldest);

   return users.map((user) => {
      const key = String(user._id);
      // Only a manager gets the team's stuck work; for everybody else it is
      // noise about tasks they cannot do anything about.
      const theirStuck = user.role === 'admin' ? stuck : [];
      return {
         user,
         brief: buildDayBrief({
            user,
            overdue: overdueBy.get(key) || [],
            today: todayBy.get(key) || [],
            waiting: waiting.get(key) || [],
            stuck: theirStuck,
            appUrl: process.env.APP_URL || '',
            now,
         }),
      };
   });
}

/**
 * Send this morning's briefs.
 *
 * Idempotent through `dayBriefSentAt` on the user: a restart at 07:30 cannot
 * produce a second one, because anybody written to since local midnight is
 * skipped. The same shape as every other scheduled job here.
 */
export async function runDayBriefs({ now = new Date(), dry = false } = {}) {
   const out = { sent: 0, skippedEmpty: 0, skippedAlready: 0, failed: 0, people: [] };
   const midnight = new Date(new Date(now).getTime() - localHour(now) * 36e5);

   let briefs = [];
   try {
      briefs = await collectDayBriefs({ now });
   } catch (e) {
      console.error('[DayBrief] could not build:', e.message);
      return out;
   }

   for (const { user, brief } of briefs) {
      if (brief.empty) { out.skippedEmpty += 1; continue; }
      if (user.dayBriefSentAt && new Date(user.dayBriefSentAt) >= midnight) { out.skippedAlready += 1; continue; }

      out.people.push({ name: user.name, email: user.email, subject: brief.subject });
      if (dry) continue;

      try {
         if (pushConfigured()) await pushToUser(user._id, brief.push).catch(() => null);
         if (mailConfigured() && user.email) {
            await sendMail({ to: user.email, subject: brief.subject, text: brief.text, html: brief.html });
         }
         await User.updateOne({ _id: user._id }, { $set: { dayBriefSentAt: new Date(now) } });
         out.sent += 1;
      } catch (e) {
         out.failed += 1;
         console.error(`[DayBrief] ${user.email}:`, e.message);
      }
   }
   return out;
}
