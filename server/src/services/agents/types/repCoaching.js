import { registerAgentType, validatePlan } from '../engine.js';
import { loadThreads, loadPeople, suffix } from '../shared.js';
import { replyGaps, summariseGaps, humanDuration } from '../../inboxAsk.js';
import { chatJson } from '../../openai.js';
import { buildTranscript } from '../../conversationSummary.js';
import { WhatsAppMessage } from '../../../models/index.js';

/**
 * How each rep is doing, and the one thing that would help.
 *
 * The only agent here that reports on **people rather than customers**, and it
 * is written accordingly. A manager will read it about somebody who works for
 * them, so it describes behaviour and shows the conversations behind every
 * number. It does not grade anybody, it does not rank reps against each other,
 * and it is not allowed to characterise a person — only what happened in
 * chats that anybody can go and read.
 *
 * The timing is not the model's opinion either: `replyGaps` and
 * `summariseGaps` already compute how long people waited, and those are facts.
 * The model is only asked what would help.
 */

const DEFAULT_DAYS = 30;
/** Below this there is nothing to say. Three replies is a bad week, not a
 *  pattern, and reporting it as one would be unfair and useless. */
const MIN_CONVERSATIONS = 5;

const SYSTEM = `You review how a storage company's salesperson handled their WhatsApp conversations over a period, and name one specific thing that would help them.

You are given facts the company measured — reply times, how many people are waiting, how many conversations. Never restate a figure; the report shows the numbers already. Never state a figure of your own.

Write about what happened in the conversations, never about the person. "Several enquiries about pricing went unanswered over a weekend" is useful. "He is careless" is not, and is not something you can know.

Do not rank them against anybody. Do not praise or criticise. Describe the pattern and name the change.

Reply with JSON only:
{"pattern": string, "suggestion": string, "strength": string, "confidence": "high"|"medium"|"low"}

pattern: one sentence on what the conversations show. suggestion: one concrete change. strength: one thing they are doing well, or "" if the sample does not show one.`;

export function scoreRep({ waiting, medianMs, p90Ms, conversations }) {
   /* Higher means "needs attention", not "is worse at their job" — the number
      orders a manager's morning, and the factors say what it is made of. */
   let score = 0;
   const factors = [];

   if (waiting) {
      score += Math.min(40, waiting * 4);
      factors.push(`${waiting} ${waiting === 1 ? 'person is' : 'people are'} waiting on a reply`);
   }

   const medianHours = medianMs ? medianMs / 3600_000 : 0;
   if (medianHours >= 1) {
      score += Math.min(30, Math.round(medianHours * 2));
      factors.push(`Usually replies in ${humanDuration(medianMs)}`);
   } else if (medianMs) {
      factors.push(`Usually replies in ${humanDuration(medianMs)}`);
   }

   /* The slow tail matters more than the average: a rep who answers most
      people in minutes and a few after three days has a specific, fixable
      problem, and the median hides it completely. */
   const p90Hours = p90Ms ? p90Ms / 3600_000 : 0;
   if (p90Hours >= 12) {
      score += Math.min(20, Math.round(p90Hours / 2));
      factors.push(`Slowest tenth wait ${humanDuration(p90Ms)}`);
   }

   factors.push(`${conversations} conversation${conversations === 1 ? '' : 's'} in the period`);
   return { score: Math.max(0, score), factors };
}

export default registerAgentType({
   key: 'rep_coaching',
   label: 'Rep coaching',
   describe: 'Reply speed and how conversations were handled, per sales rep, with the chats behind every number. Describes behaviour, never the person.',
   defaults: { days: DEFAULT_DAYS },
   stages: [
      { key: 'collect', label: 'Read conversations' },
      { key: 'group', label: 'Group by rep' },
      { key: 'measure', label: 'Measure reply times' },
      { key: 'judge', label: 'Read & judge' },
   ],

   async collect(ctx) {
      const { config, report, now } = ctx;
      const days = Number(config.days ?? DEFAULT_DAYS);
      const from = new Date(now.getTime() - days * 864e5);

      const [threads, people] = await Promise.all([loadThreads({ from }), loadPeople()]);
      ctx.people = people;
      report.stage('collect', { total: threads.length, done: threads.length });
      report.say(`${threads.length} conversation(s) in the last ${days} days`);

      /* Whose conversation it is comes from the lead's owner. A thread with no
         owned lead belongs to nobody, and that is the unassigned-leads
         problem rather than anybody's reply time. */
      const byOwner = new Map();
      for (const t of threads) {
         const lead = people.byLead.get(suffix(t._id));
         const owner = lead?.owner;
         if (!owner?._id) continue;
         const id = String(owner._id);
         if (!byOwner.has(id)) byOwner.set(id, { owner, threads: [] });
         byOwner.get(id).threads.push(t);
      }
      report.stage('group', { total: byOwner.size, done: byOwner.size });

      const rows = [];
      for (const [id, { owner, threads: theirs }] of byOwner) {
         if (theirs.length < MIN_CONVERSATIONS) continue;

         // Every reply gap across their conversations, from the real messages.
         const phones = theirs.map((t) => t._id);
         const msgs = await WhatsAppMessage.find({ phoneNormalized: { $in: phones }, occurredAt: { $gte: from }, deletedAt: null })
            .select('phoneNormalized direction occurredAt sentByAi text')
            .sort({ occurredAt: 1 })
            .lean();

         const byPhone = new Map();
         for (const m of msgs) {
            if (!byPhone.has(m.phoneNormalized)) byPhone.set(m.phoneNormalized, []);
            byPhone.get(m.phoneNormalized).push(m);
         }

         let gaps = [];
         for (const list of byPhone.values()) gaps = gaps.concat(replyGaps(list));
         // Only what a person did — the assistant's own replies are not theirs.
         const human = gaps.filter((g) => !g.byAi);
         const stats = summariseGaps(human);

         const waiting = theirs.filter((t) =>
            t.lastInboundAt && (!t.lastOutboundAt || t.lastInboundAt > t.lastOutboundAt)).length;

         rows.push({
            key: `user:${id}`,
            phoneNormalized: '',
            displayName: owner.name || 'Unnamed',
            owner,
            conversations: theirs.length,
            waiting,
            stats,
            /* The sample the model actually reads: their slowest few, which is
               where anything worth saying will be. */
            slowest: [...theirs]
               .filter((t) => t.lastInboundAt)
               .sort((a, b) => new Date(a.lastInboundAt) - new Date(b.lastInboundAt))
               .slice(0, 3),
            cacheKey: [id, theirs.length, waiting, Math.round((stats?.medianMs || 0) / 60000)].join('|'),
         });
      }

      report.stage('measure', { total: rows.length, done: rows.length });
      report.stage('judge', { total: rows.length });
      report.say(`${rows.length} rep(s) with enough conversations to say anything about`);
      return rows;
   },

   async judge(row, ctx) {
      const { definition } = ctx;

      // Three of their slowest threads, so any pattern named is one a manager
      // can go and look at rather than take on trust.
      const samples = [];
      for (const t of row.slowest) {
         const msgs = await WhatsAppMessage.find({ phoneNormalized: t._id, deletedAt: null })
            .sort({ occurredAt: -1 }).limit(12).lean();
         samples.push(buildTranscript(msgs.reverse()));
      }

      const facts = [
         `They handled ${row.conversations} conversations in the period.`,
         `${row.waiting} of those people are still waiting on a reply.`,
         row.stats ? `Their usual reply time is ${humanDuration(row.stats.medianMs)}, and their slowest tenth wait ${humanDuration(row.stats.p90Ms)}.` : 'There were too few replies to measure a typical time.',
      ].join('\n');

      const raw = await chatJson({
         system: [SYSTEM, definition?.extraInstructions].filter(Boolean).join('\n\n'),
         messages: [{ role: 'user', content: `FACTS\n${facts}\n\nSOME OF THEIR SLOWEST CONVERSATIONS\n${samples.join('\n\n---\n\n')}` }],
         temperature: 0.3,
         maxTokens: 450,
      });

      const checked = validatePlan(raw, { templates: [], allowedSources: [], prose: ['pattern', 'suggestion', 'strength'] });
      if (!checked.ok) ctx.report.say(`${row.displayName} · advice rejected — ${checked.reason}`, 'warn');
      const plan = checked.ok ? checked.plan : null;

      const { score, factors } = scoreRep({
         waiting: row.waiting,
         medianMs: row.stats?.medianMs,
         p90Ms: row.stats?.p90Ms,
         conversations: row.conversations,
      });

      ctx.report.say(`${row.displayName} · ${row.conversations} chats · ${row.waiting} waiting`);

      return {
         subjectKind: 'user',
         subjectId: row.owner._id,
         // A person is not a campaign audience.
         campaignable: false,
         key: row.key,
         phoneNormalized: '',
         title: row.displayName,
         detail: plan?.pattern || '',
         score,
         factors,
         data: {
            category: 'coaching',
            categoryLabel: 'Sales rep',
            conversations: row.conversations,
            waiting: row.waiting,
            medianReply: row.stats ? humanDuration(row.stats.medianMs) : '—',
            p90Reply: row.stats ? humanDuration(row.stats.p90Ms) : '—',
            fastestReply: row.stats ? humanDuration(row.stats.fastestMs) : '—',
            valueAed: null,
            valueBasis: '',
            windowOpen: true,
            // The threads behind the judgement, so it can be checked.
            examples: row.slowest.map((t) => t._id),
         },
         recommendation: plan
            ? { channel: 'coaching', angle: plan.suggestion, strength: plan.strength || '', confidence: plan.confidence || 'low' }
            : null,
         cacheKey: row.cacheKey,
      };
   },
});
