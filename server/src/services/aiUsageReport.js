import { AiUsage } from '../models/index.js';
import { AgentAction, AgentProfile } from '../agents/models.js';
import { costUsd } from './aiUsage.js';

/**
 * AI usage over a period, from the usage log (every call since logging began)
 * plus the agents' own action log for the days before it — so a question about
 * last week is not answered with a few hours of data.
 */
const r2 = (n) => Math.round(n * 100) / 100;

export function summarise(rows) {
   const total = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpricedCalls: 0, webSearches: 0 };
   const by = (key) => {
      const m = new Map();
      for (const r of rows) {
         const k = r[key] || 'other';
         const e = m.get(k) || { [key]: k, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
         e.calls += r.calls; e.inputTokens += r.inputTokens; e.outputTokens += r.outputTokens; e.costUsd = r2(e.costUsd + (r.costUsd || 0));
         m.set(k, e);
      }
      return [...m.values()].sort((a, b) => b.costUsd - a.costUsd || b.inputTokens - a.inputTokens);
   };
   for (const r of rows) {
      total.calls += r.calls; total.inputTokens += r.inputTokens; total.outputTokens += r.outputTokens;
      total.costUsd = r2(total.costUsd + (r.costUsd || 0)); total.webSearches += r.webSearches || 0;
      if (r.costUsd == null) total.unpricedCalls += r.calls;
   }
   return { total, byProvider: by('provider'), byModel: by('model'), byFeature: by('feature').slice(0, 25), byDay: by('day').sort((a, b) => String(a.day).localeCompare(String(b.day))) };
}

export async function aiUsageReport({ days = 7, now = new Date() } = {}) {
   const d = Math.min(90, Math.max(1, Math.round(Number(days) || 7)));
   const since = new Date(now.getTime() - d * 86_400_000);
   const day = { $dateToString: { format: '%Y-%m-%d', date: '$at', timezone: 'Asia/Dubai' } };
   const logged = await AiUsage.aggregate([
      { $match: { at: { $gte: since } } },
      { $group: { _id: { day, provider: '$provider', model: '$model', feature: '$feature' }, calls: { $sum: 1 }, inputTokens: { $sum: '$inputTokens' }, outputTokens: { $sum: '$outputTokens' }, webSearches: { $sum: '$webSearches' }, costUsd: { $sum: '$costUsd' }, priced: { $sum: { $cond: [{ $eq: ['$costUsd', null] }, 0, 1] } } } },
   ]);
   const firstLogged = (await AiUsage.findOne({}).sort({ at: 1 }).select('at').lean())?.at || now;
   // Agent replies before the usage log existed, from the agents' own log.
   const agentAgg = firstLogged > since ? await AgentAction.aggregate([
      { $match: { at: { $gte: since, $lt: firstLogged }, 'detail.usage': { $ne: null } } },
      { $group: { _id: { day, model: '$detail.model', agent: '$agent' }, calls: { $sum: 1 }, inputTokens: { $sum: '$detail.usage.prompt_tokens' }, outputTokens: { $sum: '$detail.usage.completion_tokens' } } },
   ]) : [];
   const names = Object.fromEntries((await AgentProfile.find({}).select('name').lean().catch(() => [])).map((a) => [String(a._id), a.name]));
   const rows = [
      ...logged.map((g) => ({ ...g._id, calls: g.calls, inputTokens: g.inputTokens, outputTokens: g.outputTokens, webSearches: g.webSearches, costUsd: g.priced ? g.costUsd : null })),
      ...agentAgg.map((g) => ({ day: g._id.day, provider: /^claude-/.test(g._id.model || '') ? 'anthropic' : 'openai', model: g._id.model || '', feature: `agent:${names[String(g._id.agent)] || 'unknown'}`, calls: g.calls, inputTokens: g.inputTokens || 0, outputTokens: g.outputTokens || 0, costUsd: costUsd(g._id.model, g.inputTokens, g.outputTokens) })),
   ];
   return {
      period: `Last ${d} days (Dubai time)`,
      ...summarise(rows),
      loggingSince: firstLogged.toISOString(),
      note: `Costs are estimates at list price in US dollars; a model with no known price shows tokens only. Every AI call is logged since ${firstLogged.toISOString().slice(0, 10)}; before that only agent replies were counted. The provider's own billing page is the final figure. Voice notes (transcription) are not counted.`,
   };
}
