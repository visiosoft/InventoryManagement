import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorecard } from './repScorecard.js';

const now = new Date('2026-10-28T10:00:00Z');
const at = (min) => new Date(now.getTime() - min * 60000);

test('per rep: leads, stages, first-reply speed, never answered, waiting now, overdue follow-ups', () => {
   const randa = { name: 'Randa' };
   const omar = { name: 'Omar' };
   const periodLeads = [
      { owner: randa, status: 'won', phoneNormalized: '1' },
      { owner: randa, status: 'quotation_sent', phoneNormalized: '2' },
      { owner: omar, status: 'new', phoneNormalized: '3' },
   ];
   const openLeads = [
      { owner: randa, status: 'quotation_sent', phoneNormalized: '2', followUpAt: at(60) },
      { owner: omar, status: 'new', phoneNormalized: '3' },
      { owner: omar, status: 'contacted', phoneNormalized: '4' },
   ];
   const messagesByPhone = new Map([
      ['1', [{ direction: 'inbound', occurredAt: at(600) }, { direction: 'outbound', occurredAt: at(595) }]],
      ['2', [{ direction: 'inbound', occurredAt: at(500) }, { direction: 'outbound', occurredAt: at(440) }, { direction: 'inbound', type: 'text', text: 'Okay thanks 👍', occurredAt: at(400) }]],
      ['3', [{ direction: 'inbound', type: 'text', text: 'How much is 50 sq ft?', occurredAt: at(120) }]],
      ['4', [{ direction: 'outbound', occurredAt: at(300) }, { direction: 'inbound', type: 'text', text: 'Can I visit tomorrow?', occurredAt: at(30) }]],
   ]);
   const rows = scorecard({ periodLeads, openLeads, messagesByPhone, now });
   const r = rows.find((x) => x.rep === 'Randa');
   const o = rows.find((x) => x.rep === 'Omar');
   assert.deepEqual([r.leads, r.won, r.quotationSent, r.winRatePct], [2, 1, 1, 50]);
   assert.equal(r.medianFirstReplyMinutes, 60);
   assert.equal(r.repliedWithin15MinPct, 50);
   assert.equal(r.waitingNow, 0, '"Okay thanks 👍" after our reply is not waiting');
   assert.equal(r.followUpsOverdue, 1);
   assert.equal(o.neverAnswered, 1);
   assert.equal(o.waitingNow, 2);
   assert.equal(o.contacted, 0);
});
