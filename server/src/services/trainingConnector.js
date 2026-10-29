import { WhatsAppMessage, Unit } from '../models/index.js';
import { buildFacts, FACILITY } from './aiBot.js';
import { hiddenSiteIds } from '../utils/siteScope.js';

/**
 * PurpleBox's side of the AI Training Center's Connector protocol (see
 * routes/trainingConnector.js): its WhatsApp conversations, its live prices
 * and facts, and Aisha's reply to a test question. The Training Center is a
 * separate product; PurpleBox is one of its customers, connected through this.
 */

/**
 * Recent WhatsApp conversations, most recent customers first, at most
 * `perConversation` questions from each, so 500 questions come from a few
 * hundred different people rather than three very chatty ones.
 */
export async function conversations({ limit = 500, days = 60, perConversation = 3 } = {}) {
   const since = new Date(Date.now() - Math.min(Number(days) || 60, 365) * 86_400_000);
   const recent = await WhatsAppMessage.find({ direction: 'inbound', type: 'text', text: { $ne: '' }, deletedAt: null, occurredAt: { $gte: since } })
      .sort({ occurredAt: -1 }).limit(Math.min(Number(limit) * 6, 30000)).select('phoneNormalized').lean();
   const phones = [...new Set(recent.map((m) => m.phoneNormalized).filter(Boolean))].slice(0, Math.ceil((Number(limit) || 500) / 1.5));
   const msgs = await WhatsAppMessage.find({ phoneNormalized: { $in: phones }, type: 'text', text: { $ne: '' }, deletedAt: null, occurredAt: { $gte: since } })
      .sort({ occurredAt: 1 }).select('phoneNormalized direction text occurredAt sentByAi').lean();
   const byPhone = new Map();
   for (const m of msgs) {
      const list = byPhone.get(m.phoneNormalized) || byPhone.set(m.phoneNormalized, []).get(m.phoneNormalized);
      if (list.length < 80) list.push({ from: m.direction === 'inbound' ? 'customer' : 'agent', text: m.text, at: m.occurredAt, byAi: Boolean(m.sentByAi) });
   }
   return [...byPhone.entries()].map(([ref, messages]) => ({ ref, messages }));
}

/**
 * Live facts and {variables}: today's price range per size, the address,
 * map link and opening hours. Read from the CRM each time, so an approved
 * answer that says {price_50} quotes today's price, not last month's.
 */
export async function facts() {
   const f = await buildFacts('', {});
   const hidden = await hiddenSiteIds();
   const units = await Unit.find({ status: { $ne: 'maintenance' }, price: { $gt: 0 }, ...(hidden.length ? { site: { $nin: hidden } } : {}) }).select('sizeSqf price discountPct').lean();
   const values = { address: FACILITY.address, map_link: FACILITY.mapUrl, opening_hours: FACILITY.hours };
   const bySize = new Map();
   for (const u of units) {
      if (!(u.sizeSqf > 0)) continue;
      const row = bySize.get(u.sizeSqf) || { prices: [], discount: 0 };
      row.prices.push(u.price); row.discount = Math.max(row.discount, Number(u.discountPct) || 0);
      bySize.set(u.sizeSqf, row);
   }
   const fmt = (n) => Math.round(n).toLocaleString('en-US');
   for (const [size, row] of bySize) {
      const lo = Math.min(...row.prices); const hi = Math.max(...row.prices);
      values[`price_${size}`] = lo === hi ? `AED ${fmt(lo)}` : `AED ${fmt(lo)}–${fmt(hi)}`;
      if (row.discount > 0) values[`first_month_${size}`] = `AED ${fmt(lo * (1 - row.discount / 100))}`;
   }
   return { text: f.text, values };
}

/**
 * Aisha (or another conversational agent) answering one question as she
 * would live, against the real conversation up to that moment — nothing is
 * sent and no lead file is touched. Used by the evaluation lab.
 */
export function agentFor(agentDoc) {
   if (!agentDoc) return null;
   return {
      name: agentDoc.name,
      async reply({ question, ref, at, context = null }) {
         const { runAgent, findLead } = await import('../agents/runtime.js');
         const { freshState } = await import('../agents/buckets.js');
         const when = at ? new Date(at) : new Date();
         const lead = (await findLead({ phone: ref })) || { _id: null, fullName: '', phoneNormalized: String(ref || '') };
         const file = { ...freshState(when), phoneNormalized: String(ref || lead.phoneNormalized || ''), need: {}, offers: [], openQuestions: [], lastSummary: '' };
         // A sandbox conversation: the simulated messages stand in for the real history.
         const historyOverride = Array.isArray(context) ? [...context, { from: 'customer', text: question }].map((m, i, a) => ({ direction: m.from === 'agent' ? 'outbound' : 'inbound', type: 'text', text: String(m.text || '').slice(0, 2000), occurredAt: new Date(when.getTime() - (a.length - i) * 60_000) })) : null;
         const d = await runAgent({ agent: agentDoc, lead: historyOverride ? { _id: null, fullName: '', phoneNormalized: '' } : lead, leadFile: historyOverride ? { ...file, phoneNormalized: '' } : file, trigger: { kind: 'inbound', text: question, until: when }, now: when, persist: false, historyOverride });
         return { reply: d.reply || '', needsHuman: Boolean(d.needsHuman), tools: (d.toolCalls || []).map((c) => c.name) };
      },
   };
}

