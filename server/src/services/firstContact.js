/**
 * The facility tour, sent the first time somebody writes in.
 *
 * The assistant's instructions say the video "is normally sent automatically
 * through the WhatsApp quick-reply process after the customer's first
 * interaction". It was not: quick replies are something a person taps, and
 * nothing sent that video on its own. The prompt described a step that did not
 * exist, so the assistant would sometimes talk as though the customer had
 * already seen the place.
 *
 * This is that step. It sends the quick reply marked as the facility video —
 * the same template a rep taps, so there is one piece of wording and one file
 * to keep current — as a link, which needs no upload and no media id to keep
 * alive.
 *
 * Deliberately narrow. It goes out on somebody's genuine first inbound message
 * and never again; a customer who comes back six months later is not new, and
 * getting the tour video twice reads as a machine.
 */

import { MessageTemplate, WhatsAppMessage } from '../models/index.js';
import { sendWhatsAppMedia, whatsappSendConfigured } from './whatsapp.js';

/** The template that carries the tour. Matched by kind, not by a hardcoded id. */
async function tourTemplate() {
   return MessageTemplate.findOne({ mediaKind: 'video', mediaUrl: { $ne: '' } })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
}

/**
 * @returns {{ sent: boolean, reason?: string }}
 * Never throws: a webhook must not fail because a video did not go out.
 */
export async function sendFirstContactVideo({ phoneNormalized, config }) {
   try {
      if (!config?.sendVideoOnFirstContact) return { sent: false, reason: 'switched off' };
      if (!whatsappSendConfigured()) return { sent: false, reason: 'WhatsApp is not configured' };
      if (!phoneNormalized) return { sent: false, reason: 'no number' };

      /* Their first message, and only their first.
       *
       * Counted rather than inferred from whether a lead exists: a lead is
       * created for all sorts of reasons, and one of them is somebody adding a
       * contact by hand, which is not a first contact. */
      const inboundCount = await WhatsAppMessage.countDocuments({ phoneNormalized, direction: 'inbound' });
      if (inboundCount !== 1) return { sent: false, reason: 'not their first message' };

      // Belt and braces: if the tour has ever gone to this number, it does not
      // go again, whatever the count says.
      const already = await WhatsAppMessage.exists({ phoneNormalized, direction: 'outbound', type: 'video' });
      if (already) return { sent: false, reason: 'they have already had it' };

      const template = await tourTemplate();
      if (!template) return { sent: false, reason: 'no video quick reply is set up' };

      const caption = String(template.whatsappBody || '').trim();
      const result = await sendWhatsAppMedia({
         to: phoneNormalized,
         link: template.mediaUrl,
         kind: 'video',
         caption,
         filename: template.mediaFilename || undefined,
      });

      await WhatsAppMessage.create({
         messageId: result?.messages?.[0]?.id || '',
         phone: phoneNormalized,
         phoneNormalized,
         direction: 'outbound',
         type: 'video',
         text: caption,
         status: 'sent',
         occurredAt: new Date(),
         // It is the system speaking, not a colleague — so this must not pause
         // the assistant the way a person's reply does.
         sentByAi: true,
         raw: { video: { link: template.mediaUrl, caption, filename: template.mediaFilename || '' }, sendResult: result },
      });

      return { sent: true };
   } catch (e) {
      console.error('[FirstContact] could not send the tour video:', e.message);
      return { sent: false, reason: e.message };
   }
}
