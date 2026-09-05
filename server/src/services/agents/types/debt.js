import { registerAgentType, validatePlan } from '../engine.js';
import { loadThreads, loadPeople, suffix, windowOpen, daysBetween, displayNameFor } from '../shared.js';
import { zohoBooksConfigured, zohoOutstandingByCustomer } from '../../zohoBooks.js';
import { listWhatsAppTemplates } from '../../whatsapp.js';
import { chatJson } from '../../openai.js';
import { buildTranscript } from '../../conversationSummary.js';
import { WhatsAppMessage } from '../../../models/index.js';

/**
 * Money owed that nobody is chasing.
 *
 * Invoicing lives in Zoho Books, so the balance comes from there rather than
 * from anything this system holds — `zohoOutstandingByCustomer` already
 * matches Zoho's contacts to our customers on email and phone, and already
 * counts the money it could not attach to anybody.
 *
 * What this adds is the other half: whether a human has actually said anything
 * about it. A balance on its own is a report. A balance nobody has mentioned
 * in three weeks is a thing to do today.
 */

const DEFAULT_MIN_AED = 100;
const DEFAULT_QUIET_DAYS = 14;

const VARIABLE_SOURCES = ['first_name', 'offer_days', 'owner_name'];

const SYSTEM = `You read a storage company's WhatsApp conversation with a customer who owes money, and report where the conversation about it stands.

You do not have the company's data — not the amount, not the invoice, not the dates. Every fact you need is given to you. Never state a figure of any kind, in prose or in a variable.

Say whether they have promised to pay, disputed the charge, asked for time, or never been asked at all. Be plain and unsentimental; this is read by the person who has to follow it up.

You may only suggest a template from the approved list given to you, by its exact name. If none fits, leave it empty — a debt conversation is usually better as a person writing it themselves.

Reply with JSON only:
{"standing": "promised"|"disputed"|"asked for time"|"never asked"|"unclear", "whatWentWrong": string, "angle": string, "template": string, "variables": [{"index": number, "source": "first_name"|"offer_days"|"owner_name"}], "confidence": "high"|"medium"|"low"}`;

export function scoreDebt({ owed, silentDays, everSpoke, renting }) {
   let score = 0;
   const factors = [];

   score += Math.min(45, Math.round(owed / 200));
   factors.push(`AED ${Math.round(owed).toLocaleString('en-GB')} outstanding`);

   if (!everSpoke) {
      score += 20;
      factors.push('Never mentioned to them on WhatsApp');
   } else if (silentDays != null) {
      score += Math.min(20, Math.round(silentDays / 3));
      factors.push(`Nothing said about it for ${silentDays} day${silentDays === 1 ? '' : 's'}`);
   }

   /* Somebody still renting can be spoken to; somebody who has gone owes the
      same money with far less to talk about. Both matter, and the one still
      here is the one to try first. */
   if (renting) {
      score += 10;
      factors.push('Still renting from us');
   } else {
      factors.push('No longer renting');
   }

   return { score: Math.max(0, score), factors };
}

export default registerAgentType({
   key: 'debt',
   label: 'Debt',
   describe: 'Overdue balances from Zoho Books with nobody chasing them, matched to the customer\'s chat. Reads the conversation and says where it stands.',
   defaults: { minAed: DEFAULT_MIN_AED, quietDays: DEFAULT_QUIET_DAYS },
   stages: [
      { key: 'collect', label: 'Read Zoho Books' },
      { key: 'match', label: 'Match customers' },
      { key: 'check', label: 'Check for a chase' },
      { key: 'judge', label: 'Read & judge' },
   ],

   async collect(ctx) {
      const { config, report, now } = ctx;

      /* Said plainly rather than returning nothing: an empty list from an
         unconfigured integration looks exactly like good news. */
      if (!zohoBooksConfigured()) {
         report.say('Zoho Books is not connected, so there are no balances to read', 'warn');
         report.stage('collect', { total: 0, done: 0 });
         return [];
      }

      const minAed = Number(config.minAed ?? DEFAULT_MIN_AED);
      const quietDays = Number(config.quietDays ?? DEFAULT_QUIET_DAYS);

      const [threads, people] = await Promise.all([loadThreads({}), loadPeople()]);
      ctx.people = people;

      const customers = [...new Set([...people.byCustomer.values()].map((c) => String(c._id)))]
         .map((id) => [...people.byCustomer.values()].find((c) => String(c._id) === id));

      const owed = await zohoOutstandingByCustomer(customers);
      report.stage('collect', { total: owed.byCustomer.size, done: owed.byCustomer.size });
      report.say(`${owed.byCustomer.size} customer(s) matched in Zoho Books`);
      if (owed.unmatchedOwing) {
         // An incomplete list must never read as a complete one.
         report.say(`${owed.unmatchedOwing} Zoho contact(s) owe money but match nobody here`, 'warn');
      }

      const threadByKey = new Map(threads.map((t) => [suffix(t._id), t]));
      const wa = await listWhatsAppTemplates().catch(() => ({ templates: [] }));
      ctx.templates = (wa.templates || []).filter((t) => String(t.status).toUpperCase() === 'APPROVED');

      const rows = [];
      for (const [key, customer] of people.byCustomer) {
         const balance = owed.byCustomer.get(String(customer._id))?.outstanding || 0;
         if (balance < minAed) continue;
         if (customer.unsubscribed) continue;

         const thread = threadByKey.get(key);
         const silentDays = thread ? daysBetween(thread.lastAt, now) : null;
         if (silentDays != null && silentDays < quietDays) continue;

         const contracts = people.contractsByCustomer.get(String(customer._id)) || [];
         rows.push({
            key,
            phoneNormalized: thread?._id || '',
            displayName: displayNameFor({ customer, phoneNormalized: thread?._id || '' }),
            customer, thread, silentDays,
            owed: balance,
            renting: contracts.some((c) => c.status === 'active'),
            cacheKey: [thread?.lastMessageId || 'nochat', Math.round(balance)].join('|'),
         });
      }

      report.stage('match', { total: rows.length, done: rows.length });
      report.stage('check', { total: rows.length, done: rows.length });
      report.stage('judge', { total: rows.length });
      report.say(`${rows.length} owing with nobody chasing`);
      return rows;
   },

   async judge(row, ctx) {
      const { now, templates, definition } = ctx;
      const open = windowOpen(row.thread?.lastInboundAt, now);

      let plan = null;
      if (row.thread) {
         const msgs = await WhatsAppMessage.find({ phoneNormalized: row.phoneNormalized, deletedAt: null })
            .sort({ occurredAt: -1 }).limit(20).lean();

         const facts = [
            'They have an unpaid balance with us.',
            `Nobody has spoken to them for ${row.silentDays} days.`,
            row.renting ? 'They are still renting from us.' : 'They are no longer renting from us.',
            `Can we still send free text: ${open ? 'yes' : 'no, only an approved template'}`,
         ].join('\n');

         const catalogue = templates.length
            ? templates.map((t) => `- ${t.name} (${t.variableCount} variable(s)): ${t.bodyText}`).join('\n')
            : '(none available — leave template empty)';

         const raw = await chatJson({
            system: [SYSTEM, definition?.extraInstructions].filter(Boolean).join('\n\n'),
            messages: [{
               role: 'user',
               content: `FACTS\n${facts}\n\nCONVERSATION\n${buildTranscript(msgs.reverse())}\n\nAPPROVED TEMPLATES\n${catalogue}`,
            }],
            temperature: 0.3,
            maxTokens: 450,
         });

         const checked = validatePlan(raw, {
            templates, allowedSources: VARIABLE_SOURCES, prose: ['whatWentWrong', 'angle'],
         });
         if (!checked.ok) ctx.report.say(`${row.displayName} · advice rejected — ${checked.reason}`, 'warn');
         else plan = checked.plan;
      }

      const { score, factors } = scoreDebt({
         owed: row.owed, silentDays: row.silentDays, everSpoke: Boolean(row.thread), renting: row.renting,
      });

      ctx.report.say(
         `${row.displayName} · owes AED ${Math.round(row.owed).toLocaleString('en-GB')}`
         + (plan?.standing ? ` → ${plan.standing}` : row.thread ? '' : ' → no chat to read'),
         'warn',
      );

      return {
         subjectKind: 'customer',
         subjectId: row.customer._id,
         campaignable: true,
         key: row.key,
         phoneNormalized: row.phoneNormalized,
         title: row.displayName,
         detail: plan?.whatWentWrong || (row.thread ? '' : 'No WhatsApp conversation with them — this one needs a call or an email.'),
         score,
         factors,
         data: {
            category: 'debt',
            categoryLabel: plan?.standing === 'disputed' ? 'Disputed' : row.renting ? 'Owing, still renting' : 'Owing, moved out',
            valueAed: Math.round(row.owed),
            valueBasis: 'outstanding in Zoho Books',
            daysSince: row.silentDays,
            windowOpen: open,
            standing: plan?.standing || 'never asked',
            renting: row.renting,
            lastInboundAt: row.thread?.lastInboundAt,
         },
         recommendation: plan
            ? {
               channel: open ? 'whatsapp_freeform' : 'whatsapp_template',
               angle: plan.angle,
               template: plan.template || '',
               variables: plan.variables || [],
               confidence: plan.confidence || 'low',
            }
            : { channel: 'call', angle: 'No chat history — ring them or send the statement by email.' },
         cacheKey: row.cacheKey,
      };
   },
});
