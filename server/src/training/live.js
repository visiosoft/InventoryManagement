import { TrainingOrg, TrainingSnapshot } from './models.js';
import { knowledgeBlock } from './core/knowledge.js';

/**
 * Published knowledge, for an agent about to reply. Reads the organisation's
 * live snapshot (never drafts or unpublished edits), picks the answers that
 * match the customer's message and fills their {variables} with today's
 * values. Cached briefly: a publish or rollback reaches agents within a
 * minute, and a reply costs no extra database reads in between.
 */

const TTL = 60_000;
const cache = new Map();

async function active(slug) {
   const hit = cache.get(slug);
   if (hit && Date.now() - hit.at < TTL) return hit;
   const org = await TrainingOrg.findOne({ slug }).select('activeSnapshot').lean();
   const snap = org?.activeSnapshot ? await TrainingSnapshot.findOne({ org: org._id, version: org.activeSnapshot }).select('version items').lean() : null;
   const entry = { at: Date.now(), version: snap?.version || 0, items: snap?.items || [] };
   cache.set(slug, entry);
   return entry;
}

/** Drop the cache after a publish or rollback, so this server picks it up at once. */
export const forgetKnowledge = (slug) => cache.delete(slug);

let valuesCache = { at: 0, values: {} };
async function liveValues(getValues) {
   if (Date.now() - valuesCache.at < 5 * TTL) return valuesCache.values;
   const values = await getValues().catch(() => ({}));
   valuesCache = { at: Date.now(), values };
   return values;
}

/**
 * { text, used, version } for one customer message. `text` is '' when no
 * approved answer fits — the agent then works exactly as before.
 */
export async function knowledgeFor(message, { slug = 'purplebox', getValues = async () => ({}) } = {}) {
   if (!String(message || '').trim()) return { text: '', used: [], version: 0 };
   try {
      const snap = await active(slug);
      if (!snap.items.length) return { text: '', used: [], version: snap.version };
      const values = await liveValues(getValues);
      return { ...knowledgeBlock(message, snap.items, values), version: snap.version };
   } catch {
      return { text: '', used: [], version: 0 };
   }
}
