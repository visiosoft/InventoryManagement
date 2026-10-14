import test from 'node:test';
import assert from 'node:assert/strict';
import { Lead, Customer } from '../models/index.js';
import { queryData, describeData, apiGet } from './dataTools.js';

const chain = (rows, seen) => { const c = { select: (p) => { seen.proj = p; return c; }, sort: () => c, limit: (n) => { seen.limit = n; return c; }, maxTimeMS: () => c, lean: async () => rows }; return c; };

test('query_data revives dates, hides soft-deleted, strips secrets and caps rows', async () => {
  const seen = {};
  Lead.find = (q) => { seen.q = q; return chain([{ _id: 'x', fullName: 'Ali', phone: '050', apiKey: 'S', signingToken: 'T', nested: { passwordHash: 'H', ok: 1 }, createdAt: new Date('2026-10-01T00:00:00Z') }], seen); };
  Lead.countDocuments = () => ({ maxTimeMS: async () => 1 });
  const r = await queryData({ collection: 'leads', filter: { createdAt: { $gte: '2026-10-13' } }, limit: 5000 });
  assert.ok(seen.q.createdAt.$gte instanceof Date);
  assert.equal(seen.q.createdAt.$gte.toISOString(), '2026-10-12T20:00:00.000Z');
  assert.equal(seen.q.deletedAt, null);
  assert.equal(seen.limit, 200);
  const row = r.rows[0];
  assert.equal(row.fullName, 'Ali');
  assert.ok(!('apiKey' in row) && !('signingToken' in row) && !('passwordHash' in row.nested));
  assert.equal(row.nested.ok, 1);
});

test('code-running and writing operators, unknown collections and sensitive collections are refused', async () => {
  await assert.rejects(() => queryData({ collection: 'leads', filter: { $where: 'sleep(1000)' } }), /not allowed/);
  await assert.rejects(() => queryData({ collection: 'leads', pipeline: [{ $match: {} }, { $out: 'x' }] }), /not allowed/);
  await assert.rejects(() => queryData({ collection: 'leads', pipeline: [{ $lookup: { from: 'users', localField: 'owner', foreignField: '_id', as: 'u' } }] }), /not allowed/);
  await assert.rejects(() => queryData({ collection: 'users' }), /Unknown collection/);
  await assert.rejects(() => queryData({ collection: 'audit_logs' }), /Unknown collection/);
});

test('describe_data lists collections without sensitive ones', async () => {
  const r = await describeData({});
  const names = r.collections.map((c) => c.name);
  assert.ok(names.includes('leads') && names.includes('whatsapp_messages'));
  assert.ok(!names.includes('users') && !names.includes('push_subscriptions'));
});

test('api_get refuses sign-in, users, backup, settings and bad paths', async () => {
  for (const p of ['/auth/login', '/users', '/backup/run', '/api/settings/x', '/mcp', '../etc', 'leads', '//evil.com/x']) {
    await assert.rejects(() => apiGet({ path: p }), /not available|path must/, p);
  }
});
