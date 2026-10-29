import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.TRAINER_SECRET = 'test-secret-0123456789abcdef';
process.env.NODE_ENV = 'test';

const { encrypt, decrypt, signSession, readSession, passwordProblem, sha256, sameHash } = await import('../src/security.js');
const { isPrivateIp, assertPublicUrl } = await import('../src/connector.js');
const { validSignature, whatsappMessages, orgForKey } = await import('../src/routes/public.js');
const { firstJson } = await import('../src/providers.js');
const { orgView } = await import('../src/routes/org.js');
const { slugify } = await import('../src/routes/auth.js');
const { createApp } = await import('../src/app.js');

test('secrets are encrypted at rest, and tampering is detected', () => {
   const enc = encrypt('sk-ant-secret-key');
   assert.notEqual(enc, 'sk-ant-secret-key');
   assert.equal(decrypt(enc), 'sk-ant-secret-key');
   const parts = enc.split(':'); parts[3] = Buffer.from('forged').toString('base64');
   assert.throws(() => decrypt(parts.join(':')));
   assert.equal(encrypt(''), '');
});

test('sessions: a signed token reads back; anything else does not; an API key is never a session', () => {
   const t = signSession('abc123');
   assert.equal(readSession(`Bearer ${t}`), 'abc123');
   assert.equal(readSession(`Bearer ${t}x`), null);
   assert.equal(readSession('Bearer tq_0123456789ab_secretsecretsecretsecret'), null);
   assert.equal(readSession(''), null);
});

test('passwords need length and both letters and numbers', () => {
   assert.match(passwordProblem('short1'), /10 characters/);
   assert.match(passwordProblem('onlyletterslong'), /letters and numbers/);
   assert.equal(passwordProblem('good-password-2026'), '');
   assert.ok(sameHash(sha256('x'), sha256('x')) && !sameHash(sha256('x'), sha256('y')));
});

test('connector addresses: https only, never inside a private network', async () => {
   for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.1', '169.254.169.254', '::1', '100.64.0.1']) assert.ok(isPrivateIp(ip), ip);
   assert.ok(!isPrivateIp('8.8.8.8'));
   await assert.rejects(() => assertPublicUrl('http://example.com/x'), /https/);
   await assert.rejects(() => assertPublicUrl('https://127.0.0.1/x'), /private network/);
   await assert.rejects(() => assertPublicUrl('https://169.254.169.254/latest'), /private network/);
   await assert.rejects(() => assertPublicUrl('not a url'), /full https/);
});

test('WhatsApp: only deliveries signed with the app secret are accepted; text messages are extracted', () => {
   const body = Buffer.from(JSON.stringify({ x: 1 }));
   const sig = `sha256=${crypto.createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
   assert.ok(validSignature(body, sig, 'app-secret'));
   assert.ok(!validSignature(body, sig, 'other-secret'));
   assert.ok(!validSignature(body, 'sha256=nope', 'app-secret'));
   const msgs = whatsappMessages({ entry: [{ changes: [{ value: { messages: [
      { from: '971501234567', id: 'w1', timestamp: '1761700000', type: 'text', text: { body: 'how much is 50 sqft?' } },
      { from: '971501234567', id: 'w2', timestamp: '1761700001', type: 'image', image: {} },
   ] } }] }] });
   assert.deepEqual(msgs.map((m) => [m.conversation, m.text]), [['971501234567', 'how much is 50 sqft?']]);
});

test('model output: the first JSON object is found even with prose or nested braces around it', () => {
   assert.deepEqual(firstJson('Sure! {"a":{"b":"}"},"c":[1]} trailing'), { a: { b: '}' }, c: [1] });
   assert.throws(() => firstJson('no json here'), /did not return JSON/);
});

test('settings never send secrets back, only hints', () => {
   const v = orgView({ _id: 'o1', name: 'Acme', ai: { provider: 'anthropic', keyEnc: 'v1:a:b:c', keyHint: '…abcd' }, connector: { url: 'https://x', tokenEnc: 'v1:x', enabled: true }, whatsapp: { verifyToken: 't', appSecretEnc: 'v1:y' }, apiKeys: [{ hash: 'h' }] });
   const s = JSON.stringify(v);
   for (const secret of ['v1:a:b:c', 'v1:x', 'v1:y', '"hash"']) assert.ok(!s.includes(secret), secret);
   assert.equal(v.ai.keyHint, '…abcd');
   assert.equal(v.connector.hasToken, true);
   assert.equal(slugify('PurpleBox Storage, Dubai!'), 'purplebox-storage-dubai');
});

/* ---------- HTTP: nothing is reachable without a session or a key ---------- */

let base; let server;
before(async () => {
   server = createApp().listen(0);
   await new Promise((r) => server.once('listening', r));
   base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); });
const get = (path, headers = {}) => fetch(base + path, { headers });

test('authorization: every organisation route needs a session; the public API needs a key', async () => {
   for (const path of ['/api/org', '/api/training/clusters', '/api/training/overview', '/api/platform', '/api/auth/me']) {
      const r = await get(path);
      assert.equal(r.status, 401, path);
   }
   assert.equal((await get('/api/org', { Authorization: 'Bearer forged.token.here' })).status, 401);
   assert.equal((await get('/api/v1/knowledge')).status, 401);
   assert.equal((await get('/api/v1/knowledge', { Authorization: 'Bearer tq_short' })).status, 401);
   assert.equal(await orgForKey('Bearer not-a-key'), null);
   assert.equal((await get('/api/nothing-here')).status, 404);
   const h = await get('/api/health');
   assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
});

test('the WhatsApp webhook refuses unknown organisations and wrong verify tokens', async () => {
   assert.equal((await get('/api/webhooks/whatsapp/not-an-id?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1')).status, 403);
   const r = await fetch(`${base}/api/webhooks/whatsapp/not-an-id`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
   assert.equal(r.status, 401);
});
