import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTouch, touchFromWebsite, touchFromMeta, touchFromReferral } from './attribution.js';

test('the first touch is kept forever; the last is replaced', () => {
   const t1 = touchFromWebsite({ utm_source: 'google', utm_campaign: 'storage-dubai', source_page: '/al-quoz' });
   const a = applyTouch({}, t1, new Date('2026-10-01'));
   const t2 = touchFromReferral({ source_id: '1202', headline: '50 sq ft offer', ctwa_clid: 'abc' });
   const b = applyTouch(a, t2, new Date('2026-10-20'));
   assert.equal(b.first.utmCampaign, 'storage-dubai');
   assert.equal(b.last.channel, 'ctwa');
   assert.equal(b.last.adId, '1202');
});

test('an empty touch changes nothing', () => {
   const a = { first: { channel: 'website', at: new Date() } };
   assert.equal(applyTouch(a, touchFromWebsite({})), a);
});

test('Meta lead-ad ids are kept', () => {
   const t = touchFromMeta({ campaign: 'Oct promo', campaignId: '9', adId: '7', formId: '5', leadgenId: '3' });
   assert.deepEqual([t.channel, t.campaignId, t.adId, t.formId, t.leadgenId], ['meta_lead_ad', '9', '7', '5', '3']);
});
