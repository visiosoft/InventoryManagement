import { asData, DATA_RULE, normalize } from './text.js';

/**
 * Intent clustering. Customer questions are grouped by the answer they need,
 * not by how alike they read: "how much is 50 sqft" and "price for a medium
 * unit" are one intent; "am I eligible for a refund" and "where is my refund"
 * are two. That judgement needs a language model, so this is incremental:
 * each batch of questions is shown with the intents found so far, and each
 * question is put in one of them or opens a new one. A batch is small enough
 * to be checked, and the catalogue grows as the import goes.
 *
 * The model only names and assigns. Keys, counts and membership are worked
 * out here, so a reply that names an intent that does not exist cannot
 * invent one silently.
 */

export const CLUSTER_SYSTEM = (categories) => [
   'You sort customer questions into intents for a business\'s AI training team.',
   'Two questions share an intent only if ONE approved answer would correctly answer both. Same topic is not enough: "am I eligible for a refund" and "where is my refund" are different intents; "how much is 50 sqft" and "price of a medium unit" may be the same.',
   'Give each new intent a short name (3–6 words, e.g. "Storage price by size"), one category, and the clearest wording of the question as a customer would ask it.',
   `Categories: ${categories.join(', ')}. Use "Other" when none fits.`,
   'A message that asks or needs nothing (a thank-you, a confirmation, a name, a document sent) is skipped.',
   DATA_RULE,
   'Reply with JSON only: {"assign":[{"i":number,"intent":"existing key" | null,"new":{"name":string,"category":string,"question":string} | null}],"skip":[number]}',
].join('\n');

/** The prompt for one batch. Pure. */
export function clusterPrompt(batch, intents) {
   const known = intents.length
      ? intents.map((x) => `${x.key} | ${x.name} | ${x.category} | e.g. ${x.question}`).join('\n')
      : '(none yet)';
   const items = batch.map((q, i) => `${i}. ${asData(q.text)}${q.context?.length ? ` (before it: ${q.context.slice(-2).map((c) => `${c.from}: ${c.text}`).join(' / ').slice(0, 200)})` : ''}`).join('\n');
   return `Known intents (key | name | category | example):\n${known}\n\nQuestions:\n${items}`;
}

const slug = (s) => normalize(s).replace(/\s+/g, '-').slice(0, 48) || 'intent';

/**
 * Applies a model's reply to the catalogue. Pure.
 * Unknown keys, out-of-range indexes and unnamed new intents are ignored, and
 * a "new" intent whose name matches one already known joins it instead.
 * Returns the updated intents and, for each question in the batch, its key or null.
 */
export function applyAssignments(batch, intents, reply, categories) {
   const byKey = new Map(intents.map((x) => [x.key, { ...x }]));
   const byName = new Map([...byKey.values()].map((x) => [normalize(x.name), x.key]));
   const keys = new Array(batch.length).fill(null);
   const skip = new Set((reply?.skip || []).map(Number));
   for (const a of Array.isArray(reply?.assign) ? reply.assign : []) {
      const i = Number(a?.i);
      if (!Number.isInteger(i) || i < 0 || i >= batch.length || skip.has(i)) continue;
      let key = a.intent && byKey.has(a.intent) ? a.intent : null;
      if (!key && a.new?.name) {
         const name = String(a.new.name).trim().slice(0, 80);
         key = byName.get(normalize(name));
         if (!key) {
            let k = slug(name); let n = 2;
            while (byKey.has(k)) k = `${slug(name)}-${n++}`;
            const category = categories.includes(a.new.category) ? a.new.category : 'Other';
            byKey.set(k, { key: k, name, category, question: String(a.new.question || batch[i].text).slice(0, 300) });
            byName.set(normalize(name), k);
            key = k;
         }
      }
      keys[i] = key;
   }
   return { intents: [...byKey.values()], keys };
}

/**
 * Clusters every question, batch by batch. `llm.json({ system, user })` is the
 * only thing that talks to a model. `onBatch` reports progress. Returns the
 * intents and a key (or null when skipped) per question.
 */
export async function clusterQuestions(questions, { llm, categories, intents = [], batchSize = 30, onBatch = async () => {} }) {
   let catalogue = intents;
   const keys = [];
   const system = CLUSTER_SYSTEM(categories);
   for (let start = 0; start < questions.length; start += batchSize) {
      const batch = questions.slice(start, start + batchSize);
      let reply = null;
      try {
         reply = await llm.json({ system, user: clusterPrompt(batch, catalogue.slice(-150)), maxTokens: 3000 });
      } catch (e) {
         reply = { assign: [], error: e.message };
      }
      const out = applyAssignments(batch, catalogue, reply, categories);
      catalogue = out.intents;
      keys.push(...out.keys);
      await onBatch({ done: Math.min(start + batchSize, questions.length), total: questions.length, error: reply?.error });
   }
   return { intents: catalogue, keys };
}
