/**
 * Per sales rep, over a period: leads given, how far they got, how fast the
 * first WhatsApp reply came, how many were never answered, and what is
 * waiting on them right now. Replies are credited to the lead's owner, the
 * way the dashboard credits them (services/replyActivity.js), and a chat that
 * ends in "Okay 👍" after our reply is not counted as waiting.
 *
 * Pure: give it the leads (with owner names) and each phone's messages.
 */

import { stillWaiting } from './replyActivity.js';

const CLOSED = ['won', 'lost', 'already_customer'];
const median = (xs) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

export function scorecard({ periodLeads = [], openLeads = [], messagesByPhone = new Map(), now = new Date() }) {
   const reps = new Map();
   const rep = (l) => {
      const name = l.owner?.name || 'Unassigned';
      if (!reps.has(name)) reps.set(name, { rep: name, leads: 0, contacted: 0, quotationSent: 0, siteVisit: 0, won: 0, lost: 0, firstReplies: [], neverAnswered: 0, waitingNow: 0, followUpsOverdue: 0 });
      return reps.get(name);
   };

   for (const l of periodLeads) {
      const r = rep(l);
      r.leads += 1;
      if (l.status !== 'new') r.contacted += 1;
      if (l.status === 'quotation_sent') r.quotationSent += 1;
      if (l.status === 'site_visit_scheduled') r.siteVisit += 1;
      if (l.status === 'won') r.won += 1;
      if (l.status === 'lost') r.lost += 1;
      const msgs = messagesByPhone.get(l.phoneNormalized) || [];
      const firstIn = msgs.find((m) => m.direction === 'inbound');
      if (!firstIn) continue;
      const reply = msgs.find((m) => m.direction === 'outbound' && new Date(m.occurredAt) >= new Date(firstIn.occurredAt));
      if (reply) r.firstReplies.push((new Date(reply.occurredAt) - new Date(firstIn.occurredAt)) / 60000);
      else r.neverAnswered += 1;
   }

   for (const l of openLeads) {
      if (CLOSED.includes(l.status)) continue;
      const r = rep(l);
      if (l.followUpAt && new Date(l.followUpAt) < now) r.followUpsOverdue += 1;
      const msgs = messagesByPhone.get(l.phoneNormalized) || [];
      const last = msgs[msgs.length - 1];
      if (!last || last.direction !== 'inbound' || now - new Date(last.occurredAt) < 15 * 60000) continue;
      const repliedBefore = msgs.some((m) => m.direction === 'outbound');
      if (stillWaiting([{ text: last.text, type: last.type, repliedBefore }]).length) r.waitingNow += 1;
   }

   return [...reps.values()].map(({ firstReplies, ...r }) => ({
      ...r,
      winRatePct: r.leads ? Math.round((r.won / r.leads) * 1000) / 10 : 0,
      medianFirstReplyMinutes: firstReplies.length ? Math.round(median(firstReplies)) : null,
      repliedWithin15MinPct: firstReplies.length + r.neverAnswered ? Math.round((firstReplies.filter((t) => t <= 15).length / (firstReplies.length + r.neverAnswered)) * 100) : null,
   })).sort((a, b) => b.leads - a.leads);
}
