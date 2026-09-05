import { registerAgentType, validatePlan } from '../engine.js';
import {
   loadThreads, loadPeople, suffix, windowOpen, daysBetween,
   estimateValue, displayNameFor, hasLiveContract,
} from '../shared.js';
import { wentQuiet, QUIET_DAYS } from '../../chatFollowUp.js';
import { listWhatsAppTemplates } from '../../whatsapp.js';
import { zohoOutstandingByCustomer } from '../../zohoBooks.js';
import { chatJson } from '../../openai.js';
import { buildTranscript } from '../../conversationSummary.js';
import { WhatsAppMessage } from '../../../models/index.js';

/**
 * People we never closed, and what to do about each.
 *
 * The request that started this asked for "clients we missed", assuming the
 * loss was quotations that went unsigned. Measured, that category holds six
 * records. The loss is further upstream: 524 open leads against 59 quotations
 * ever written, so most people never got a price at all. The categories below
 * are ordered by that reality rather than by the assumption.
 */

const CATEGORY_LABEL = {
   never_answered: 'Never answered',
   quoted_unsigned: 'Quoted, never signed',
   never_quoted: 'Asked, never quoted',
   went_quiet: 'Went quiet',
   former_customer: 'Moved out',
};

/* Spelled out for the model, because the label alone is not enough.
 *
 * Given "Category: Never answered" it still wrote "they did not respond to our
 * last messages" — the opposite of what happened, and the sort of confident
 * wrongness a rep would act on. Whose silence it is is the single fact that
 * decides how to re-approach somebody, so it is stated rather than labelled. */
const CATEGORY_MEANS = {
   never_answered: 'They wrote to us and nobody ever replied. The silence is ours, not theirs. Do not suggest that they failed to respond.',
   quoted_unsigned: 'We sent them a price and they never signed.',
   never_quoted: 'They asked about storage and we never sent them a price at all.',
   went_quiet: 'We spoke last and they never came back to us.',
   former_customer: 'They rented from us before and have moved out. This is a win-back, not a first sale.',
};

/** Values the model may name for a template's {{1}}, {{2}} — the server fills
 *  them. A free-text literal is the one opening through which an invented
 *  price or date would reach a customer, so it is not on the list. */
const VARIABLE_SOURCES = ['first_name', 'offer_days', 'unit_size', 'owner_name'];

const SYSTEM = `You review a storage company's WhatsApp conversation with someone who never became a customer, and say why it stalled and how to re-approach them.

You do not have the company's data. Every fact you need is given to you. Never state a price, a unit size, a date or any other figure — not in prose, not in a variable. If you want a number in the message, choose a template that carries it and let the company fill it in.

You may only suggest a template from the approved list given to you, by its exact name. If none fits, leave the template empty; that is a valid answer and better than a wrong one.

Reply with JSON only:
{"whatWentWrong": string, "blocker": "price"|"timing"|"size_uncertainty"|"location"|"competitor"|"no_reply"|"unclear", "angle": string, "template": string, "variables": [{"index": number, "source": "first_name"|"offer_days"|"unit_size"|"owner_name"}], "confidence": "high"|"medium"|"low"}

whatWentWrong: one sentence on why this stalled. angle: one sentence on what would actually interest them, based on what they asked about.`;

export function categorise(row, { now, quietDays = QUIET_DAYS }) {
   const t = row.thread;

   // They wrote and got nothing back. Our failure, and the most recoverable.
   if (t.lastInboundAt && (!t.lastOutboundAt || t.lastInboundAt > t.lastOutboundAt)) {
      return 'never_answered';
   }

   if (row.quote && !row.quote.contract) return 'quoted_unsigned';

   if (row.formerCustomer) return 'former_customer';

   const leadOpen = row.lead && !['won', 'lost'].includes(row.lead.status);
   if (!row.quote && t.inbound >= 2 && leadOpen && !row.renting) return 'never_quoted';

   /* `wentQuiet` refuses a chat whose lead has no status, and that guard is
      load-bearing where it lives — the inbox nudge list and the digest both
      depend on it. So it is not changed; the substitution happens here and
      only here. A thread with no lead record at all is an unowned open
      enquiry, which is exactly the case nobody is watching. */
   const leadStatus = row.lead ? (row.lead.status || '') : 'new';
   if (wentQuiet({
      lastInboundAt: t.lastInboundAt,
      lastOutboundAt: t.lastOutboundAt,
      leadStatus,
      followUpAt: row.lead?.followUpAt || null,
      now,
      days: quietDays,
   })) return 'went_quiet';

   return '';
}

export function scoreMissed({ category, value, daysSince, inbound, attempts, temperature }) {
   let score = 0;
   const factors = [];

   const stage = {
      quoted_unsigned: 40,
      never_answered: 34,
      former_customer: 25,
      never_quoted: 20,
      went_quiet: 16,
   }[category] || 10;
   score += stage;
   factors.push(CATEGORY_LABEL[category] || category);

   if (value?.aed) {
      score += Math.min(20, Math.round(value.aed / 250));
      factors.push(`About AED ${value.aed.toLocaleString('en-GB')} a month · ${value.basis}`);
   }

   const recency = daysSince <= 14 ? 15 : daysSince <= 30 ? 12 : daysSince <= 60 ? 8 : daysSince <= 120 ? 4 : 1;
   score += recency;
   factors.push(`Last heard from ${daysSince} day${daysSince === 1 ? '' : 's'} ago`);

   score += Math.min(10, inbound);
   if (inbound >= 5) factors.push(`${inbound} messages from them — they were interested`);

   if (temperature === 'hot') { score += 10; factors.push('Read as hot in the conversation summary'); }
   else if (temperature === 'cold') { score -= 5; }

   /* Never chased scores higher, not lower. It is the difference between a
      lead that was worked and went nowhere and one nobody ever picked up. */
   if (!attempts) { score += 8; factors.push('No chase ever logged against them'); }

   return { score: Math.max(0, score), factors };
}

export default registerAgentType({
   key: 'missed_leads',
   label: 'Missed leads',
   describe: 'People who never became customers — never answered, quoted but never signed, asked but never quoted, went quiet, or moved out. Reads each conversation and says how to re-approach them.',
   defaults: { quietDays: QUIET_DAYS, minInbound: 1 },
   stages: [
      { key: 'collect', label: 'Read conversations' },
      { key: 'match', label: 'Match people' },
      { key: 'categorise', label: 'Categorise' },
      { key: 'judge', label: 'Read & judge' },
   ],

   async collect(ctx) {
      const { config, report, now } = ctx;

      const threads = await loadThreads({ from: config.from, to: config.to });
      report.stage('collect', { total: threads.length, done: threads.length });
      report.say(`${threads.length} conversation(s) in range`);

      const people = await loadPeople();
      report.stage('match', { total: threads.length, done: threads.length });

      /* The approved templates are the catalogue the model must choose from.
         Fetched once — it is a call out to Meta, and it does not change during
         a run. If WhatsApp is not connected the run still works; it simply has
         no template to recommend, and says so rather than inventing one. */
      const wa = await listWhatsAppTemplates().catch(() => ({ templates: [] }));
      ctx.templates = (wa.templates || []).filter((t) => String(t.status).toUpperCase() === 'APPROVED');
      if (!ctx.templates.length) {
         report.say('No approved WhatsApp templates available — advice will have no template to name', 'warn');
      }
      ctx.people = people;

      // Who has left, so the former-customer rule has something to test.
      const rows = [];
      const formerCustomerIds = [];

      for (const t of threads) {
         const key = suffix(t._id);
         const lead = people.byLead.get(key) || null;
         const customer = people.byCustomer.get(key) || null;
         if (lead?.unsubscribed || customer?.unsubscribed) continue;

         // A last attempt of "wrong number" or "not interested" is an answer.
         const last = lead?.attempts?.length ? lead.attempts[lead.attempts.length - 1] : null;
         if (last && ['wrong_number', 'not_interested'].includes(last.outcome)) continue;

         const contracts = customer ? (people.contractsByCustomer.get(String(customer._id)) || []) : [];
         const renting = hasLiveContract(contracts);
         const quote = customer ? (people.quotesByCustomer.get(String(customer._id)) || [])[0] : null;
         const formerCustomer = Boolean(customer && contracts.length && !renting);
         if (formerCustomer) formerCustomerIds.push(customer);

         const row = {
            key,
            phoneNormalized: t._id,
            displayName: displayNameFor({ lead, customer, phoneNormalized: t._id }),
            lead, customer, contracts, quote, thread: t, renting, formerCustomer,
            daysSince: daysBetween(t.lastAt, now),
            summary: people.summaryByPhone.get(t._id)?.summary || null,
         };

         // Somebody currently renting is not a missed lead.
         if (renting) continue;

         const category = categorise(row, { now, quietDays: Number(config.quietDays ?? QUIET_DAYS) });
         if (!category) continue;
         row.category = category;
         /* Only re-judged when the conversation moved, the category flipped, or
            the template catalogue changed under it. */
         row.cacheKey = [t.lastMessageId || t.lastAt, category, ctx.templates.length].join('|');
         rows.push(row);
      }

      /* Somebody who left owing money is not a win-back. Nothing records *why*
         a tenancy ended, so the balance is the only signal available — and
         "we'd love to have you back" sent to someone in arrears is worse than
         saying nothing at all. */
      if (formerCustomerIds.length) {
         const owed = await zohoOutstandingByCustomer(formerCustomerIds).catch(() => ({ configured: false, byCustomer: new Map() }));
         ctx.balanceKnown = owed.configured;
         if (owed.configured) {
            let dropped = 0;
            for (let i = rows.length - 1; i >= 0; i -= 1) {
               const bal = owed.byCustomer.get(String(rows[i].customer?._id))?.outstanding || 0;
               if (rows[i].category === 'former_customer' && bal > 0) {
                  rows.splice(i, 1);
                  dropped += 1;
               }
            }
            if (dropped) report.say(`${dropped} former customer(s) left out — they still owe money`, 'skip');
         } else {
            report.say('Zoho Books is not connected, so unpaid balances could not be checked', 'warn');
         }
      }

      const counted = rows.reduce((a, r) => ({ ...a, [r.category]: (a[r.category] || 0) + 1 }), {});
      report.stage('categorise', { total: rows.length, done: rows.length });
      report.stage('judge', { total: rows.length });
      report.say(Object.entries(counted).map(([k, n]) => `${CATEGORY_LABEL[k]}: ${n}`).join(' · ') || 'nothing to chase');
      return rows;
   },

   async judge(row, ctx) {
      const { now, templates, definition } = ctx;
      const value = estimateValue(
         { lead: row.lead, quote: row.quote, contracts: row.contracts },
         ctx.people.priceBySize,
      );
      const open = windowOpen(row.thread.lastInboundAt, now);

      /* The stored summary where it is current, the transcript only when it is
         not. Not a shortcut — the summary is the same conversation already
         distilled, and re-reading it word for word buys nothing. */
      let context = '';
      if (row.summary?.headline) {
         context = [
            `Summary: ${row.summary.headline}`,
            row.summary.wants && `They want: ${row.summary.wants}`,
            row.summary.timing && `Timing: ${row.summary.timing}`,
            row.summary.openQuestions?.length && `Unanswered: ${row.summary.openQuestions.join('; ')}`,
         ].filter(Boolean).join('\n');
      } else {
         const msgs = await WhatsAppMessage.find({ phoneNormalized: row.phoneNormalized, deletedAt: null })
            .sort({ occurredAt: -1 }).limit(20).lean();
         context = buildTranscript(msgs.reverse());
      }

      const facts = [
         `What happened: ${CATEGORY_MEANS[row.category]}`,
         `Days since the last message: ${row.daysSince}`,
         `Messages from them: ${row.thread.inbound}; from us: ${row.thread.outbound}`,
         `Can we still send free text: ${open ? 'yes' : 'no, only an approved template'}`,
         row.lead?.status && `Lead status: ${row.lead.status}`,
      ].filter(Boolean).join('\n');

      const catalogue = templates.length
         ? templates.map((t) => `- ${t.name} (${t.variableCount} variable(s)): ${t.bodyText}`).join('\n')
         : '(none available — leave template empty)';

      const raw = await chatJson({
         system: [SYSTEM, definition?.extraInstructions].filter(Boolean).join('\n\n'),
         messages: [{
            role: 'user',
            content: `FACTS\n${facts}\n\nCONVERSATION\n${context}\n\nAPPROVED TEMPLATES\n${catalogue}`,
         }],
         temperature: 0.3,
         maxTokens: 500,
      });

      const checked = validatePlan(raw, {
         templates,
         allowedSources: VARIABLE_SOURCES,
         prose: ['whatWentWrong', 'angle'],
      });

      if (!checked.ok) {
         // Visible, not silent: a rejected plan is a line in the feed, and the
         // finding still stands on the facts it was built from.
         ctx.report.say(`${row.displayName} · advice rejected — ${checked.reason}`, 'warn');
      }
      const plan = checked.ok ? checked.plan : null;

      const { score, factors } = scoreMissed({
         category: row.category,
         value,
         daysSince: row.daysSince,
         inbound: row.thread.inbound,
         attempts: row.lead?.attempts?.length || 0,
         temperature: row.summary?.temperature || row.lead?.temperature || '',
      });

      ctx.report.say(
         `${row.displayName} · ${row.thread.count} msgs → ${CATEGORY_LABEL[row.category]}${plan?.template ? ` → ${plan.template}` : ''}`,
      );

      const subjectKind = row.customer ? 'customer' : 'lead';
      const subjectId = row.customer?._id || row.lead?._id || null;

      return {
         subjectKind,
         subjectId,
         campaignable: Boolean(subjectId),
         key: row.key,
         phoneNormalized: row.phoneNormalized,
         title: row.displayName,
         detail: plan?.whatWentWrong || row.summary?.headline || '',
         score,
         factors,
         data: {
            category: row.category,
            categoryLabel: CATEGORY_LABEL[row.category],
            daysSince: row.daysSince,
            inbound: row.thread.inbound,
            outbound: row.thread.outbound,
            windowOpen: open,
            valueAed: value.aed,
            valueBasis: value.basis,
            leadStatus: row.lead?.status || '',
            ownerName: row.lead?.owner?.name || '',
            quoteNo: row.quote?.quoteNo || '',
            // Meta wants a recorded opt-in before a marketing template, and
            // almost no historic record has one. Carried so the decision can
            // be made with the data in view rather than at send time.
            whatsappOptIn: Boolean(row.lead?.whatsappOptIn?.at || row.customer?.whatsappOptIn?.at),
            balanceChecked: ctx.balanceKnown !== false,
         },
         recommendation: plan
            ? {
               channel: open ? 'whatsapp_freeform' : 'whatsapp_template',
               blocker: plan.blocker,
               angle: plan.angle,
               template: plan.template || '',
               variables: plan.variables || [],
               confidence: plan.confidence || 'low',
            }
            : null,
         cacheKey: row.cacheKey,
      };
   },
});
