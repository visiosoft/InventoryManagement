/**
 * Telling a rep a lead is theirs.
 *
 * Distribution without this is half a feature: the lead lands on somebody's
 * board and nothing tells them, so the first they know is the next time they
 * happen to look — which for a WhatsApp enquiry is far too late.
 *
 * Two channels, because neither is reliable on its own. A browser push is
 * instant and lands on a phone, but only for somebody who has switched it on
 * (My Account → Notifications), and today nobody has. Email always arrives but
 * is slower and easier to miss. Sending both costs nothing and means the
 * message gets through whichever one a person actually uses.
 *
 * Nothing here is allowed to throw. A lead must be created and assigned
 * whatever the mail server or a push endpoint is doing.
 */

import { Lead, User } from '../models/index.js';
import { mailConfigured, sendMail } from './mail.js';
import { pushConfigured, pushToUser } from './push.js';
import { expoPushConfigured, pushExpoToUser } from './expoPush.js';

/* Kept small on purpose — "four or five, not more" is the product ask, and a
 * badge that just counts every lead ever assigned to somebody would grow all
 * year. Capped rather than exact past the cap: once there are more than this
 * many still-unanswered assignments, the badge itself has stopped being
 * useful as a count and the number of the cap is the more honest thing to
 * show. */
export const MAX_ASSIGNMENT_BADGE = 5;

/**
 * How many "you were given a lead" pushes are still live for somebody: sent,
 * not yet replied to, not yet closed. What the phone's app-icon badge and the
 * mobile app's own in-app list both read, so neither ever drifts from what a
 * rep would count by hand.
 */
export async function pendingAssignmentBadge(ownerId) {
   if (!ownerId) return 0;
   const count = await Lead.countDocuments({
      owner: ownerId,
      assignmentNotifiedAt: { $ne: null },
      assignmentNotificationDismissedAt: null,
      status: { $nin: ['won', 'lost'] },
   });
   return Math.min(count, MAX_ASSIGNMENT_BADGE);
}

const escapeHtml = (s) => String(s ?? '')
   .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** How a lead is best referred to when you do not know their name yet. */
export function leadLabel(lead) {
   const name = String(lead?.fullName || '').trim();
   const generated = /^whatsapp\s*contact/i.test(name);
   if (name && !generated) return name;
   return lead?.whatsappProfileName || lead?.phone || 'a new enquiry';
}

/**
 * The message itself — pure, so it can be asserted against without a mail
 * server, a database or a browser.
 */
export function buildLeadNotice({ lead, assignedByName, reason, firstMessage, appUrl = '' }) {
   const who = leadLabel(lead);
   const source = String(lead?.source || 'whatsapp').replace(/_/g, ' ');
   const path = `/leads/${lead?._id ?? ''}`;

   const title = assignedByName ? `${assignedByName} gave you a lead` : `New lead: ${who}`;
   const line = firstMessage
      ? `“${String(firstMessage).slice(0, 90)}”`
      : `${who} came in on ${source}. Nobody has replied yet.`;

   const subject = `New lead · ${who}`;
   const text = [
      `${who} is yours.`,
      '',
      `Phone: ${lead?.phone || '—'}`,
      `Source: ${source}`,
      ...(reason ? [`Why you: ${reason}`] : []),
      ...(firstMessage ? ['', 'They said:', String(firstMessage).slice(0, 400)] : []),
      '',
      appUrl ? `Open it: ${appUrl}${path}` : `Open it in PurpleBox: ${path}`,
      '',
      'The first reply is what wins these, so the sooner the better.',
      '',
      'PurpleBox',
   ].join('\n');

   const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#14081F;max-width:520px">
      <p style="font-size:15px;font-weight:700;margin:0 0 4px">${escapeHtml(who)} is yours.</p>
      <p style="font-size:13px;color:#756E80;margin:0 0 14px">${escapeHtml(line)}</p>
      <table style="border-collapse:collapse;margin-bottom:14px">
        <tr><td style="padding:5px 14px 5px 0;color:#756E80;font-size:13px">Phone</td><td style="padding:5px 0;font-size:13px">${escapeHtml(lead?.phone || '—')}</td></tr>
        <tr><td style="padding:5px 14px 5px 0;color:#756E80;font-size:13px">Source</td><td style="padding:5px 0;font-size:13px">${escapeHtml(source)}</td></tr>
        ${reason ? `<tr><td style="padding:5px 14px 5px 0;color:#756E80;font-size:13px">Why you</td><td style="padding:5px 0;font-size:13px">${escapeHtml(reason)}</td></tr>` : ''}
      </table>
      ${appUrl ? `<p><a href="${escapeHtml(appUrl + path)}" style="background:#5B2BC9;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600;display:inline-block">Open the lead</a></p>` : ''}
      <p style="font-size:12px;color:#756E80;margin-top:18px">The first reply is what wins these.</p>
    </div>`;

   return {
      subject,
      text,
      html,
      push: {
         title,
         body: line,
         url: path,
         tag: `lead-${lead?._id ?? ''}`,
         /* What the mobile app needs to jump straight into the right
            WhatsApp thread on tap, without a round trip to the API first —
            see app/_layout.tsx in PurpleBoxMobile, which reads exactly this
            shape off the notification response. */
         data: {
            type: 'lead_assigned',
            phone: lead?.phoneNormalized || lead?.phone || '',
            leadId: String(lead?._id ?? ''),
            name: who,
         },
      },
   };
}

/**
 * A rep has just replied — the "you were given a lead" push is no longer
 * relevant, whatever the OS notification tray still shows.
 *
 * True remote removal of an already-delivered notification is only partially
 * in reach through Expo's abstraction: Android accepts a tag/identifier it
 * will dismiss by, but iOS has no equivalent without a mutable-content push
 * that rewrites or removes a specific delivered alert, which Expo's push API
 * does not expose. What this function guarantees instead — and what is fully
 * in reach — is that the lead is marked dismissed so neither the phone's
 * badge count nor the mobile app's own pending-leads list can ever show it
 * again, however long the OS tray keeps the original alert visible. A
 * best-effort silent push is also sent, which PurpleBoxMobile's
 * src/lib/pushNotifications.ts uses to clear the tray entry itself when the
 * app is open or has been backgrounded (not force-quit) recently enough for
 * the OS to deliver it.
 *
 * Called from wherever a reply actually goes out — see
 * services/aiBot.js's markFirstResponse, the one place every outbound
 * WhatsApp send already passes through.
 */
export async function dismissAssignmentNotification(phoneNormalized) {
   if (!phoneNormalized) return;
   try {
      const lead = await Lead.findOneAndUpdate(
         { phoneNormalized, assignmentNotifiedAt: { $ne: null }, assignmentNotificationDismissedAt: null },
         { $set: { assignmentNotificationDismissedAt: new Date() } },
         { new: true },
      ).select('_id owner').lean();
      if (!lead?.owner) return;

      if (expoPushConfigured()) {
         const badge = await pendingAssignmentBadge(lead.owner);
         await pushExpoToUser(lead.owner, {
            silent: true,
            data: { type: 'lead_assigned_dismiss', leadId: String(lead._id) },
            badge,
         }).catch(() => null);
      }
   } catch (e) {
      console.error('[LeadNotify] could not dismiss assignment push:', e.message);
   }
}

/**
 * Send it. Returns what happened on each channel rather than throwing, so a
 * caller can log it without having to guard.
 */
export async function notifyLeadAssigned({ lead, ownerId, assignedByName = '', reason = '', firstMessage = '' }) {
   const result = { push: null, email: null, mobile: null };
   if (!lead || !ownerId) return result;

   try {
      const owner = await User.findById(ownerId).select('name email').lean();
      if (!owner) return result;

      const notice = buildLeadNotice({
         lead, assignedByName, reason, firstMessage,
         appUrl: process.env.APP_URL || '',
      });

      if (pushConfigured()) {
         result.push = await pushToUser(ownerId, notice.push).catch((e) => ({ error: e.message }));
      }

      /* The phone. This is the notification the product ask is actually
       * about — the browser push above only reaches somebody at a desk, and
       * a WhatsApp lead is usually won or lost before anybody sits back down
       * at one.
       *
       * `assignmentNotifiedAt` is stamped only once a device was actually
       * reached — never on a bare attempt — because that field is what
       * decides whether this lead is "pending" for the badge count and the
       * missed-lead reminder (services/leadAssignReminder.js). Stamping it
       * regardless would mark an owner with no phone registered as already
       * notified, and they would never be reminded that a lead is sitting
       * there unread. */
      if (expoPushConfigured()) {
         const badge = await pendingAssignmentBadge(ownerId) + 1;
         result.mobile = await pushExpoToUser(ownerId, { ...notice.push, badge }).catch((e) => ({ error: e.message }));
         if (result.mobile?.sent > 0) {
            await Lead.updateOne(
               { _id: lead._id },
               { $set: { assignmentNotifiedAt: new Date() }, $unset: { assignmentNotificationDismissedAt: 1, assignmentReminderSentAt: 1 } },
            ).catch((e) => console.error('[LeadNotify] could not stamp assignmentNotifiedAt:', e.message));
         }
      }

      /* No email for this.
       *
       * One per lead put 34 messages into two inboxes in a day, and a rep who
       * is looking at the chat in the inbox has already been told. The lead
       * still shows on their board, still badges the conversation, and still
       * appears in the morning brief — none of which interrupts anybody.
       *
       * The message itself is still built and still pushed, so turning email
       * back on is a line rather than a rewrite. */
      result.email = 'not sent — leads are not emailed';
   } catch (e) {
      // Never the reason a lead fails to be created or handed over.
      console.error('[LeadNotify] could not notify:', e.message);
      result.error = e.message;
   }
   return result;
}
