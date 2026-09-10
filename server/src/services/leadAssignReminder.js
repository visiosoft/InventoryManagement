/**
 * The reminder for a lead somebody was handed and never actually touched.
 *
 * services/leadNotify.js tells a rep the moment a lead becomes theirs.
 * services/leadSla.js reassigns one nobody has answered within half an hour.
 * Neither covers the case in between: a rep who saw the push, meant to reply,
 * and got pulled into something else — the lead stays theirs (distribution is
 * not the problem here, attention is), so nothing reassigns it, and nothing
 * else ever mentions it again.
 *
 * "Actually touched" is `firstResponseAt` — the same field services/leadSla.js
 * already trusts, set by logging an attempt, moving the stage, or replying on
 * WhatsApp (services/aiBot.js's markFirstResponse). Not "opened it", the same
 * rule everywhere else in this codebase that measures a response: a measure
 * you can satisfy by reading a screen measures nothing.
 *
 * Batched per rep and rate-limited to one reminder per lead per day, for the
 * exact reason services/quietNudge.js and services/leadSla.js already batch
 * theirs — services/staffMail.js measured what happens otherwise.
 *
 * Nothing here throws.
 */

import { Lead } from '../models/index.js';
import { humanWait } from './leadSla.js';
import { leadLabel, pendingAssignmentBadge } from './leadNotify.js';
import { expoPushConfigured, pushExpoToUser } from './expoPush.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const REMINDER_DEFAULTS = { thresholdHours: 3 };

/** A lead that has genuinely gone unanswered long enough to remind somebody
 *  about: handed to a person, still nobody's first response, still open. */
export function isMissed(lead = {}, now = new Date(), thresholdHours = REMINDER_DEFAULTS.thresholdHours) {
   if (!lead.owner || !lead.assignedAt) return false;   // nobody chose them
   if (lead.firstResponseAt) return false;              // genuinely answered
   if (lead.status === 'won' || lead.status === 'lost') return false;
   const waitedMs = new Date(now) - new Date(lead.assignedAt);
   return waitedMs >= thresholdHours * HOUR_MS;
}

/** Whether it is fine to remind again: never yet, or over a day ago. Keeps
 *  the sweep's own interval irrelevant to how often a rep is actually told —
 *  it can run every ten minutes and this still fires once a day per lead. */
export function reminderDue(lead = {}, now = new Date()) {
   if (!lead.assignmentReminderSentAt) return true;
   return new Date(now) - new Date(lead.assignmentReminderSentAt) >= DAY_MS;
}

/**
 * The notification itself — pure, so it can be checked without a database or
 * a push endpoint. Same shape as quietNudge's buildQuietNudge: one item reads
 * as a sentence, several collapse into a count, longest-waiting first — an
 * owner having a bad afternoon gets one push, not five.
 */
export function buildAssignmentReminder({ leads = [] } = {}) {
   const items = [...leads].sort((a, b) => b.waitedHours - a.waitedHours);
   const first = items[0];
   const who = leadLabel({ fullName: first?.name, phone: first?.phone });
   const path = items.length === 1 ? `/leads/${first?.leadId ?? ''}` : '/leads';

   const title = items.length === 1
      ? `${who} is still waiting`
      : `${items.length} leads are still waiting on you`;

   const body = items.length === 1
      ? `Assigned ${humanWait(Math.round(first.waitedHours * 60))} ago — nobody has replied yet.`
      : `Longest: ${who}, assigned ${humanWait(Math.round(first.waitedHours * 60))} ago.`;

   return {
      push: {
         title,
         body,
         url: path,
         tag: items.length === 1 ? `lead-reminder-${first?.leadId ?? ''}` : 'lead-reminder',
         // Single-lead reminders deep-link exactly like the original
         // assignment push; a collapsed summary has nowhere specific to send
         // a tap, so it opens the leads list instead.
         data: items.length === 1
            ? { type: 'lead_assigned', phone: first?.phone || '', leadId: String(first?.leadId ?? ''), name: who }
            : { type: 'lead_assigned_summary' },
      },
   };
}

/**
 * Run the sweep once. `dry` reports what it would do and writes nothing —
 * same contract as services/leadSla.js and services/quietNudge.js.
 */
export async function runLeadAssignReminder({ now = new Date(), dry = false, thresholdHours = REMINDER_DEFAULTS.thresholdHours } = {}) {
   const out = { reminded: 0, skipped: 0, actions: [] };
   if (!expoPushConfigured()) return { ...out, reason: 'mobile push is not configured' };

   const candidates = await Lead.find({
      owner: { $ne: null },
      assignedAt: { $ne: null },
      firstResponseAt: null,
      status: { $nin: ['won', 'lost'] },
   })
      .select('_id fullName phone phoneNormalized whatsappProfileName owner assignedAt assignmentReminderSentAt status')
      .lean();

   const byOwner = new Map();
   for (const lead of candidates) {
      if (!isMissed(lead, now, thresholdHours)) continue;
      if (!reminderDue(lead, now)) { out.skipped += 1; continue; }

      const waitedHours = (new Date(now) - new Date(lead.assignedAt)) / HOUR_MS;
      const ownerId = String(lead.owner);
      const item = {
         leadId: String(lead._id),
         name: leadLabel(lead),
         phone: lead.phoneNormalized || lead.phone || '',
         waitedHours,
      };
      if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
      byOwner.get(ownerId).push(item);
      out.actions.push({ lead: item.name, ownerId, waitedHours: Math.round(waitedHours * 10) / 10 });
   }

   if (dry) return out;

   for (const [ownerId, items] of byOwner) {
      try {
         const notice = buildAssignmentReminder({ leads: items });
         const badge = await pendingAssignmentBadge(ownerId);
         await pushExpoToUser(ownerId, { ...notice.push, badge }).catch(() => null);
         await Lead.updateMany(
            { _id: { $in: items.map((i) => i.leadId) } },
            { $set: { assignmentReminderSentAt: now } },
         );
         out.reminded += items.length;
      } catch (e) {
         console.error('[LeadAssignReminder] could not remind', ownerId, e.message);
      }
   }

   return out;
}
