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

/** What the follow-up is, in words, for whichever task carries it. */
export function describeFollowUp(lead = {}) {
  const kind = lead.followUpKind || 'date';
  const day = notifyDayFor(lead.followUpAt, kind);
  if (!day) return '';
  const asked = lead.followUpAt ? dayKeyFor(lead.followUpAt) : day;

  const when = kind === 'month' ? `some time in ${asked.slice(0, 7)} — raised on the 1st (${day})`
    : kind === 'week' ? `during the week of ${day} — raised on the Monday`
      : `on ${day}`;

  const lines = [`Follow up ${when}.`];
  if (lead.temperature) lines.push(`Temperature: ${lead.temperature}.`);
  if (lead.status) lines.push(`Stage when scheduled: ${lead.status}.`);
  const notes = String(lead.notes || '').trim();
  if (notes) lines.push(`Notes: ${notes.slice(0, 1000)}`);
  return lines.join('\n');
}

/** How the reminder describes itself on the board. */
export function taskFor(lead = {}, todayKey = dayKeyFor()) {
  const name = lead.fullName || lead.phone || 'this lead';

  return {
    title: `Follow up with ${name}`,
    description: describeFollowUp(lead),
    assignedTo: lead.owner,
    leadId: lead._id,
    leadType: 'storage',
    leadName: name,
    // The day it is meant to be acted on, or today if that has already passed:
    // a task dated in the past buries itself under genuinely overdue work.
    dueDate: dayRange(maxDay(notifyDayFor(lead.followUpAt, lead.followUpKind), todayKey)).from,
    priority: lead.temperature === 'hot' ? 'high' : 'medium',
    status: 'todo',
    createdByName: 'Follow-up reminder',
  };
}

/** The later of two 'YYYY-MM-DD' days — they sort lexically, so this is a max. */
function maxDay(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * The same arrangement for a site visit.
 *
 * A viewing is a fixed appointment, so there is no week or month about it and
 * no reminder rule to apply — the task is simply due on the day they are
 * coming.
 */
export async function syncSiteVisitTask(lead) {
  const existing = lead.siteVisitTaskId ? await Task.findById(lead.siteVisitTaskId) : null;

  if (!lead.siteVisitAt || !lead.owner || lead.status === 'won' || lead.status === 'lost') {
    if (existing && existing.status === 'todo') await existing.deleteOne();
    lead.siteVisitTaskId = null;
    return null;
  }

  const name = lead.fullName || lead.phone || 'this lead';
  const day = dayKeyFor(lead.siteVisitAt);
  const fields = {
    title: `Site visit — ${name}`,
    description: `Coming to see the place on ${day}.${lead.notes ? ` Notes: ${String(lead.notes).slice(0, 1000)}` : ''}`,
    assignedTo: lead.owner,
    leadId: lead._id,
    leadType: 'storage',
    leadName: name,
    dueDate: dayRange(day).from,
    // Somebody is turning up in person: that outranks a call to make.
    priority: 'high',
    status: 'todo',
    createdByName: 'Site visit',
  };

  // Somebody already picked the task up or finished it. Leave their work alone
  // and let the next change start a fresh one.
  if (existing && existing.status !== 'todo') {
    lead.siteVisitTaskId = null;
  } else if (existing) {
    Object.assign(existing, fields);
    await existing.save();
    return existing;
  }

  const task = await Task.create(fields);
  lead.siteVisitTaskId = task._id;
  return task;
}

/**
 * Keep the lead's follow-up task in step with the follow-up itself.
 *
 * Called whenever the date or its kind changes, so the task exists from the
 * moment somebody schedules it rather than appearing on the morning it falls
 * due. Moving the date moves the same task; clearing the follow-up takes it
 * away again, unless somebody has already worked it.
 *
 * `lead` is a Mongoose document — this sets followUpTaskId on it but leaves
 * saving to the caller, so one save covers the whole edit.
 */
export async function syncFollowUpTask(lead) {
  const existing = lead.followUpTaskId ? await Task.findById(lead.followUpTaskId) : null;

  // Nothing to remind anybody about any more.
  if (!lead.followUpAt || !lead.owner || lead.status === 'won' || lead.status === 'lost') {
    if (existing && existing.status === 'todo') await existing.deleteOne();
    lead.followUpTaskId = null;
    return null;
  }

  const fields = taskFor(lead);

  // Somebody already picked the task up or finished it. Leave their work
  // alone and let the next change start a fresh one.
  if (existing && existing.status !== 'todo') {
    lead.followUpTaskId = null;
  } else if (existing) {
    existing.title = fields.title;
    existing.description = fields.description;
    existing.dueDate = fields.dueDate;
    existing.priority = fields.priority;
    existing.assignedTo = fields.assignedTo;
    existing.leadName = fields.leadName;
    await existing.save();
    return existing;
  }

  const task = await Task.create(fields);
  lead.followUpTaskId = task._id;
  return task;
}

/**
 * Raise a task for every follow-up that has come due.
 *
 * Idempotent through `followUpNotifiedAt`: the stamp is written with the task,
 * so a restart mid-run cannot produce a second reminder for the same lead.
 */
export async function runFollowUps({ now = new Date() } = {}) {
  const todayKey = dayKeyFor(now);

  // followUpTaskId null: a follow-up scheduled through the app already has its
  // task from the moment it was set. This catches the ones that do not — leads
  // scheduled before that existed, or whose task somebody deleted.
  const candidates = await Lead.find({
    followUpAt: { $ne: null },
    followUpNotifiedAt: null,
    followUpTaskId: null,
    status: { $nin: ['won', 'lost'] },
    owner: { $ne: null },
  }).select('fullName phone owner status temperature notes followUpAt followUpKind');

  const due = candidates.filter((l) => isDue(l, todayKey));
  const raised = [];

  for (const lead of due) {
    try {
      const task = await Task.create(taskFor(lead, todayKey));
      // Held so a later edit moves this task instead of adding another.
      // updateOne rather than save(): the timeline is deliberately not loaded
      // above — it can run to hundreds of entries and none of it is needed to
      // decide whether a reminder is due.
      await Lead.updateOne(
        { _id: lead._id },
        {
          $set: { followUpNotifiedAt: now, followUpTaskId: task._id },
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
