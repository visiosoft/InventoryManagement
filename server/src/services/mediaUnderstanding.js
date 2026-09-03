/**
 * Reading what a customer sent, when what they sent is not text.
 *
 * A voice note and a photo were both handed straight to a person: "the
 * assistant cannot read this". Most of them can be read perfectly well, and
 * most of them are the ordinary things — somebody saying out loud what they
 * would otherwise have typed, or a photo of the items they want to store.
 *
 * The rule kept from before: anything genuinely consequential still goes to a
 * person. A payment receipt, a damaged item, a signed document — the assistant
 * is told what it is looking at and hands it over rather than commenting on it.
 * Reading something is not the same as being allowed to answer for it.
 */

import { transcribeAudio, visionJson } from './openai.js';
import { fetchWhatsAppMedia } from './whatsappMediaFetch.js';

/* Meta accepts far larger files than are worth sending to a model. A two
   minute voice note is a question; a twenty minute one is somebody's meeting
   recording and a person should deal with it. */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const IMAGE_SYSTEM = [
   'You are looking at a photo a customer sent to a self-storage company on WhatsApp.',
   'Say what is in it, in one or two plain sentences, as a colleague would describe it.',
   'Then judge whether a photo of this kind needs a person rather than an automatic reply.',
   '',
   'A person is needed for: a payment receipt or bank transfer, a damaged or broken item,',
   'an identity document, a signed contract or form, a meter or lock problem, anything that',
   'looks like a complaint or a dispute. Set needsHuman true for those.',
   '',
   'A photo of belongings to be stored, a room to be cleared, furniture, boxes or a vehicle',
   'is an ordinary enquiry. Set needsHuman false and, in "estimate", say roughly how much',
   'space it suggests if you can tell — otherwise leave it empty. Never invent a size.',
   '',
   'Reply with JSON only: {"description": string, "needsHuman": boolean, "estimate": string}',
].join('\n');

/**
 * @returns {{ kind: 'audio'|'image', text: string, needsHuman: boolean, reason: string }}
 *          `text` is what the assistant should treat as the customer's message.
 *          A blank `text` with needsHuman true means it could not be read.
 */
export async function understandMedia({ kind, mediaId, sentAt = null }) {
   try {
      if (!mediaId) return { kind, text: '', needsHuman: true, reason: 'no attachment id' };

      const { buffer, mimeType } = await fetchWhatsAppMedia({ id: mediaId, sentAt });

      if (kind === 'audio' || kind === 'voice') {
         if (buffer.length > MAX_AUDIO_BYTES) {
            return { kind: 'audio', text: '', needsHuman: true, reason: 'the voice note is too long to read automatically' };
         }
         const transcript = await transcribeAudio({ buffer, mimeType, filename: `voice.${mimeType.includes('mp4') ? 'm4a' : 'ogg'}` });
         if (!transcript) {
            // Silence and a failed transcription look the same from here, and
            // guessing which would have the assistant answer a question it
            // never heard.
            return { kind: 'audio', text: '', needsHuman: true, reason: 'the voice note could not be transcribed' };
         }
         return { kind: 'audio', text: transcript, needsHuman: false, reason: '' };
      }

      if (kind === 'image') {
         if (buffer.length > MAX_IMAGE_BYTES) {
            return { kind: 'image', text: '', needsHuman: true, reason: 'the photo is too large to read automatically' };
         }
         // visionJson answers { parsed, usage }, not the object itself.
         const { parsed: read } = await visionJson({
            system: IMAGE_SYSTEM,
            imageBase64: buffer.toString('base64'),
            mimeType,
            prompt: 'What has the customer sent, and does it need a person?',
         });
         if (!read?.description) {
            return { kind: 'image', text: '', needsHuman: true, reason: 'the photo could not be read' };
         }

         /* Handed to the assistant as a description of what arrived, not as
            words the customer typed — so it answers "they have sent a photo of
            X" rather than pretending to quote them. */
         const parts = [`[The customer sent a photo: ${read.description}]`];
         if (read.estimate) parts.push(`[Roughly: ${read.estimate}]`);

         return {
            kind: 'image',
            text: parts.join(' '),
            needsHuman: Boolean(read.needsHuman),
            reason: read.needsHuman ? `Photo needs a person: ${read.description}` : '',
         };
      }

      return { kind, text: '', needsHuman: true, reason: `a ${kind} is not something the assistant reads` };
   } catch (e) {
      // A dead token or a file Meta has deleted, both of which a person can act
      // on and the assistant cannot.
      return { kind, text: '', needsHuman: true, reason: e.message };
   }
}
