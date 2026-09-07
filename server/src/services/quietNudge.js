/**
 * Telling a rep, quickly, that a lead has gone quiet on them.
 *
 * Not the same problem services/leadFollowUp.js solves. That one is a backlog
 * to review in a batch, days after the fact, with an approved WhatsApp
 * template because the 24-hour reply window has long since closed. This is
 * the moment before that: hours, not days, while the conversation is still
 * warm enough that a plain "just checking in" from the rep themselves — no
 * template needed yet — stands a real chance of getting an answer. Missing
 * this window is exactly how a lead becomes next week's backlog.
 *
 * Batched per rep for the same reason services/leadSla.js batches its own
 * nudge: services/staffMail.js already measured what happens otherwise — the
 * system was sending 70 emails a day to its own staff, and email stopped
 * being a signal. Push only, for the same rule that file enforces everywhere
 * else: EMAILED_ROLES is accounts, nobody else. A rep who has not turned on
 * push (My Account → Notifications) will not hear about this until they next
 * open the app — that is a real gap, and the honest fix for it is more people
 * turning push on, not quietly re-opening the door this codebase already
 * closed on staff email.
 */

import { Lead, LeadRoutingConfig } from '../models/index.js';
import { quietLeads } from './leadFollowUp.js';
import { humanWait } from './leadSla.js';
import { leadLabel } from './leadNotify.js';
import { pushConfigured, pushToUser } from './push.js';

const escapeHtml = (s) => String(s ?? '')
   .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export async function quietNudgeConfig() {
   const config = await LeadRoutingConfig.findOne().select('quietNudgeEnabled quietNudgeHours').lean();
   return { enabled: Boolean(config?.quietNudgeEnabled), hours: config?.quietNudgeHours || 6 };
}

export async function setQuietNudgeConfig({ enabled, hours }) {
   const update = {};
   if (enabled !== undefined) update.quietNudgeEnabled = Boolean(enabled);
   if (hours !== undefined) update.quietNudgeHours = Math.max(1, Math.min(72, Number(hours) || 6));
   await LeadRoutingConfig.findOneAndUpdate({}, { $set: update }, { upsert: true });
   return quietNudgeConfig();
}

/**
 * The notification itself — pure, so it can be checked without a database or
 * a push endpoint. Same shape as leadSla.js's buildNudge: one item reads as a
 * sentence, several read as a list, longest-silent first.
 */
export function buildQuietNudge({ leads = [], appUrl = '' }) {
   const items = [...leads].sort((a, b) => b.minutesQuiet - a.minutesQuiet);
   const first = items[0];
   const who = leadLabel({ fullName: first?.name, phone: first?.phone });
   const path = items.length === 1 ? `/leads/${first?.leadId ?? ''}` : '/leads';

   const title = items.length === 1
      ? `${who} has gone quiet`
      : `${items.length} leads have gone quiet`;

   const body = items.length === 1
      ? `${humanWait(first.minutesQuiet)} since you last wrote, no reply yet.`
      : `Longest: ${leadLabel({ fullName: first?.name, phone: first?.phone })}, ${humanWait(first.minutesQuiet)}.`;

   return {
      push: { title, body, url: path, tag: items.length === 1 ? `quiet-nudge-${first?.leadId ?? ''}` : 'quiet-nudge' },
   };
}

/**
 * Run the check once. `dry` reports what it would do and writes nothing.
 *
 * Every open lead in the company is read, not scoped per owner up front — the
 * silence clock is company-wide, and it is grouped by owner only once it is
 * time to say something. Nudges once per silence: a lead already nudged for
 * this same quiet stretch is skipped, found by comparing the last nudge
 * against the last time the rep actually wrote — a rep who writes again and
 * then goes quiet a second time has started a new stretch and earns a new
 * nudge, so nothing here is ever explicitly cleared on reply.
 */
export async function runQuietNudge({ now = new Date(), dry = false, appUrl = '' } = {}) {
   const out = { nudged: 0, skipped: 0, actions: [] };

   const { enabled, hours } = await quietNudgeConfig();
   if (!enabled) return { ...out, reason: 'quiet nudge is off' };

   const quiet = await quietLeads({ ownerId: null, days: hours / 24 });
   const bySkip = quiet.filter((l) => !l.ownerId);
   out.skipped += bySkip.length;

   const nudgesByOwner = new Map();
   for (const lead of quiet) {
      if (!lead.ownerId) continue;
      const alreadyNudged = lead.quietNudgedAt && new Date(lead.quietNudgedAt) >= new Date(lead.since);
      if (alreadyNudged) { out.skipped += 1; continue; }

      const minutesQuiet = Math.round((now - new Date(lead.since)) / 60000);
      out.actions.push({ lead: lead.name, action: 'nudge', minutesQuiet, ownerId: lead.ownerId });
      if (dry) continue;

      if (!nudgesByOwner.has(lead.ownerId)) nudgesByOwner.set(lead.ownerId, []);
      nudgesByOwner.get(lead.ownerId).push({ ...lead, minutesQuiet });
   }
   if (dry) return out;

   /* Nobody has push configured on the server at all — not "this one rep
      hasn't turned it on", the whole channel is off. Nothing can be marked
      nudged, or every lead currently silent would be silently written off the
      moment somebody finally sets push up, and none of them would actually
      have been told about. */
   if (!pushConfigured()) return { ...out, reason: 'push is not configured' };

   for (const [ownerId, items] of nudgesByOwner) {
      try {
         const notice = buildQuietNudge({ leads: items, appUrl });
         await pushToUser(ownerId, notice.push).catch(() => null);
         await Lead.updateMany(
            { _id: { $in: items.map((i) => i.leadId) } },
            { $set: { quietNudgedAt: now } },
         );
         out.nudged += items.length;
      } catch (e) {
         console.error('[QuietNudge] could not remind', ownerId, e.message);
      }
   }

   return out;
}
