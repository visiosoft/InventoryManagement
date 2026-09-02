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

import { User } from '../models/index.js';
import { mailConfigured, sendMail } from './mail.js';
import { pushConfigured, pushToUser } from './push.js';

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
      push: { title, body: line, url: path, tag: `lead-${lead?._id ?? ''}` },
   };
}

/**
 * Send it. Returns what happened on each channel rather than throwing, so a
 * caller can log it without having to guard.
 */
export async function notifyLeadAssigned({ lead, ownerId, assignedByName = '', reason = '', firstMessage = '' }) {
   const result = { push: null, email: null };
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
      if (mailConfigured() && owner.email) {
         await sendMail({ to: owner.email, subject: notice.subject, text: notice.text, html: notice.html });
         result.email = 'sent';
      }
   } catch (e) {
      // Never the reason a lead fails to be created or handed over.
      console.error('[LeadNotify] could not notify:', e.message);
      result.error = e.message;
   }
   return result;
}
