import { registerAgentType, validatePlan } from '../engine.js';
import { loadThreads, loadPeople, suffix, windowOpen, daysBetween, displayNameFor } from '../shared.js';
import { listWhatsAppTemplates } from '../../whatsapp.js';
import { chatJson } from '../../openai.js';
import { buildTranscript } from '../../conversationSummary.js';
import { WhatsAppMessage, Contract } from '../../../models/index.js';

/**
 * Contracts running out with nobody talking about it.
 *
 * A tenancy ends on a date somebody set months ago, and the only thing that
 * decides whether it renews is whether anyone spoke to the customer first. On
 * production, 99 active contracts end within sixty days. Nothing in the system
 * says which of those conversations has happened.
 *
 * The rule is deliberately about **silence**, not about keywords: looking for
 * the word "renew" would miss every conversation that went "are you staying
 * on?" and would count one where somebody asked about a completely different
 * unit. Whether anybody has spoken at all is the fact; what was said is what
 * the reading is for.
 */

const DEFAULT_WITHIN_DAYS = 60;
/** Below this, silence is not yet negligence — it is a conversation still to
 *  have. Above it, an ending contract nobody has mentioned is the problem. */
const DEFAULT_QUIET_DAYS = 14;

const VARIABLE_SOURCES = ['first_name', 'offer_days', 'unit_size', 'owner_name'];

const SYSTEM = `You read a storage company's WhatsApp conversation with a customer whose rental agreement is ending soon, and say whether they sound like they are staying, leaving, or have not said.

You do not have the company's data. Every fact you need is given to you. Never state a price, a date, a unit size or any other figure — not in prose, not in a variable.

You may only suggest a template from the approved list given to you, by its exact name. If none fits, leave it empty.

Reply with JSON only:
{"reading": "staying"|"leaving"|"undecided"|"not discussed", "whatWentWrong": string, "angle": string, "template": string, "variables": [{"index": number, "source": "first_name"|"offer_days"|"unit_size"|"owner_name"}], "confidence": "high"|"medium"|"low"}

whatWentWrong: one sentence on where the renewal conversation stands. angle: one sentence on what to raise with them, based on what they have actually said.`;

export function scoreRenewal({ daysLeft, monthly, silentDays, everSpoke, months }) {
   let score = 0;
   const factors = [];

   /* Closer to the end is more urgent, and past the end is worse still —
      somebody is either occupying a unit nobody has re-let or about to leave
      without anyone having asked them to stay. */
   const urgency = daysLeft <= 0 ? 45 : daysLeft <= 7 ? 40 : daysLeft <= 14 ? 32 : daysLeft <= 30 ? 22 : 12;
   score += urgency;
   factors.push(daysLeft <= 0
      ? `Ended ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`
      : `Ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`);

   if (monthly) {
      score += Math.min(25, Math.round(monthly / 120));
      factors.push(`AED ${monthly.toLocaleString('en-GB')} a month at stake`);
   }

   if (!everSpoke) {
      score += 15;
      factors.push('No WhatsApp conversation with them at all');
   } else if (silentDays != null) {
      score += Math.min(15, Math.round(silentDays / 3));
      factors.push(`Nothing said for ${silentDays} day${silentDays === 1 ? '' : 's'}`);
   }

   /* A long-standing tenant is worth more effort than a short one, and is more
      likely to stay if somebody simply asks. */
   if (months >= 6) {
      score += 8;
      factors.push(`With us ${months} months`);
   }

   return { score: Math.max(0, score), factors };
}

export default registerAgentType({
   key: 'renewals_at_risk',
   label: 'Renewals at risk',
   describe: 'Contracts ending soon where nobody has had the renewal conversation. Reads the chat and says whether they sound like staying or leaving.',
   defaults: { withinDays: DEFAULT_WITHIN_DAYS, quietDays: DEFAULT_QUIET_DAYS, raiseTasks: true, tasksPerRun: 5 },

   /**
    * The task a finding becomes. Written as the thing to do, not the thing
    * that was noticed — a rep opening My Day should not have to work out what
    * "renewal at risk" means for them this morning.
    */
   taskFor(f) {
      const d = f.data || {};
      const when = d.daysLeft <= 0 ? `ended ${Math.abs(d.daysLeft)} day(s) ago` : `ends in ${d.daysLeft} day(s)`;
      return {
         title: `Ask ${f.title} about renewing — ${d.contractNo} ${when}`,
         description: [
            f.detail,
            f.recommendation?.angle,
            '',
            `Contract ${d.contractNo} · AED ${(d.valueAed || 0).toLocaleString('en-GB')} a month · with us ${d.months || 0} months`,
            d.daysSince != null ? `Nothing said on WhatsApp for ${d.daysSince} days.` : 'No WhatsApp conversation on record.',
            f.phoneNormalized ? `Number: +${f.phoneNormalized}` : '',
            '',
            'Raised by the Renewals at risk agent. Whether they renew is recorded against it automatically.',
         ].filter((x) => x != null).join('\n'),
         leadType: 'contract',
         priority: d.daysLeft <= 7 ? 'high' : 'medium',
         reason: 'Contract ending with no renewal conversation',
      };
   },

   /**
    * Did they renew? A contract for the same customer that started after we
    * pointed at them. Checked against the ledger, not against anything a
    * person typed, so it cannot be forgotten and cannot be fudged.
    */
   outcomeFor(w, { contractsByCustomer }) {
      if (!w.subjectId) return null;
      const later = (contractsByCustomer.get(String(w.subjectId)) || [])
         .filter((c) => ['active', 'pending_signature'].includes(c.status))
         .filter((c) => new Date(c.createdAt || c.startDate) > new Date(w.since))
         .sort((a, b) => new Date(b.createdAt || b.startDate) - new Date(a.createdAt || a.startDate))[0];
      if (!later) return null;
      return {
         kind: 'renewed',
         at: later.createdAt || later.startDate,
         detail: `Renewed on ${later.contractNo}`,
         valueAed: later.leasedPrice || later.rate || w.valueAed,
      };
   },
   stages: [
      { key: 'collect', label: 'Read contracts' },
      { key: 'match', label: 'Match chats' },
      { key: 'check', label: 'Check for renewal talk' },
      { key: 'judge', label: 'Read & judge' },
   ],

   async collect(ctx) {
      const { config, report, now } = ctx;
      const withinDays = Number(config.withinDays ?? DEFAULT_WITHIN_DAYS);
      const quietDays = Number(config.quietDays ?? DEFAULT_QUIET_DAYS);

      /* A little into the past as well as the future: a contract that ended
         last week with nobody having spoken is not less of a problem for
         having passed its date. */
      const from = new Date(now.getTime() - 14 * 864e5);
      const to = new Date(now.getTime() + withinDays * 864e5);

      const contracts = await Contract.find({ status: 'active', endDate: { $gte: from, $lte: to } })
         .select('contractNo customer endDate startDate rate leasedPrice unit')
         .lean();
      report.stage('collect', { total: contracts.length, done: contracts.length });
      report.say(`${contracts.length} contract(s) ending within ${withinDays} days`);

      const [threads, people] = await Promise.all([loadThreads({}), loadPeople()]);
      ctx.people = people;

      // Indexed by customer so a thread can be found from the contract.
      const threadByKey = new Map(threads.map((t) => [suffix(t._id), t]));
      const phoneByCustomer = new Map();
      for (const [key, customer] of people.byCustomer) {
         if (!phoneByCustomer.has(String(customer._id))) phoneByCustomer.set(String(customer._id), key);
      }
      report.stage('match', { total: contracts.length, done: contracts.length });

      const wa = await listWhatsAppTemplates().catch(() => ({ templates: [] }));
      ctx.templates = (wa.templates || []).filter((t) => String(t.status).toUpperCase() === 'APPROVED');

      /* Somebody who already has a later contract has renewed. Without this
         the agent would chase people who signed again last week. */
      const laterByCustomer = new Map();
      for (const c of await Contract.find({ status: { $in: ['active', 'pending_signature'] } })
         .select('customer startDate endDate').lean()) {
         const held = laterByCustomer.get(String(c.customer));
         if (!held || new Date(c.endDate) > new Date(held)) laterByCustomer.set(String(c.customer), c.endDate);
      }

      const rows = [];
      for (const c of contracts) {
         const latest = laterByCustomer.get(String(c.customer));
         if (latest && new Date(latest) > new Date(c.endDate)) continue;

         const key = phoneByCustomer.get(String(c.customer));
         // The customer by id, so one with no phone on record still has a
         // name — a task called "Ask PB-2026-0341 about renewing" helps nobody.
         const customer = people.customerById.get(String(c.customer)) || null;
         if (customer?.unsubscribed) continue;

         const thread = key ? threadByKey.get(key) : null;
         const silentDays = thread ? daysBetween(thread.lastAt, now) : null;

         // Somebody has spoken about it recently enough — leave them be.
         if (silentDays != null && silentDays < quietDays) continue;

         const daysLeft = Math.ceil((new Date(c.endDate) - now) / 864e5);
         const months = c.startDate
            ? Math.max(0, Math.round((new Date(c.endDate) - new Date(c.startDate)) / (30 * 864e5)))
            : 0;

         rows.push({
            key: key || `contract:${c.contractNo}`,
            phoneNormalized: thread?._id || '',
            displayName: customer?.fullName || c.contractNo,
            contract: c, customer, thread,
            daysLeft, silentDays, months,
            monthly: c.leasedPrice || c.rate || 0,
            /* Re-read when the conversation moves or the contract does. The
               day is in the key because urgency changes with it even when
               nothing else has. */
            cacheKey: [thread?.lastMessageId || 'nochat', c.contractNo, daysLeft].join('|'),
         });
      }

      report.stage('check', { total: rows.length, done: rows.length });
      report.stage('judge', { total: rows.length });
      report.say(`${rows.length} with no renewal conversation`);
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
            row.daysLeft <= 0
               ? `Their agreement ended ${Math.abs(row.daysLeft)} days ago.`
               : `Their agreement ends in ${row.daysLeft} days.`,
            `Nobody has spoken to them for ${row.silentDays} days.`,
            `They have rented from us for about ${row.months} months.`,
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

      const { score, factors } = scoreRenewal({
         daysLeft: row.daysLeft,
         monthly: row.monthly,
         silentDays: row.silentDays,
         everSpoke: Boolean(row.thread),
         months: row.months,
      });

      ctx.report.say(
         `${row.displayName} · ${row.contract.contractNo} · ${row.daysLeft <= 0 ? 'ended' : `${row.daysLeft}d left`}`
         + (plan?.reading ? ` → sounds ${plan.reading}` : row.thread ? '' : ' → no chat to read'),
         row.daysLeft <= 7 ? 'warn' : 'info',
      );

      return {
         subjectKind: 'customer',
         subjectId: row.customer?._id || null,
         campaignable: Boolean(row.customer?._id),
         key: row.key,
         phoneNormalized: row.phoneNormalized,
         title: row.displayName,
         detail: plan?.whatWentWrong || (row.thread ? '' : 'No WhatsApp conversation with them at all — this one needs a call.'),
         score,
         factors,
         data: {
            category: 'renewal',
            categoryLabel: row.daysLeft <= 0 ? 'Already ended' : 'Ending soon',
            contractNo: row.contract.contractNo,
            endDate: row.contract.endDate,
            daysLeft: row.daysLeft,
            daysSince: row.silentDays,
            windowOpen: open,
            valueAed: row.monthly || null,
            valueBasis: 'their current rate',
            reading: plan?.reading || 'not discussed',
            months: row.months,
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
            : { channel: 'call', angle: 'No chat history — ring them.' },
         cacheKey: row.cacheKey,
      };
   },
});
