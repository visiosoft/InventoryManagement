import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bulkGuard } from './bulkGuard.js';

const fakeRes = () => { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

test('20 records or fewer pass without a reason', async () => {
   const res = fakeRes();
   assert.equal(await bulkGuard({ body: {} }, res, { action: 'x', count: 20 }), 'small');
   assert.equal(res.code, 0);
});

test('more than 20 without a reason is refused and asks for one', async () => {
   const res = fakeRes();
   assert.equal(await bulkGuard({ body: {} }, res, { action: 'x', count: 21 }), null);
   assert.equal(res.code, 400);
   assert.equal(res.body.code, 'batch_reason_required');
});
