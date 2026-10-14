import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import express from 'express';

process.env.MCP_ACCESS_TOKEN = 'unit-test-key-0123456789';
process.env.NODE_ENV = 'test';
const { mcpHandler } = await import('./server.js');
const { oauthRouter, wellKnown } = await import('./oauth.js');

async function start() {
  const app = express();
  app.use(express.json());
  wellKnown(app);
  app.use('/api/mcp-oauth', oauthRouter);
  app.all('/api/mcp', mcpHandler);
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}
const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

test('a connector can register, sign in with the key, get a token and use the tools', async () => {
  const { srv, base } = await start();
  try {
    // an unauthenticated call is told where to sign in
    let r = await fetch(`${base}/api/mcp`, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate'), /resource_metadata=/);

    const meta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    assert.ok(meta.registration_endpoint.endsWith('/api/mcp-oauth/register'));
    assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);

    const redirect = 'https://claude.ai/api/mcp/auth_callback';
    r = await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [redirect], client_name: 'Claude' }) });
    assert.equal(r.status, 201);
    const { client_id } = await r.json();

    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const form = (o) => new URLSearchParams(o).toString();
    const auth = { client_id, redirect_uri: redirect, state: 'xyz', code_challenge: challenge, code_challenge_method: 'S256', response_type: 'code' };

    // the page asks for the key; a wrong key is refused
    assert.equal((await fetch(`${meta.authorization_endpoint}?${form(auth)}`)).status, 200);
    r = await fetch(meta.authorization_endpoint, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ ...auth, key: 'wrong' }) });
    assert.equal(r.status, 401);
    // an unregistered redirect address is refused
    assert.equal((await fetch(`${meta.authorization_endpoint}?${form({ ...auth, redirect_uri: 'https://evil.example/cb' })}`)).status, 400);

    r = await fetch(meta.authorization_endpoint, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ ...auth, key: process.env.MCP_ACCESS_TOKEN }) });
    assert.equal(r.status, 302);
    const back = new URL(r.headers.get('location'));
    assert.equal(back.searchParams.get('state'), 'xyz');
    const code = back.searchParams.get('code');

    // wrong verifier fails, right verifier gives a token
    r = await fetch(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id, code_verifier: 'nope' }) });
    assert.equal(r.status, 400);
    r = await fetch(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id, code_verifier: verifier }) });
    assert.equal(r.status, 200);
    const tok = await r.json();

    r = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { ...H, authorization: `Bearer ${tok.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
    assert.equal(r.status, 200);
    const txt = await r.text();
    const data = JSON.parse(txt.includes('data:') ? txt.split('data:')[1].trim() : txt);
    assert.ok(data.result.tools.length > 20);

    // a refresh token gives a new one; a tampered token does not work
    r = await fetch(meta.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }) });
    assert.equal(r.status, 200);
    r = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { ...H, authorization: `Bearer ${tok.access_token}x` }, body: '{}' });
    assert.equal(r.status, 401);
  } finally { srv.close(); }
});
