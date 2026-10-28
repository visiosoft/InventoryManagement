import { Lead } from '../../models/index.js';
import { chatJson, openaiConfigured } from '../openai.js';
import { dayKeyFor } from '../dailyDigest.js';
import { startOfDayIn } from '../leadRouting.js';
import { toolByName } from './tools.js';

const OPEN = { $nin: ['won', 'lost', 'already_customer'] };
const RECENT_DAYS = 30;

/**
 * The "AI insight" tile on the admin Overview screen.
 *
 * Same grounding discipline as the chat assistant: every figure the model is
 * allowed to mention is computed here first and handed to it as plain facts
 * — it only writes the one or two sentences around them, never invents a
 * number the database didn't produce. If no AI provider is configured, or
 * the facts themselves say there's nothing notable, this says so plainly
 * rather than force an observation out of thin air.
 *
 * "Overdue" means what a rep sees on their own Follow-ups screen
 * (GET /leads/follow-ups): an open, assigned lead whose follow-up fell due
 * before today began in Dubai. Ones more than RECENT_DAYS old are counted
 * apart as stale — at that age they are a clean-up job, not a call to make
 * today, and lumping them in made the headline number meaningless.
 */
export async function getAdminInsight() {
   const now = new Date();
   const today = dayKeyFor(now);
   const startOfToday = startOfDayIn(now);
   const recentFrom = new Date(startOfToday.getTime() - RECENT_DAYS * 86400_000);
   const overdue = { status: OPEN, owner: { $ne: null } };

   const [leadsToday, whatsappToday, overdueByRep, staleOverdue] = await Promise.all([
      toolByName('leads_recent').run({ from: today, to: today }, {}),
      toolByName('whatsapp_activity').run({ day: 'today' }, { now }),
      Lead.aggregate([
         { $match: { ...overdue, followUpAt: { $gte: recentFrom, $lt: startOfToday } } },
         { $group: { _id: '$owner', count: { $sum: 1 } } },
         { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'rep' } },
         { $project: { _id: 0, rep: { $ifNull: [{ $arrayElemAt: ['$rep.name', 0] }, 'Former staff'] }, count: 1 } },
         { $sort: { count: -1 } },
      ]),
      Lead.countDocuments({ ...overdue, followUpAt: { $lt: recentFrom } }),
   ]);

   const overdueFollowUps = overdueByRep.reduce((n, r) => n + r.count, 0);
   const facts = {
      newLeadsToday: leadsToday.count,
      newLeadsBySource: leadsToday.bySource,
      whatsappMessagesInToday: whatsappToday.messagesIn,
      newWhatsappSendersToday: whatsappToday.newPeople,
      peopleStillWaitingForReply: whatsappToday.stillWaitingForReply,
      overdueFollowUpsLast30Days: overdueFollowUps,
      overdueFollowUpsByRep: overdueByRep,
      staleFollowUpsOlderThan30Days: staleOverdue,
   };

   const nothingStandsOut = facts.peopleStillWaitingForReply === 0 && overdueFollowUps === 0 && facts.newLeadsToday === 0;
   if (!openaiConfigured() || nothingStandsOut) {
      return {
         headline: 'All caught up',
         message: nothingStandsOut
            ? 'No new leads yet, nobody waiting on a reply, and no overdue follow-ups across the team.'
            : `${facts.newLeadsToday} new lead${facts.newLeadsToday === 1 ? '' : 's'} today.`,
         ctaLabel: null,
         ctaQuery: null,
         facts,
      };
   }

   const system = [
      "You write the one insight a self-storage company's sales manager reads first on their phone, on a small card under their dashboard stats.",
      'You will be given a JSON object of real figures. Use ONLY those figures — never state, imply or compute a number that is not directly in them.',
      'Pick the single thing the manager should act on now. Customers waiting for a WhatsApp reply come first; then overdue follow-ups, naming the rep with the most if one rep clearly holds most of them; a plain new-lead count is the fallback when nothing else stands out.',
      'Say what to do, not just what happened: the message should end with the action (who should do what).',
      "Mention staleFollowUpsOlderThan30Days only if it is large next to the recent overdue count, as a clean-up to schedule, never as today's priority.",
      'Respond as JSON: {"headline": string (max 6 words, no punctuation at the end), "message": string (one or two short sentences, plain language, no jargon), "ctaLabel": string or null (max 4 words, a button label for the one thing worth doing next, e.g. "See who\'s waiting"), "ctaQuery": string or null (a plain-English question that a separate assistant would answer to act on ctaLabel, e.g. "Who is still waiting for a WhatsApp reply today?") }',
      'ctaLabel/ctaQuery should be null if there is genuinely nothing actionable right now.',
   ].join('\n');
   const request = { system, messages: [{ role: 'user', content: JSON.stringify(facts) }], maxTokens: 300 };
   // Whichever provider the app is switched to.
   const out = await chatJson({ ...request, effort: 'low' }).catch(() => null);

   if (!out?.headline || !out?.message) {
      return { headline: 'Today so far', message: `${facts.newLeadsToday} new lead${facts.newLeadsToday === 1 ? '' : 's'}, ${facts.peopleStillWaitingForReply} waiting on a reply.`, ctaLabel: null, ctaQuery: null, facts };
   }
   return {
      headline: String(out.headline).slice(0, 60),
      message: String(out.message).slice(0, 280),
      ctaLabel: out.ctaLabel ? String(out.ctaLabel).slice(0, 40) : null,
      ctaQuery: out.ctaQuery ? String(out.ctaQuery).slice(0, 200) : null,
      facts,
   };
}
