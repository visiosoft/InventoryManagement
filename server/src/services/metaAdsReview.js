/**
 * Meta ads, judged by what their people did here. Every Click-to-WhatsApp
 * chat carries the ad it came from (raw.referral: source_id, headline); each
 * person is followed to their lead — contacted, quotation, site visit, won,
 * lost — so an ad that brings many chats and no customers shows up as such.
 *
 * With Meta's ad account connected (services/metaAds.js), each ad also
 * carries its spend, cost per chat and cost per customer won.
 *
 * Pure: give it the ad-referred first messages and the leads by phone.
 */

const STAGES = ['contacted', 'quotationSent', 'siteVisit', 'won', 'lost'];

export function metaAdsReview({ referrals = [], leadsByPhone = new Map(), spendByAd = null }) {
   const ads = new Map();
   for (const r of referrals) {
      const id = String(r.adId || 'unknown');
      if (!ads.has(id)) ads.set(id, { adId: id, headline: '', people: new Set(), lastAt: null });
      const a = ads.get(id);
      a.people.add(r.phone);
      if (!a.lastAt || new Date(r.at) > new Date(a.lastAt)) { a.lastAt = r.at; if (r.headline) a.headline = r.headline; }
      if (!a.headline && r.headline) a.headline = r.headline;
   }
   const rows = [...ads.values()].map((a) => {
      const c = { people: a.people.size, leads: 0, contacted: 0, quotationSent: 0, siteVisit: 0, won: 0, lost: 0, lostReasons: {} };
      for (const phone of a.people) {
         const l = leadsByPhone.get(phone);
         if (!l) continue;
         c.leads += 1;
         if (l.status !== 'new') c.contacted += 1;
         if (l.status === 'quotation_sent') c.quotationSent += 1;
         if (l.status === 'site_visit_scheduled') c.siteVisit += 1;
         if (l.status === 'won') c.won += 1;
         if (l.status === 'lost') { c.lost += 1; const k = String(l.lostReason || '').trim() || '(no reason recorded)'; c.lostReasons[k] = (c.lostReasons[k] || 0) + 1; }
      }
      const cost = spendByAd?.get(a.adId);
      const spend = cost ? Math.round(cost.spend * 100) / 100 : null;
      return {
         ...(spendByAd ? {
            spend,
            costPerChat: spend != null && a.people.size ? Math.round((spend / a.people.size) * 100) / 100 : null,
            costPerCustomer: spend != null && c.won ? Math.round((spend / c.won) * 100) / 100 : null,
            campaign: cost?.campaign || '',
         } : {}),
         adId: a.adId,
         headline: String(a.headline).slice(0, 120),
         lastChat: a.lastAt,
         ...c,
         winRatePct: c.people ? Math.round((c.won / c.people) * 1000) / 10 : 0,
         lostReasons: Object.entries(c.lostReasons).map(([reason, count]) => ({ reason, count })).sort((x, y) => y.count - x.count).slice(0, 5),
      };
   }).sort((x, y) => y.people - x.people);
   const total = rows.reduce((t, r) => { for (const k of ['people', 'leads', ...STAGES]) t[k] = (t[k] || 0) + r[k]; return t; }, {});
   if (spendByAd) {
      // Ads that cost money but brought nobody here — the clearest waste.
      for (const [adId, c] of spendByAd) {
         if (ads.has(adId) || !c.spend) continue;
         rows.push({ adId, headline: c.adName, campaign: c.campaign, spend: Math.round(c.spend * 100) / 100, costPerChat: null, costPerCustomer: null, people: 0, leads: 0, contacted: 0, quotationSent: 0, siteVisit: 0, won: 0, lost: 0, winRatePct: 0, lostReasons: [], lastChat: null });
      }
      total.spend = Math.round(rows.reduce((t, r) => t + (r.spend || 0), 0) * 100) / 100;
      total.costPerCustomer = total.won ? Math.round((total.spend / total.won) * 100) / 100 : null;
   }
   return { totals: { ...total, winRatePct: total.people ? Math.round((total.won / total.people) * 1000) / 10 : 0 }, ads: rows };
}
