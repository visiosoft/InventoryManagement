import test from 'node:test';
import assert from 'node:assert/strict';
import { Lead, User, WhatsAppMessage } from '../models/index.js';
import { BLOCKS } from './reportBlocks.js';

test('a one-day report covers that whole day in Dubai time (not an empty range)', async () => {
  let seen = null;
  User.find = () => ({ select: () => ({ lean: async () => [] }) });
  Lead.aggregate = async (pipeline) => { seen = pipeline[0].$match.createdAt; return []; };
  Lead.find = () => ({ select: () => ({ lean: async () => [] }) });
  WhatsAppMessage.distinct = async () => [];
  await BLOCKS.leads_by_rep.run({ from: '2026-10-13', to: '2026-10-13' });
  assert.equal(seen.$gte.toISOString(), '2026-10-12T20:00:00.000Z');
  assert.equal(seen.$lte.toISOString(), '2026-10-13T19:59:59.999Z');
  assert.ok(seen.$lte > seen.$gte);
});

test('a lead we messaged on WhatsApp counts as contacted even with no logged attempt', async () => {
  User.find = () => ({ select: () => ({ lean: async () => [{ _id: 'u1', name: 'Sara' }] }) });
  Lead.aggregate = async () => [{ _id: 'u1', leads: 2, contacted: 0, won: 0, lost: 0 }];
  Lead.find = () => ({ select: () => ({ lean: async () => [{ owner: 'u1', phoneNormalized: 'a', attempts: [] }, { owner: 'u1', phoneNormalized: 'b', attempts: [] }] }) });
  WhatsAppMessage.distinct = async () => ['a'];
  const r = await BLOCKS.leads_by_rep.run({ from: '2026-10-01', to: '2026-10-13' });
  assert.equal(r.rows[0][2], 1);
});
