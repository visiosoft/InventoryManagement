import { Lead } from '../models/index.js';
import { intentForLeads } from './leadScore.js';
import { cachedSummaries } from './conversationSummary.js';

/**
 * Intent score saved on the lead (WP-14), so lists, reports and the monthly
 * calibration read one stored value with its reason and time. Recomputed for
 * open leads that changed recently. Uses only conversation summaries already
 * cached — it never asks the AI for a new one, so it adds no AI cost; a lead
 * whose summary is not cached yet waits for the next time one is made.
 */

const OPEN = ['new', 'contacted', 'contact_attempted', 'follow_up_scheduled', 'site_visit_scheduled', 'quotation_sent'];

export async function storeIntentScores({ sinceMinutes = 30, now = new Date(), limit = 300 } = {}) {
   const leads = await Lead.find({ status: { $in: OPEN }, updatedAt: { $gte: new Date(now.getTime() - sinceMinutes * 60_000) } })
      .select('phoneNormalized status intendedStartDate storageStartAt siteVisitAt leadScoreOverride leadScoreOverrideForLeadType').limit(limit).lean();
   if (!leads.length) return { scored: 0 };
   const { fresh } = await cachedSummaries([...new Set(leads.map((l) => l.phoneNormalized).filter(Boolean))]);
   const scores = await intentForLeads(leads, { now, summaries: fresh });
   let scored = 0;
   for (const [id, s] of scores) {
      // timestamps: false — a score is not an edit, and must not re-trigger itself.
      await Lead.updateOne({ _id: id }, { $set: { intentScore: s.score, intentBand: s.band, intentReasons: [s.reason].filter(Boolean), intentComputedAt: now } }, { timestamps: false });
      scored += 1;
   }
   return { scored };
}
