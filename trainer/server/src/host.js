import { Message, TrainingSnapshot } from './models.js';
import { llmFor } from './providers.js';
import { connectorClient } from './connector.js';
import { knowledgeBlock, AUTHORITY } from './core/knowledge.js';
import { asData, DATA_RULE } from './core/text.js';

/**
 * Everything the training pipeline needs about one organisation (the `host`
 * in service.js): its model, where its conversations come from, its live
 * facts, and the agent to test. Nothing here is particular to any business.
 */

/** Stored messages (from the API or WhatsApp) as threads. */
async function storedThreads(org, source, { days = 60, limit = 500 } = {}) {
   const since = new Date(Date.now() - Math.min(Number(days) || 60, 730) * 86_400_000);
   const msgs = await Message.find({ org: org._id, source, at: { $gte: since } }).sort({ at: 1 }).limit(Math.min(Number(limit) * 20, 200_000)).lean();
   const map = new Map();
   for (const m of msgs) (map.get(m.conversation) || map.set(m.conversation, []).get(m.conversation)).push({ from: m.from, text: m.text, at: m.at, byAi: m.byAi });
   return [...map.entries()].map(([ref, messages]) => ({ ref, messages }));
}

/** The organisation's facts: what it typed in, its fixed variables, and — winning over both — its connected system's live data. */
export async function factsFor(org) {
   const values = Object.fromEntries((org.variables || []).filter((v) => v.name).map((v) => [String(v.name).toLowerCase(), String(v.value ?? '')]));
   let text = String(org.facts || '');
   const c = connectorClient(org);
   if (c) {
      try {
         const live = await c.facts();
         Object.assign(values, live.values);
         text = [live.text, text].filter(Boolean).join('\n\n');
      } catch { /* the typed facts still stand */ }
   }
   return { text, values };
}

const HOSTED_SYSTEM = (org) => [
   `You are the customer-service assistant for ${org.business || org.name}, replying in a chat.`,
   'Answer only from the approved answers and business facts given. Never invent a price, availability, discount, date, promise or policy; if they do not cover the question, say you will check and set needsHuman true.',
   `When sources disagree, follow this order: ${AUTHORITY.join(' > ')}.`,
   org.prohibited?.length ? `Never say: ${org.prohibited.join('; ')}.` : '',
   `Keep it under ${org.maxReplyLength || 700} characters, warm and brief.`,
   DATA_RULE,
   'Reply with JSON only: {"reply": string, "needsHuman": boolean}',
].filter(Boolean).join('\n');

/**
 * The agent a test runs against. An organisation with a connected system is
 * tested on its own AI (Mode 2: external agent). Otherwise the platform's
 * hosted agent answers from the published knowledge (Mode 1).
 */
function agentFor(org) {
   const c = connectorClient(org);
   if (c) return { name: 'Connected agent', reply: (q) => c.agentReply(q) };
   const llm = llmFor(org, 'agent');
   return {
      name: 'Hosted agent',
      async reply({ question }) {
         const snap = org.activeSnapshot ? await TrainingSnapshot.findOne({ org: org._id, version: org.activeSnapshot }).lean() : null;
         const facts = await factsFor(org);
         const k = knowledgeBlock(question, snap?.items || [], facts.values, { limit: 4, min: 0.2 });
         const out = await llm.json({ system: HOSTED_SYSTEM(org), user: [k.text || 'APPROVED ANSWERS: none match.', `BUSINESS FACTS:\n${facts.text || '(none)'}`, `Customer: ${asData(question)}`].join('\n\n') });
         return { reply: String(out?.reply || ''), needsHuman: Boolean(out?.needsHuman) };
      },
   };
}

export function hostFor(org) {
   const c = connectorClient(org);
   return {
      llmFor: (feature) => llmFor(org, feature),
      sources: {
         api: (p) => storedThreads(org, 'api', p),
         whatsapp: (p) => storedThreads(org, 'whatsapp', p),
         connector: async (p) => {
            if (!c) throw new Error('No system is connected');
            return c.conversations({ days: p.days, limit: p.limit });
         },
      },
      facts: () => factsFor(org),
      agent: agentFor(org),
   };
}
