import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { connector } from './trainingConnector.js';

const app = express(); app.use(express.json()); app.use('/c', connector);
const server = app.listen(0);
after(() => server.close());
const url = (p) => `http://127.0.0.1:${server.address().port}/c${p}`;

test('the connector answers only with the token the admin generated', async () => {
   process.env.TRAINING_CONNECTOR_TOKEN = 'a-long-random-connector-token-0123456789';
   assert.equal((await fetch(url('/health'))).status, 401);
   assert.equal((await fetch(url('/health'), { headers: { Authorization: 'Bearer wrong-token-wrong-token-wrong' } })).status, 401);
   const ok = await fetch(url('/health'), { headers: { Authorization: `Bearer ${process.env.TRAINING_CONNECTOR_TOKEN}` } });
   assert.equal(ok.status, 200);
   assert.deepEqual(await ok.json(), { ok: true, name: 'PurpleBox CRM' });
   process.env.TRAINING_CONNECTOR_TOKEN = 'short';
   assert.equal((await fetch(url('/health'), { headers: { Authorization: 'Bearer short' } })).status, 401, 'a weak token is refused');
});
