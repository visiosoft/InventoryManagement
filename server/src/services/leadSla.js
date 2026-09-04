/**
 * The clock on a lead nobody has answered.
 *
 * Distribution decides who a lead belongs to, and the notice tells them it is
 * theirs. Neither does anything about the case that actually costs money: it
 * lands on somebody who is in a meeting, or driving, or has forty other chats
 * open, and simply sits there. Measured across 267 leads with a recorded
 * response, the median time to a first reply was 85 minutes. Storage enquiries
 * are won in the first one.
 *
 * So there is a clock, in two stages:
 *
 *   after slaNudgeMinutes     the owner is reminded — push and email, once
 *   after slaReassignMinutes  it is taken off them and given to somebody else,
 *                             who is told it is theirs the ordinary way
 *
 * What stops the clock is doing something about the lead, not looking at it.
 * `firstResponseAt` is set when a rep logs an attempt or moves the stage —
 * opening the lead does not count, because a measure you can satisfy by
 * reading a screen measures nothing. That is the same rule the speed-to-lead
 * panel uses (services/speedToLead.js); this is the half that acts on it.
 *
 * Three things it deliberately will not do:
 *
 *   - Reassign when there is nobody to reassign to. Taking a lead off the one
 *     rep on shift and leaving it unowned is worse than leaving it where it is.
 *   - Move the same lead twice. One reassignment is a correction; a lead that
 *     circulates around the team all afternoon is a system nobody trusts.
 *   - Run at all unless distribution is on. The rota is what decides who is
 *     working, and without it this has no basis for handing anything anywhere.
 *
 * Nothing here throws.
 */

import { Lead, LeadRoutingConfig, LeadRoutingRule, User } from '../models/index.js';
import { countsForToday, pickOwner } from './leadRouting.js';
import { notifyLeadAssigned, leadLabel } from './leadNotify.js';
import { mailConfigured, sendMail } from './mail.js';
import { pushConfigured, pushToUser } from './push.js';
import { mayEmailStaff } from './staffMail.js';

const MINUTE_MS = 60_000;

export const SLA_DEFAULTS = { nudgeMinutes: 15, reassignMinutes: 30 };

/** A lead the clock applies to at all: handed to somebody on purpose, still
 *  unanswered, still live. */
export function onTheClock(lead = {}) {
   if (!lead.owner || !lead.assignedAt) return false;   // nobody chose them
   if (lead.firstResponseAt) return false;              // answered
   return lead.status !== 'won' && lead.status !== 'lost';
}

/** Minutes since it was handed over. */
export function waitedMinutes(lead = {}, now = new Date()) {
   if (!lead.assignedAt) return 0;
   return Math.max(0, Math.round((new Date(now) - new Date(lead.assignedAt)) / MINUTE_MS));
}

/**
 * What should happen to this lead right now: 'reassign', 'nudge', or null.
 *
 * Reassignment is considered first — a lead already past the second mark does
 * not need a reminder to the person about to lose it. A lead already nudged is
 * not nudged again, and one already reassigned is left alone for good.
 */
export function actionFor(lead = {}, now = new Date(), { nudgeMinutes, reassignMinutes } = SLA_DEFAULTS) {
   if (!onTheClock(lead)) return null;
   const waited = waitedMinutes(lead, now);

   if (reassignMinutes > 0 && waited >= reassignMinutes && !lead.slaReassignedAt) return 'reassign';
   if (nudgeMinutes > 0 && waited >= nudgeMinutes && !lead.slaNudgedAt) return 'nudge';
   return null;
}

/** A wait, said the way a person says it. "2962 minutes" is a number a
 *  machine produced; two days is what happened. */
export function humanWait(minutes) {
   const m = Math.max(0, Math.round(minutes));
   if (m < 90) return `${m} minute${m === 1 ? '' : 's'}`;
   const hours = Math.round(m / 60);
   if (hours < 36) return `${hours} hour${hours === 1 ? '' : 's'}`;
   const days = Math.round(hours / 24);
   return `${days} day${days === 1 ? '' : 's'}`;
}

const escapeHtml = (s) => String(s ?? '')
   .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The reminder. Pure, so what it says can be asserted.
 *
 * Takes everything one person is due at once. Per lead, this sent 27 emails in
 * a day to two inboxes, on top of the one each lead already sends when it is
 * handed over — two emails per lead is how an inbox rule gets written, and
 * after that none of them are read.
 *
 * Short on purpose: it exists to be read on a phone, on the way to doing the
 * thing it is about.
 *
 * @param leads [{ lead, waited }], longest wait first
 */
export function buildNudge({ leads = [], reassignMinutes = 0, appUrl = '' }) {
   const items = [...leads].sort((a, b) => b.waited - a.waited);
   const first = items[0];
   const who = leadLabel(first?.lead);
   const path = items.length === 1 ? `/leads/${first?.lead?._id ?? ''}` : '/leads';

   const chaserFor = (waited) => {
      const left = reassignMinutes > 0 ? Math.round(reassignMinutes - waited) : 0;
      return left > 0
         ? `If nobody answers in the next ${left} minute${left === 1 ? '' : 's'} it goes to somebody else.`
         : 'They are still waiting.';
   };

   const subject = items.length === 1
      ? `Still waiting · ${who}`
      : `${items.length} leads still waiting`;

   const line = (i) => `  ${leadLabel(i.lead)} — ${humanWait(i.waited)}, ${i.lead?.phone || 'no number'}`;

   const text = items.length === 1
      ? [
         `${who} has been yours for ${humanWait(first.waited)} and has not been answered.`,
         '',
         `Phone: ${first.lead?.phone || '—'}`,
         chaserFor(first.waited),
         '',
         appUrl ? `Open it: ${appUrl}${path}` : `Open it in PurpleBox: ${path}`,
         '',
         'PurpleBox',
      ].join('\n')
      : [
         `${items.length} leads are yours and have not been answered — longest first:`,
         '',
         ...items.map(line),
         '',
         appUrl ? `Open them: ${appUrl}${path}` : 'Open them in PurpleBox.',
         '',
         'PurpleBox',
      ].join('\n');

   const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#14081F;max-width:520px">
      <p style="font-size:15px;font-weight:700;margin:0 0 4px">${
         items.length === 1
            ? `${escapeHtml(who)} is still waiting.`
            : `${items.length} leads are still waiting.`
      }</p>
      ${items.length === 1
         ? `<p style="font-size:13px;color:#756E80;margin:0 0 14px">Yours for ${escapeHtml(humanWait(first.waited))}, no answer yet. ${escapeHtml(chaserFor(first.waited))}</p>
            <p style="font-size:13px;margin:0 0 14px">Phone: ${escapeHtml(first.lead?.phone || '—')}</p>`
         : `<table style="border-collapse:collapse;margin:10px 0 14px">${items.map((i) => `
              <tr>
                <td style="padding:4px 14px 4px 0;font-size:13px">${escapeHtml(leadLabel(i.lead))}</td>
                <td style="padding:4px 14px 4px 0;font-size:12px;color:#756E80">${escapeHtml(i.lead?.phone || '—')}</td>
                <td style="padding:4px 0;font-size:12px;color:#756E80;white-space:nowrap">${escapeHtml(humanWait(i.waited))}</td>
              </tr>`).join('')}</table>`
      }
      ${appUrl ? `<p><a href="${escapeHtml(appUrl + path)}" style="background:#5B2BC9;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600;display:inline-block">${items.length === 1 ? 'Open the lead' : 'Open the leads'}</a></p>` : ''}
    </div>`;

   return {
      subject,
      text,
      html,
      push: {
         title: subject,
         body: items.length === 1
            ? `${humanWait(first.waited)}, no reply yet. ${chaserFor(first.waited)}`
            : `Longest: ${leadLabel(first.lead)}, ${humanWait(first.waited)}`,
         url: path,
         tag: items.length === 1 ? `lead-sla-${first?.lead?._id ?? ''}` : 'lead-sla',
      },
   };
}

/**
 * Run the clock once.
 *
 * `dry` reports what it would do and writes nothing, which is how this gets
 * looked at before it is trusted with somebody's leads.
 */
export async function runLeadSla({ now = new Date(), dry = false, limit = 50 } = {}) {
   const out = { nudged: 0, reassigned: 0, skipped: 0, actions: [] };

   const config = await LeadRoutingConfig.findOne().lean();
   if (!config?.enabled) return { ...out, reason: 'distribution is off' };

   const nudgeMinutes = Number(config.slaNudgeMinutes ?? SLA_DEFAULTS.nudgeMinutes);
   const reassignMinutes = Number(config.slaReassignMinutes ?? SLA_DEFAULTS.reassignMinutes);
   if (nudgeMinutes <= 0 && reassignMinutes <= 0) return { ...out, reason: 'the clock is switched off' };

   const timeZone = config.timeZone || 'Asia/Dubai';
   const earliest = Math.min(...[nudgeMinutes, reassignMinutes].filter((m) => m > 0));

   /* Only leads old enough for something to be due, and only recent ones: a
      lead assigned in March and never answered is a fact about March, and
      reassigning it today would tell somebody it is a live enquiry. */
   const leads = await Lead.find({
      owner: { $ne: null },
      assignedAt: { $lte: new Date(new Date(now).getTime() - earliest * MINUTE_MS), $gte: new Date(new Date(now).getTime() - 3 * 864e5) },
      firstResponseAt: null,
      status: { $nin: ['won', 'lost'] },
   }).select('fullName phone whatsappProfileName source owner assignedAt firstResponseAt status slaNudgedAt slaReassignedAt timeline')
      .sort({ assignedAt: 1 }).limit(limit).lean();

   if (!leads.length) return out;

   const rules = await LeadRoutingRule.find({}).lean();
   const counts = await countsForToday({ at: now, timeZone });
   const appUrl = process.env.APP_URL || '';
   // ownerId -> the leads they are being reminded about, sent as one message.
   const nudgesByOwner = new Map();

   for (const lead of leads) {
      let action = actionFor(lead, now, { nudgeMinutes, reassignMinutes });
      if (!action) { out.skipped += 1; continue; }
      const waited = waitedMinutes(lead, now);

      if (action === 'reassign') {
         /* Somebody other than the person who did not answer it. */
         const decision = pickOwner({ rules, counts, at: now, timeZone, exclude: [String(lead.owner)] });

         if (decision.ownerId) {
            const previous = await User.findById(lead.owner).select('name email').lean();
            out.actions.push({
               lead: leadLabel(lead), action: 'reassign', waited,
               from: previous?.name || 'somebody', toId: decision.ownerId, why: decision.reason,
            });
            if (dry) continue;

            await Lead.updateOne({ _id: lead._id }, {
               $set: {
                  owner: decision.ownerId,
                  assignedAt: now,
                  assignedBy: null,
                  autoAssigned: true,
                  ownerSeenAt: null,
                  firstResponseAt: null,
                  slaReassignedAt: now,
                  // The new owner starts with a clean clock, not the old one's.
                  slaNudgedAt: null,
               },
               $push: {
                  timeline: {
                     type: 'assigned',
                     text: `Unanswered for ${humanWait(waited)} — moved from ${previous?.name || 'the previous owner'} by the distribution rules`,
                     at: now,
                  },
               },
            });
            counts[String(decision.ownerId)] = Number(counts[String(decision.ownerId)] || 0) + 1;
            await notifyLeadAssigned({
               lead,
               ownerId: decision.ownerId,
               reason: `nobody had answered it in ${humanWait(waited)}`,
            }).catch(() => null);
            out.reassigned += 1;
            continue;
         }

         /* Nobody to move it to — out of hours, or one rep on shift. The lead
            stays where it is, because an unowned lead is worse than a slow one,
            but the person holding it is still told if they have not been
            already. Falling through rather than skipping matters more than it
            looks: all twelve unanswered leads on production were past both
            marks, so treating "cannot move it" as "nothing to do" would have
            meant nobody was told about any of them. */
         out.actions.push({ lead: leadLabel(lead), action: 'reassign', skipped: 'nobody else is available' });
         if (lead.slaNudgedAt || nudgeMinutes <= 0) { out.skipped += 1; continue; }
         action = 'nudge';
      }

      /* A reminder, to the person who still has it — gathered rather than
       * sent here.
       *
       * One email per lead put 27 messages into two inboxes in a day, on top
       * of the one each lead already sends when it is handed over. Two emails
       * per lead is how an inbox rule gets written, and then none of them are
       * read. Everything due for one person goes in one message instead. */
      out.actions.push({ lead: leadLabel(lead), action: 'nudge', waited, ownerId: String(lead.owner) });
      if (dry) continue;

      const key = String(lead.owner);
      if (!nudgesByOwner.has(key)) nudgesByOwner.set(key, []);
      nudgesByOwner.get(key).push({ lead, waited });
   }

   for (const [ownerId, items] of nudgesByOwner) {
      try {
         const owner = await User.findById(ownerId).select('name email role').lean();
         const notice = buildNudge({
            leads: items,
            reassignMinutes,
            appUrl,
         });
         if (pushConfigured()) await pushToUser(ownerId, notice.push).catch(() => null);
         // Accounts only — see services/staffMail.js. A rep is told in the
         // inbox, where the unanswered chat already sits at the top.
         if (mailConfigured() && mayEmailStaff(owner)) {
            await sendMail({ to: owner.email, subject: notice.subject, text: notice.text, html: notice.html });
         }
         await Lead.updateMany(
            { _id: { $in: items.map((i) => i.lead._id) } },
            { $set: { slaNudgedAt: now } },
         );
         out.nudged += items.length;
      } catch (e) {
         console.error('[LeadSLA] could not remind', ownerId, e.message);
      }
   }

   return out;
}
