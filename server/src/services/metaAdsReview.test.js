import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metaAdsReview } from './metaAdsReview.js';

test('each ad is judged by what its people did: leads, quotations, wins, losses and why', () => {
   const referrals = [
      { phone: '1', adId: 'A', headline: 'Business Storage in Al Quoz', at: '2026-10-20' },
      { phone: '2', adId: 'A', headline: 'Business Storage in Al Quoz', at: '2026-10-21' },
      { phone: '2', adId: 'A', headline: 'Business Storage in Al Quoz', at: '2026-10-22' },
      { phone: '3', adId: 'B', headline: 'Too much stuff?', at: '2026-10-23' },
   ];
   const leadsByPhone = new Map([
      ['1', { status: 'won' }],
      ['2', { status: 'lost', lostReason: 'Price' }],
      ['3', { status: 'quotation_sent' }],
   ]);
   const { totals, ads } = metaAdsReview({ referrals, leadsByPhone });
   assert.equal(ads[0].adId, 'A');
   assert.deepEqual([ads[0].people, ads[0].won, ads[0].lost, ads[0].winRatePct], [2, 1, 1, 50]);
   assert.deepEqual(ads[0].lostReasons, [{ reason: 'Price', count: 1 }]);
   assert.equal(ads[1].quotationSent, 1);
   assert.deepEqual([totals.people, totals.won, totals.winRatePct], [3, 1, 33.3]);
});

test('with spend: cost per chat and per customer, and ads that cost money but brought nobody', () => {
   const referrals = [{ phone: '1', adId: 'A', at: '2026-10-20' }, { phone: '2', adId: 'A', at: '2026-10-21' }];
   const spendByAd = new Map([['A', { adName: 'A', campaign: 'Storage', spend: 400 }], ['Z', { adName: 'Silent ad', campaign: 'Storage', spend: 150 }]]);
   const { totals, ads } = metaAdsReview({ referrals, leadsByPhone: new Map([['1', { status: 'won' }]]), spendByAd });
   const a = ads.find((r) => r.adId === 'A');
   assert.deepEqual([a.spend, a.costPerChat, a.costPerCustomer], [400, 200, 400]);
   const z = ads.find((r) => r.adId === 'Z');
   assert.deepEqual([z.spend, z.people], [150, 0]);
   assert.deepEqual([totals.spend, totals.costPerCustomer], [550, 550]);
});
