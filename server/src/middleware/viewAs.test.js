import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAuth, signToken } from './auth.js';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const run = (token, method) => new Promise((resolve) => {
  const req = { headers: { authorization: `Bearer ${token}` }, method };
  const res = { status: (c) => ({ json: (b) => resolve({ code: c, body: b }) }) };
  requireAuth(req, res, () => resolve({ code: 200, req }));
});
const user = { _id: 'u1', email: 'a@b.c', name: 'Rep', role: 'sales_rep', permissions: [] };

test('view-as token can read but not write', async () => {
  const t = signToken(user, { viewAs: true, actorId: 'a1' }, '2h');
  assert.equal((await run(t, 'GET')).code, 200);
  assert.equal((await run(t, 'POST')).code, 403);
  assert.equal((await run(t, 'DELETE')).code, 403);
});
test('a normal token can still write', async () => {
  assert.equal((await run(signToken(user), 'POST')).code, 200);
});
