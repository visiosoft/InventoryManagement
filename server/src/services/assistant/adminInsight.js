import { Lead } from '../../models/index.js';
import { chatJson, openaiConfigured } from '../openai.js';
import { dayKeyFor } from '../dailyDigest.js';
import { toolByName } from './tools.js';

/**
 * The "AI insight" tile on the admin Overview screen.
 *
 * Same grounding discipline as the chat assistant: every figure the model is
 * allowed to mention is computed here first and handed to it as plain facts
 * — it only writes the one or two sentences around them, never invents a
 * number the database didn't produce. If OpenAI isn't configured, or the
 * facts themselves say there's nothing notable, this says so plainly rather
 * than force an observation out of thin air.
 */
export async function getAdminInsight() {
   const today = dayKeyFor(new Date());
   const [leadsToday, whatsappToday, overdueFollowUps] = await Promise.all([
      toolByName('leads_recent').run({ from: today, to: today }, {}),
      toolByName('whatsapp_activity').run({ day: 'today' }, { now: new Date() }),
      Lead.countDocuments({ followUpAt: { $lt: new Date() }, status: { $nin: ['won', 'lost', 'already_customer'] } }),
   ]);

   const facts = {
      newLeadsToday: leadsToday.count,
      newLeadsBySource: leadsToday.bySource,
      whatsappMessagesInToday: whatsappToday.messagesIn,
      newWhatsappSendersToday: whatsappToday.newPeople,
      peopleStillWaitingForReply: whatsappToday.stillWaitingForReply,
      overdueFollowUpsAcrossTheTeam: overdueFollowUps,
   };

   const nothingStandsOut = facts.peopleStillWaitingForReply === 0 && facts.overdueFollowUpsAcrossTheTeam === 0 && facts.newLeadsToday === 0;
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

   const out = await chatJson({
      system: [
         "You are summarising today so far for a self-storage company's admin, on a small card under their dashboard stats.",
         'You will be given a JSON object of real figures. Use ONLY those figures — never state, imply or compute a number that is not directly in them.',
         'Pick the single most urgent or notable thing (people waiting for a WhatsApp reply and overdue follow-ups matter most; a plain new-lead count is the fallback when nothing else stands out).',
         'Respond as JSON: {"headline": string (max 6 words, no punctuation at the end), "message": string (one or two short sentences, plain language, no jargon), "ctaLabel": string or null (max 4 words, a button label for the one thing worth doing next, e.g. "See who\'s waiting"), "ctaQuery": string or null (a plain-English question that a separate assistant would answer to act on ctaLabel, e.g. "Who is still waiting for a WhatsApp reply today?") }',
         'ctaLabel/ctaQuery should be null if there is genuinely nothing actionable right now.',
      ].join('\n'),
      messages: [{ role: 'user', content: JSON.stringify(facts) }],
      maxTokens: 220,
   });

   if (!out?.headline || !out?.message) {
      return { headline: 'Today so far', message: `${facts.newLeadsToday} new lead${facts.newLeadsToday === 1 ? '' : 's'}, ${facts.peopleStillWaitingForReply} waiting on a reply.`, ctaLabel: null, ctaQuery: null, facts };
   }
   return {
      headline: String(out.headline).slice(0, 60),
      message: String(out.message).slice(0, 240),
      ctaLabel: out.ctaLabel ? String(out.ctaLabel).slice(0, 40) : null,
      ctaQuery: out.ctaQuery ? String(out.ctaQuery).slice(0, 200) : null,
      facts,
   };
}
