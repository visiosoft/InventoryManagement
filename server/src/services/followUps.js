/**
 * Follow-up reminders.
 *
 * A follow-up date sat in the database and nothing read it. The rep's board
 * showed what was due, but only to a rep who opened the board that morning —
 * a pull, when the whole point of scheduling a follow-up is that somebody is
 * told without having to remember to look.
 *
 * The reminder is a Task assigned to the lead's owner. That is deliberate:
 * tasks already appear on the board, already carry a due date and a link back
 * to the lead, and — unlike a message — nothing leaves the building. Nobody
 * gets WhatsApped or emailed by this.
 */

import { Lead, Task } from '../models/index.js';
import { dayKeyFor, dayRange } from './dailyDigest.js';

export const FOLLOW_UP_KINDS = ['date', 'week', 'month'];

const DAY_MS = 24 * 3600_000;

/**
 * The local day a follow-up should be raised on.
 *
 *   date  → that day
 *   week  → the Monday of that week
 *   month → the 1st of that month
 *
 * Returns 'YYYY-MM-DD', or '' when there is nothing to go on. Everything is
 * computed in Dubai local days, because a follow-up "on the 3rd" means the 3rd
 * where the person reading it is, not wherever the server happens to run.
 */
export function notifyDayFor(followUpAt, kind = 'date') {
  if (!followUpAt) return '';
  const at = new Date(followUpAt);
  if (Number.isNaN(at.getTime())) return '';

  const day = dayKeyFor(at);
  if (kind === 'month') return `${day.slice(0, 7)}-01`;
  if (kind !== 'week') return day;

  // Monday of the local week. getUTCDay on the shifted instant is the local
  // weekday; Sunday counts as the end of the week it closes, not the start of
  // the next one, so it steps back six days rather than forward one.
  const localMidnight = new Date(`${day}T00:00:00.000Z`);
  const weekday = localMidnight.getUTCDay();
  const backToMonday = weekday === 0 ? 6 : weekday - 1;
  return new Date(localMidnight.getTime() - backToMonday * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Is this lead's follow-up due to be raised as of `todayKey`?
 *
 * "On or before" rather than "on", so a reminder missed while the server was
 * down still goes out rather than being skipped for ever.
 */
export function isDue(lead = {}, todayKey = dayKeyFor()) {
  if (!lead.followUpAt) return false;
  if (lead.followUpNotifiedAt) return false;
  if (lead.status === 'won' || lead.status === 'lost') return false;
  if (!lead.owner) return false;
  const day = notifyDayFor(lead.followUpAt, lead.followUpKind);
  return Boolean(day) && day <= todayKey;
}

/** How the reminder describes itself on the board. */
export function taskFor(lead = {}, todayKey = dayKeyFor()) {
  const name = lead.fullName || lead.phone || 'this lead';
  const kind = lead.followUpKind || 'date';
  const asked = notifyDayFor(lead.followUpAt, kind);
  const when = kind === 'month' ? `this month (asked for ${asked.slice(0, 7)})`
    : kind === 'week' ? `this week (week of ${asked})`
      : `today (${asked})`;

  return {
    title: `Follow up with ${name}`,
    description: `Scheduled follow-up falls due ${when}.`,
    assignedTo: lead.owner,
    leadId: lead._id,
    leadType: 'storage',
    leadName: name,
    // Dated today rather than at the original date: a reminder raised late is
    // still due now, and dating it in the past buries it under overdue work.
    dueDate: dayRange(todayKey).from,
    priority: lead.temperature === 'hot' ? 'high' : 'medium',
    status: 'todo',
    createdByName: 'Follow-up reminder',
  };
}

/**
 * Raise a task for every follow-up that has come due.
 *
 * Idempotent through `followUpNotifiedAt`: the stamp is written with the task,
 * so a restart mid-run cannot produce a second reminder for the same lead.
 */
export async function runFollowUps({ now = new Date() } = {}) {
  const todayKey = dayKeyFor(now);

  const candidates = await Lead.find({
    followUpAt: { $ne: null },
    followUpNotifiedAt: null,
    status: { $nin: ['won', 'lost'] },
    owner: { $ne: null },
  }).select('fullName phone owner status temperature followUpAt followUpKind');

  const due = candidates.filter((l) => isDue(l, todayKey));
  const raised = [];

  for (const lead of due) {
    try {
      const task = await Task.create(taskFor(lead, todayKey));
      // updateOne rather than save(): the timeline is deliberately not loaded
      // above — it can run to hundreds of entries and none of it is needed to
      // decide whether a reminder is due.
      await Lead.updateOne(
        { _id: lead._id },
        {
          $set: { followUpNotifiedAt: now },
          $push: { timeline: { at: now, type: 'note', text: 'Follow-up reminder raised as a task.' } },
        }
      );
      raised.push({ lead: String(lead._id), task: String(task._id) });
    } catch (e) {
      console.error('[FollowUps] could not raise reminder for', String(lead._id), '::', e.message);
    }
  }

  return { day: todayKey, considered: candidates.length, due: due.length, raised };
}
