/**
 * Meta's ad account, read-only: what each ad cost. Connected in Settings →
 * Integrations with the ad account ID and a token that can read ads (a system
 * user token with ads_read). Nothing here creates, changes or pauses an ad.
 *
 * Joined to the Click-to-WhatsApp chats by ad ID (the referral's source_id),
 * which turns "706 chats" into cost per chat and cost per customer won.
 */

const GRAPH = 'https://graph.facebook.com/v20.0';

export function metaAdsConfigured() {
   return Boolean(process.env.META_ADS_ACCOUNT_ID && process.env.META_ADS_TOKEN);
}

/** "act_123", "123" or a pasted URL with act=123 → "123". */
export function cleanAccountId(v) {
   const m = /(?:act[_=])?(\d{6,})/.exec(String(v || ''));
   return m ? m[1] : '';
}

async function graph(path, params, token) {
   const q = new URLSearchParams({ ...params, access_token: token });
   const r = await fetch(`${GRAPH}/${path}?${q}`);
   const body = await r.json().catch(() => ({}));
   if (!r.ok || body.error) throw new Error(body.error?.message || `Meta said HTTP ${r.status}`);
   return body;
}

/** Checks the account and token with Meta; returns the account's name and currency. */
export async function verifyMetaAds(accountId, token) {
   const id = cleanAccountId(accountId);
   if (!id) throw new Error('That is not an ad account ID (it is a long number, sometimes shown as act_123…)');
   const a = await graph(`act_${id}`, { fields: 'name,currency,account_status' }, token);
   return { id, name: a.name || '', currency: a.currency || '', status: a.account_status };
}

let cache = { key: '', at: 0, data: null };

/**
 * Spend per ad between two days (YYYY-MM-DD), as a Map of ad ID →
 * { adName, campaign, spend, impressions, clicks }. Cached fifteen minutes.
 */
export async function adSpendByAd({ since, until }) {
   if (!metaAdsConfigured()) return { configured: false, byAd: new Map(), currency: '' };
   const key = `${since}:${until}`;
   if (cache.key === key && Date.now() - cache.at < 15 * 60_000) return cache.data;
   const token = process.env.META_ADS_TOKEN;
   const id = cleanAccountId(process.env.META_ADS_ACCOUNT_ID);
   const byAd = new Map();
   let params = { level: 'ad', fields: 'ad_id,ad_name,campaign_name,spend,impressions,clicks,account_currency', time_range: JSON.stringify({ since, until }), limit: '500' };
   let path = `act_${id}/insights`;
   let currency = '';
   for (let page = 0; page < 10; page += 1) {
      const body = await graph(path, params, token);
      for (const r of body.data || []) {
         currency ||= r.account_currency || '';
         const prev = byAd.get(r.ad_id) || { adName: r.ad_name || '', campaign: r.campaign_name || '', spend: 0, impressions: 0, clicks: 0 };
         prev.spend += Number(r.spend || 0);
         prev.impressions += Number(r.impressions || 0);
         prev.clicks += Number(r.clicks || 0);
         byAd.set(r.ad_id, prev);
      }
      const next = body.paging?.cursors?.after;
      if (!body.paging?.next || !next) break;
      params = { ...params, after: next };
   }
   const data = { configured: true, byAd, currency };
   cache = { key, at: Date.now(), data };
   return data;
}
