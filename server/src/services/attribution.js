import { Lead } from '../models/index.js';

/**
 * Where a lead came from (WP-10): the first touch, kept forever, and the
 * latest touch, replaced on each new one. A touch is whatever the channel
 * tells us — website UTM tags and landing page, Meta lead-ad ids, or the ad a
 * click-to-WhatsApp chat started from.
 */

const s = (v, n = 160) => String(v ?? '').trim().slice(0, n);
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));

/** From a website form body. Pure. */
export const touchFromWebsite = (b = {}) => compact({
   channel: 'website', utmSource: s(b.utm_source), utmMedium: s(b.utm_medium), utmCampaign: s(b.utm_campaign),
   utmContent: s(b.utm_content), utmTerm: s(b.utm_term), landingPage: s(b.landing_page || b.source_page, 300), referrer: s(b.referrer, 300),
});

/** From a Meta lead-ad payload (already flattened). Pure. */
export const touchFromMeta = (m = {}) => compact({
   channel: 'meta_lead_ad', campaign: s(m.campaign), campaignId: s(m.campaignId), adset: s(m.adset), adsetId: s(m.adsetId),
   ad: s(m.ad), adId: s(m.adId), formId: s(m.formId), form: s(m.form), leadgenId: s(m.leadgenId), platform: s(m.platform, 40),
});

/** From a click-to-WhatsApp referral on the first message. Pure. */
export const touchFromReferral = (r = {}) => compact({
   channel: 'ctwa', adId: s(r.source_id), ad: s(r.headline), referralRef: s(r.ctwa_clid || r.source_url, 300), sourceType: s(r.source_type, 40),
});

/** The new attribution after a touch: first stays once set. Pure. */
export function applyTouch(current = {}, touch, at = new Date()) {
   if (!touch || Object.keys(touch).length <= 1) return current;
   const t = { ...touch, at };
   return { first: current?.first?.at ? current.first : t, last: t };
}

/** Record a touch on a lead without ever overwriting its first touch. Never throws. */
export async function recordTouch(leadId, touch, at = new Date()) {
   if (!leadId || !touch || Object.keys(touch).length <= 1) return;
   const t = { ...touch, at };
   try {
      await Lead.updateOne({ _id: leadId, 'attribution.first.at': { $exists: false } }, { $set: { 'attribution.first': t } });
      await Lead.updateOne({ _id: leadId }, { $set: { 'attribution.last': t } });
   } catch (e) { console.error('[Attribution]', e.message); }
}

/** Click-to-WhatsApp ad referrals in a webhook payload → the lead with that number. */
export async function recordReferralsFromWebhook(payload) {
   for (const entry of payload?.entry || []) for (const ch of entry.changes || []) for (const m of ch.value?.messages || []) {
      if (!m.referral) continue;
      // Leads match on the last nine digits, as everywhere else.
      const last9 = String(m.from || '').replace(/\D/g, '').slice(-9);
      const lead = last9.length === 9 ? await Lead.findOne({ phoneNormalized: { $regex: `${last9}$` } }).sort({ createdAt: -1 }).select('_id').lean() : null;
      if (lead) await recordTouch(lead._id, touchFromReferral(m.referral), m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date());
   }
}

/** Leads and wins by first-touch source and campaign, for a period. */
export async function attributionReport({ days = 30, now = new Date() } = {}) {
   const since = new Date(now.getTime() - Math.min(365, Math.max(1, Number(days) || 30)) * 86_400_000);
   const rows = await Lead.aggregate([
      { $match: { createdAt: { $gte: since }, deletedAt: null } },
      { $group: {
         _id: { source: '$source', channel: { $ifNull: ['$attribution.first.channel', ''] }, campaign: { $ifNull: ['$attribution.first.campaign', { $ifNull: ['$attribution.first.utmCampaign', { $ifNull: ['$attribution.first.ad', ''] }] }] } },
         leads: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } }, lost: { $sum: { $cond: [{ $eq: ['$status', 'lost'] }, 1, 0] } },
      } },
      { $sort: { leads: -1 } },
   ]);
   return {
      days: Math.round((now - since) / 86_400_000),
      rows: rows.map((r) => ({ source: r._id.source, channel: r._id.channel, campaign: r._id.campaign || '(not recorded)', leads: r.leads, won: r.won, lost: r.lost, winRatePct: r.leads ? Math.round((r.won / r.leads) * 1000) / 10 : 0 })),
      note: 'Campaign is the first touch (UTM campaign, Meta campaign, or the click-to-WhatsApp ad). Leads from before attribution was recorded show "(not recorded)".',
   };
}
