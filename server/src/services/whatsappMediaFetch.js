/**
 * Getting an attachment's bytes out of WhatsApp.
 *
 * Two hops, and neither can be handed to a browser: the id resolves to a
 * short-lived signed URL, and that URL still needs the bearer token. This lived
 * inside the media proxy route, which meant anything else wanting to read an
 * attachment — the assistant, for one — had to copy it.
 *
 * The error wording is part of the job here. "Unavailable" sends people looking
 * in the wrong place; the two things that actually go wrong are a dead token
 * and Meta having deleted the file after thirty days, and they need different
 * fixes.
 */

const GRAPH = 'https://graph.facebook.com/v20.0';

export class MediaFetchError extends Error {
   constructor(message, { status = 502, code = '' } = {}) {
      super(message);
      this.name = 'MediaFetchError';
      this.status = status;
      this.code = code;
   }
}

/**
 * @param id       the media id from the webhook
 * @param sentAt   when the message arrived, so an expired file can be named as
 *                 expired rather than reported as a mystery
 * @returns {{ buffer: Buffer, mimeType: string }}
 */
export async function fetchWhatsAppMedia({ id, sentAt = null } = {}) {
   const token = process.env.WHATSAPP_ACCESS_TOKEN;
   if (!token) throw new MediaFetchError('WhatsApp is not connected', { code: 'no_token' });
   if (!id) throw new MediaFetchError('No attachment id', { status: 400, code: 'no_id' });

   const lookup = await fetch(`${GRAPH}/${id}`, { headers: { Authorization: `Bearer ${token}` } });
   const info = await lookup.json().catch(() => ({}));

   if (!lookup.ok || !info?.url) {
      const detail = info?.error?.message || `HTTP ${lookup.status}`;
      const ageDays = sentAt ? (Date.now() - new Date(sentAt)) / 86_400_000 : 0;

      if (lookup.status === 401 || /auth|token|session|expired/i.test(detail)) {
         throw new MediaFetchError(
            'The WhatsApp access token is not valid — reconnect it in Settings → Integrations',
            { code: 'bad_token' },
         );
      }
      if (ageDays > 30) {
         throw new MediaFetchError(
            'WhatsApp deleted this attachment — it only keeps files for 30 days',
            { code: 'expired' },
         );
      }
      throw new MediaFetchError(detail, { code: 'lookup_failed' });
   }

   const file = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` } });
   if (!file.ok) throw new MediaFetchError(`Download failed (HTTP ${file.status})`, { code: 'download_failed' });

   return {
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: info.mime_type || 'application/octet-stream',
   };
}
