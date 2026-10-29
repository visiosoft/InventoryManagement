import axios from 'axios';
import dns from 'node:dns/promises';
import net from 'node:net';
import { decrypt } from './security.js';

/**
 * The Connector protocol: how a customer's own system (a CRM, a helpdesk, a
 * chatbot platform) plugs into the trainer. Four endpoints under one base
 * URL, each called with `Authorization: Bearer <token>`:
 *
 *   GET  {base}/health                       → { ok: true, name }
 *   GET  {base}/conversations?days&limit     → { threads: [{ ref, messages: [{ from: 'customer'|'agent', text, at, byAi }] }] }
 *   GET  {base}/facts                        → { text, values: { name: value } }   live data and {variables}
 *   POST {base}/agent-reply { question, ref, at } → { reply, needsHuman }          their own AI, for tests
 *
 * The URL is customer-supplied, so it must be https and must not resolve to
 * a private, loopback or link-local address — the trainer will not be used
 * to reach inside its own network.
 */

const PRIVATE = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd][0-9a-f]{2}:/i, /^fe80:/i, /^::ffff:(10|127|192\.168|169\.254)\./i];
export const isPrivateIp = (ip) => PRIVATE.some((re) => re.test(String(ip)));

/** Throws unless `url` is an https address that resolves only to public IPs. */
export async function assertPublicUrl(url, { allowInsecureLocal = process.env.CONNECTOR_ALLOW_LOCAL === '1' } = {}) {
   let u;
   try { u = new URL(url); } catch { throw new Error('Enter a full https:// address'); }
   if (allowInsecureLocal) return u;
   if (u.protocol !== 'https:') throw new Error('The connector address must start with https://');
   const host = u.hostname.replace(/^\[|\]$/g, '');
   const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
   if (!ips.length) throw new Error(`${host} could not be found`);
   if (ips.some(isPrivateIp)) throw new Error('The connector address points inside a private network');
   return u;
}

export function connectorClient(org) {
   const base = String(org?.connector?.url || '').replace(/\/+$/, '');
   if (!org?.connector?.enabled || !base) return null;
   const headers = { Authorization: `Bearer ${decrypt(org.connector.tokenEnc)}` };
   const call = async (method, path, { params, data, timeout = 30_000 } = {}) => {
      await assertPublicUrl(`${base}${path}`);
      const res = await axios({ method, url: `${base}${path}`, params, data, headers, timeout, maxRedirects: 0, maxContentLength: 50 * 1024 * 1024 });
      return res.data;
   };
   return {
      health: () => call('get', '/health', { timeout: 10_000 }),
      conversations: async (params) => {
         const d = await call('get', '/conversations', { params, timeout: 120_000 });
         return (Array.isArray(d?.threads) ? d.threads : []).map((t) => ({
            ref: String(t.ref ?? ''),
            messages: (Array.isArray(t.messages) ? t.messages : []).map((m) => ({ from: m.from === 'agent' ? 'agent' : 'customer', text: String(m.text ?? '').slice(0, 4000), at: m.at ? new Date(m.at) : new Date(0), byAi: Boolean(m.byAi) })),
         }));
      },
      facts: async () => {
         const d = await call('get', '/facts', { timeout: 20_000 });
         const values = Object.fromEntries(Object.entries(d?.values || {}).filter(([k]) => /^[a-z][a-z0-9_]{0,40}$/i.test(k)).map(([k, v]) => [k.toLowerCase(), String(v).slice(0, 300)]));
         return { text: String(d?.text || '').slice(0, 20000), values };
      },
      agentReply: async (body) => {
         const d = await call('post', '/agent-reply', { data: body, timeout: 120_000 });
         return { reply: String(d?.reply || ''), needsHuman: Boolean(d?.needsHuman) };
      },
   };
}
