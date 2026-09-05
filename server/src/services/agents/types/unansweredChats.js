import { registerAgentType } from '../engine.js';
import {
   loadThreads, loadPeople, suffix, windowOpen, daysBetween,
   estimateValue, displayNameFor, hasLiveContract,
} from '../shared.js';

/**
 * People waiting on a reply.
 *
 * The cheapest agent here and, on production, the one with the most in it —
 * 113 people had written and had nothing back. It makes **no model calls at
 * all**: who is owed an answer, and how long they have waited, are facts, and
 * asking a model to confirm a fact is how you pay for a worse version of it.
 *
 * It is also the proof the frame is not an OpenAI wrapper. Everything the
 * engine does — stages, feed, caching, findings, snoozing — works identically
 * for an agent that never leaves the database.
 */

/** Anything older than this is not somebody waiting, it is somebody who left.
 *  The missed-leads agent picks those up with a different pitch. */
const DEFAULT_MAX_DAYS = 30;

export function scoreUnanswered({ waitedDays, value, inbound, hasOwner }) {
   let score = 0;
   const factors = [];

   // Waiting is the whole point, so it dominates.
   const wait = Math.min(40, waitedDays * 8);
   score += wait;
   factors.push(waitedDays === 0
      ? 'Waiting since today'
      : `Waiting ${waitedDays} day${waitedDays === 1 ? '' : 's'} for a reply`);

   if (value?.aed) {
      score += Math.min(25, Math.round(value.aed / 100));
      factors.push(`About AED ${value.aed.toLocaleString('en-GB')} a month · ${value.basis}`);
   }

   if (inbound >= 3) {
      score += Math.min(15, inbound);
      factors.push(`${inbound} messages from them, still nothing back`);
   }

   /* Nobody owns it, so nobody is going to notice. Weighted above an owned
      chat of the same age deliberately: an unowned one has no one whose job
      it is to be embarrassed about it. */
   if (!hasOwner) {
      score += 12;
      factors.push('Not assigned to anybody');
   }

   return { score, factors };
}

export default registerAgentType({
   key: 'unanswered_chats',
   label: 'Unanswered chats',
   describe: 'People who wrote to us and never got a reply, ranked by how long they have waited and what they are worth.',
   judges: false,
   defaults: { maxDays: DEFAULT_MAX_DAYS },
   stages: [
      { key: 'collect', label: 'Read conversations' },
      { key: 'match', label: 'Match people' },
      { key: 'rank', label: 'Rank' },
   ],

   async collect(ctx) {
      const { config, report, now } = ctx;
      const maxDays = Number(config.maxDays ?? DEFAULT_MAX_DAYS);

      const threads = await loadThreads({ from: config.from, to: config.to });
      report.stage('collect', { total: threads.length, done: threads.length });
      report.say(`${threads.length} conversation(s) in range`);

      const people = await loadPeople();
      report.stage('match', { total: threads.length, done: threads.length });
      ctx.people = people;

      const rows = [];
      for (const t of threads) {
         const key = suffix(t._id);
         const lead = people.byLead.get(key) || null;
         const customer = people.byCustomer.get(key) || null;

         // They wrote last and nothing has gone back since.
         const waiting = t.lastInboundAt && (!t.lastOutboundAt || t.lastInboundAt > t.lastOutboundAt);
         if (!waiting) continue;

         const waitedDays = daysBetween(t.lastInboundAt, now);
         if (waitedDays > maxDays) continue;
         if (lead?.unsubscribed || customer?.unsubscribed) continue;

         const contracts = customer ? (people.contractsByCustomer.get(String(customer._id)) || []) : [];
         const quote = customer ? (people.quotesByCustomer.get(String(customer._id)) || [])[0] : null;

         rows.push({
            key,
            phoneNormalized: t._id,
            displayName: displayNameFor({ lead, customer, phoneNormalized: t._id }),
            lead, customer, contracts, quote,
            thread: t,
            waitedDays,
            renting: hasLiveContract(contracts),
            // Nothing is judged, so nothing needs a cache key — but the engine
            // still carries one through, and the last message is the honest
            // answer to "has anything changed here".
            cacheKey: '',
         });
      }

      report.stage('rank', { total: rows.length });
      report.say(`${rows.length} waiting on us`);
      return rows;
   },

   async judge(row, ctx) {
      const { people, now } = ctx;
      const value = estimateValue(
         { lead: row.lead, quote: row.quote, contracts: row.contracts },
         people.priceBySize,
      );
      const { score, factors } = scoreUnanswered({
         waitedDays: row.waitedDays,
         value,
         inbound: row.thread.inbound,
         hasOwner: Boolean(row.lead?.owner),
      });

      if (row.renting) factors.push('Currently renting from us');

      const open = windowOpen(row.thread.lastInboundAt, now);
      ctx.report.say(
         `${row.displayName} · waiting ${row.waitedDays}d${open ? '' : ' · window closed'}`,
         row.waitedDays >= 7 ? 'warn' : 'info',
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
         detail: String(row.thread.lastText || '').slice(0, 300),
         score,
         factors,
         data: {
            waitedDays: row.waitedDays,
            lastInboundAt: row.thread.lastInboundAt,
            inbound: row.thread.inbound,
            outbound: row.thread.outbound,
            windowOpen: open,
            valueAed: value.aed,
            valueBasis: value.basis,
            ownerName: row.lead?.owner?.name || '',
            leadStatus: row.lead?.status || '',
            renting: row.renting,
         },
         /* No model wrote this and none needs to. Inside the window a plain
            reply reaches them, which is the entire recommendation. */
         recommendation: open
            ? { channel: 'whatsapp_freeform', angle: 'They are still inside the 24-hour window — just reply.' }
            : { channel: 'whatsapp_template', angle: 'Outside the 24-hour window, so only an approved template will reach them.' },
         cacheKey: '',
      };
   },
});
