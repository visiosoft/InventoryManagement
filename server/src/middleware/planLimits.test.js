import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceTrialCap } from './planLimits.js';

function fakeRes() {
  const res = {};
  res.statusCode = null;
  res.body = null;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('no req.org (single-tenant, or no organisation yet) is never capped', async () => {
  const Model = { countDocuments: async () => 999 };
  let called = false;
  await enforceTrialCap(Model, 50, 'things')({ org: undefined }, fakeRes(), () => { called = true; });
  assert.equal(called, true);
});

test('a paid plan is never capped, whatever the count', async () => {
  const Model = { countDocuments: async () => 999 };
  let called = false;
  await enforceTrialCap(Model, 50, 'things')({ org: { plan: 'paid' } }, fakeRes(), () => { called = true; });
  assert.equal(called, true);
});

test('a trial plan under the cap passes through', async () => {
  const Model = { countDocuments: async () => 49 };
  let called = false;
  await enforceTrialCap(Model, 50, 'things')({ org: { plan: 'trial' } }, fakeRes(), () => { called = true; });
  assert.equal(called, true);
});

test('a trial plan at the cap is refused with a 403 and a clear message', async () => {
  const Model = { countDocuments: async () => 50 };
  const res = fakeRes();
  let called = false;
  await enforceTrialCap(Model, 50, 'things')({ org: { plan: 'trial' } }, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /limited to 50 things/);
});

test('a trial plan over the cap is also refused', async () => {
  const Model = { countDocuments: async () => 51 };
  const res = fakeRes();
  await enforceTrialCap(Model, 50, 'things')({ org: { plan: 'trial' } }, res, () => {});
  assert.equal(res.statusCode, 403);
});
