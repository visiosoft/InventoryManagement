import axios from 'axios';

/**
 * Answers PurpleBox approved in the AI Training Center, for Aisha about to
 * reply. Asks the Training Center's API (with this CRM's key) which published
 * answers match the customer's message, already filled with today's values.
 *
 * Never in the way: no key, a slow or failed call (2 s), or no match all mean
 * an empty block and a reply composed exactly as before. Cached for a minute
 * per message, so a re-draft costs nothing.
 */

const TTL = 60_000;
const cache = new Map();
const AUTHORITY = 'legal and safety > current business rules > live data from the CRM and your tools > these approved answers > your instructions > past conversations';

/**
 * Worked examples PurpleBox approved in the AI Training Center (its sandbox
 * corrections and scenarios): how to handle a situation like this one. Pure.
 */
export function examplesText(examples = []) {
   const list = (Array.isArray(examples) ? examples : []).filter((e) => e?.customer && (e.reply || e.escalate)).slice(0, 3);
   if (!list.length) return '';
   return [
      'APPROVED EXAMPLES — replies PurpleBox approved for situations like this one. Follow their approach, length and next step in your own words; any price, date or availability in them is only an example, so use the live facts and your tools.',
      ...list.map((e) => [
         ...(Array.isArray(e.context) ? e.context : []).slice(-2).map((m) => `  ${m.from === 'agent' ? 'Us' : 'Customer'}: ${String(m.text || '').slice(0, 300)}`),
         `  Customer: ${String(e.customer).slice(0, 500)}`,
         e.escalate ? '  (hand to a person: set needsHuman true)' : '',
         e.reply ? `  Approved reply: ${String(e.reply).slice(0, 800)}` : '',
      ].filter(Boolean).join('\n')),
   ].join('\n\n');
}

/**
 * The prompt block from the Training Center's matches, and the sales
 * playbook's behaviour contract when PurpleBox chose to share it there. Pure.
 */
export function blockFromMatches(matches = [], contract = '', examples = []) {
   const answers = matches.filter((m) => !m.escalate);
   const people = matches.filter((m) => m.escalate);
   const rules = String(contract || '').trim().slice(0, 20000);
   const worked = examplesText(examples);
   if (!answers.length && !people.length) return [rules ? `SALES PLAYBOOK — approved by PurpleBox in the AI Training Center. Follow it; live data and your tools still win on facts.\n${rules}` : '', worked].filter(Boolean).join('\n\n');
   const lines = [
      ...(worked ? [worked, ''] : []),
      ...(rules ? [`SALES PLAYBOOK — approved by PurpleBox in the AI Training Center. Follow it; live data and your tools still win on facts.\n${rules}`, ''] : []),
      'APPROVED ANSWERS — written and approved by PurpleBox for situations like this one. Use their content and approach, in your own words for this customer.',
      `If anything in them disagrees with live data or your tools, the live data wins (authority: ${AUTHORITY}). Never quote a figure from here that a tool contradicts.`,
      ...answers.map((m) => `- When asked: "${m.question}"\n  Approved answer: ${m.answer}${m.followUp ? `\n  Then: ${m.followUp}` : ''}`),
      ...people.map((m) => `- "${m.question}" must go to a person: set needsHuman true${m.escalationNote ? ` (${m.escalationNote})` : ''}.`),
   ];
   return lines.join('\n');
}

export async function knowledgeFor(message, { post = axios.post } = {}) {
   const text = String(message || '').trim().slice(0, 2000);
   const key = process.env.TRAINER_API_KEY;
   if (!text || !key) return { text: '', used: [], version: 0 };
   const hit = cache.get(text);
   if (hit && Date.now() - hit.at < TTL) return hit.value;
   let value = { text: '', used: [], version: 0 };
   try {
      const url = `${(process.env.TRAINER_API_URL || 'http://127.0.0.1:5020/api/v1').replace(/\/+$/, '')}/match`;
      const { data } = await post(url, { message: text, limit: 3 }, { headers: { Authorization: `Bearer ${key}` }, timeout: 2000 });
      const matches = Array.isArray(data?.matches) ? data.matches : [];
      value = { text: blockFromMatches(matches, data?.contract, data?.examples), used: matches.map((m) => ({ id: m.id, version: m.version, score: m.score })), version: Number(data?.version) || 0 };
   } catch { /* the Training Center is optional; reply as before */ }
   if (cache.size > 500) cache.clear();
   cache.set(text, { at: Date.now(), value });
   return value;
}
