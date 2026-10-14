import crypto from 'crypto';
import { Router } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';

/**
 * A small OAuth sign-in for the Claude connector.
 *
 * Claude's connector page expects a remote tool server to offer a sign-in
 * (OAuth with PKCE and dynamic client registration) and shows "Couldn't register
 * with the sign-in service" when there is none. This provides one without a user
 * database: the "sign-in" is typing the access key (MCP_ACCESS_TOKEN) once on a
 * page served here. Clients, codes and tokens are signed with that key, so
 * nothing is stored, and changing the key signs everybody out.
 */

const secret = () => process.env.MCP_ACCESS_TOKEN || '';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (s) => crypto.createHmac('sha256', secret()).update(s).digest('base64url');
const pack = (o) => { const p = b64(o); return `${p}.${sign(p)}`; };
function unpack(tok) {
  const [p, sig] = String(tok || '').split('.');
  if (!p || !sig || !secret()) return null;
  const want = Buffer.from(sign(p)); const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp && o.exp < Date.now() ? null : o; } catch { return null; }
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** Is this bearer value one of our signed access tokens? */
export const validAccessToken = (t) => { const o = unpack(t); return Boolean(o && o.k === 'access'); };

export const baseUrl = (req) => (process.env.PUBLIC_API_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`).replace(/\/$/, '');

export function wellKnown(app) {
  app.get(/^\/\.well-known\/oauth-protected-resource.*/, (req, res) => {
    const b = baseUrl(req);
    res.json({ resource: `${b}/api/mcp`, authorization_servers: [b], bearer_methods_supported: ['header'] });
  });
  app.get(/^\/\.well-known\/oauth-authorization-server.*/, (req, res) => {
    const b = baseUrl(req);
    res.json({
      issuer: b, authorization_endpoint: `${b}/api/mcp-oauth/authorize`, token_endpoint: `${b}/api/mcp-oauth/token`, registration_endpoint: `${b}/api/mcp-oauth/register`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
    });
  });
}

const limiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test' });
export const oauthRouter = Router();
oauthRouter.use(limiter);
oauthRouter.use(express.urlencoded({ extended: false }));
oauthRouter.use(express.json());
oauthRouter.use((req, res, next) => (secret() ? next() : res.status(503).json({ error: 'MCP access is not switched on' })));

// Dynamic client registration: the client id carries its own redirect addresses, signed.
oauthRouter.post('/register', (req, res) => {
  const uris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris.map(String).filter((u) => /^https?:\/\//i.test(u)).slice(0, 10) : [];
  if (!uris.length) return res.status(400).json({ error: 'invalid_redirect_uri' });
  res.status(201).json({ client_id: pack({ k: 'client', r: uris, exp: Date.now() + 365 * 864e5 }), client_name: String(req.body?.client_name || 'Claude'), redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' });
});

const page = (p, error = '') => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Claude to PurpleBox</title>
<style>body{font-family:system-ui,sans-serif;background:#FBF8F2;color:#14081F;display:grid;place-items:center;min-height:100vh;margin:0}form{background:#fff;border:1px solid rgba(20,8,31,.1);border-radius:16px;padding:28px;width:min(92vw,380px)}h1{font-size:18px;margin:0 0 6px}p{font-size:13px;color:#756E80;margin:0 0 16px}input{width:100%;box-sizing:border-box;height:42px;border:1px solid rgba(20,8,31,.2);border-radius:10px;padding:0 12px;font-size:14px}button{margin-top:14px;width:100%;height:42px;border:0;border-radius:10px;background:#5B2BC9;color:#fff;font-weight:700;font-size:14px;cursor:pointer}.e{color:#B91C1C;font-size:13px;margin-top:8px}</style></head>
<body><form method="post"><h1>Connect Claude to PurpleBox</h1><p>Enter the access key to let Claude read and work with the CRM.</p>
${Object.entries(p).map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v ?? '').replace(/"/g, '&quot;')}">`).join('')}
<input type="password" name="key" placeholder="Access key" autofocus autocomplete="off">${error ? `<div class="e">${error}</div>` : ''}<button type="submit">Allow</button></form></body></html>`;

function checkAuthorize(q) {
  const client = unpack(q.client_id);
  if (!client || client.k !== 'client') return 'Unknown client';
  if (!client.r.includes(q.redirect_uri)) return 'The redirect address is not registered for this client';
  if (!q.code_challenge || q.code_challenge_method !== 'S256') return 'PKCE (S256) is required';
  return '';
}
const FIELDS = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'response_type', 'resource', 'scope'];
const pick = (q) => Object.fromEntries(FIELDS.map((f) => [f, q[f] ?? '']));

oauthRouter.get('/authorize', (req, res) => {
  const bad = checkAuthorize(req.query);
  res.set('X-Frame-Options', 'DENY');
  if (bad) return res.status(400).send(bad);
  res.send(page(pick(req.query)));
});

oauthRouter.post('/authorize', (req, res) => {
  res.set('X-Frame-Options', 'DENY');
  const bad = checkAuthorize(req.body);
  if (bad) return res.status(400).send(bad);
  if (!safeEq(req.body.key || '', secret())) return res.status(401).send(page(pick(req.body), 'That key is not right.'));
  const code = pack({ k: 'code', cc: req.body.code_challenge, ru: req.body.redirect_uri, cid: req.body.client_id, exp: Date.now() + 2 * 60_000 });
  const url = new URL(req.body.redirect_uri);
  url.searchParams.set('code', code);
  if (req.body.state) url.searchParams.set('state', req.body.state);
  res.redirect(302, url.toString());
});

const tokens = () => ({
  access_token: pack({ k: 'access', exp: Date.now() + 30 * 864e5 }), token_type: 'Bearer', expires_in: 30 * 86400,
  refresh_token: pack({ k: 'refresh', exp: Date.now() + 180 * 864e5 }),
});

oauthRouter.post('/token', (req, res) => {
  const b = req.body || {};
  res.set('Cache-Control', 'no-store');
  if (b.grant_type === 'refresh_token') {
    const r = unpack(b.refresh_token);
    return r && r.k === 'refresh' ? res.json(tokens()) : res.status(400).json({ error: 'invalid_grant' });
  }
  if (b.grant_type !== 'authorization_code') return res.status(400).json({ error: 'unsupported_grant_type' });
  const c = unpack(b.code);
  if (!c || c.k !== 'code' || c.ru !== b.redirect_uri || (b.client_id && c.cid !== b.client_id)) return res.status(400).json({ error: 'invalid_grant' });
  const challenge = crypto.createHash('sha256').update(String(b.code_verifier || '')).digest('base64url');
  if (!safeEq(challenge, c.cc)) return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE check failed' });
  res.json(tokens());
});
