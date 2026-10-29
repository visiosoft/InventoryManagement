import { Router } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import * as M from '../models.js';
import { scoped } from '../repo.js';
import { render, retrieve } from '../core/knowledge.js';
import { redact } from '../core/text.js';
import { sha256, sameHash, decrypt } from '../security.js';
import { factsFor } from '../host.js';
import { playbookOf } from '../core/playbook.js';

/**
 * For agents and systems running elsewhere, by API key:
 *
 *   GET  /v1/knowledge          the live published answers, {variables} filled
 *   POST /v1/match              the best answers for one customer message
 *   POST /v1/feedback           a case where a person replied differently from the AI
 *   POST /v1/conversations      send conversations in, to be imported later
 *   GET  /v1/rollout            the agent's go-live stage, and its behaviour contract when shared
 *
 * And the WhatsApp Business webhook, verified by the Meta app secret.
 */

/** The organisation an API key belongs to, or null. `tq_<12 hex>_<secret>`. */
export async function orgForKey(header) {
   const m = /^Bearer\s+tq_([a-f0-9]{12})_([A-Za-z0-9_-]{20,})$/.exec(String(header || ''));
   if (!m) return null;
   const org = await M.Org.findOne({ 'apiKeys.id': m[1] }).lean();
   const k = org?.apiKeys?.find((x) => x.id === m[1]);
   if (!k || k.revokedAt) return null;
   return sameHash(k.hash, sha256(m[2])) ? org : null;
}

export const v1 = Router();
v1.use(rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test' }));
v1.use(async (req, res, next) => {
   try {
      const org = await orgForKey(req.headers.authorization);
      if (!org) return res.status(401).json({ error: 'A valid API key is required' });
      req.org = org; req.r = scoped(M, org._id);
      next();
   } catch (e) { next(e); }
});

const active = async (req) => (req.org.activeSnapshot ? (await req.r.snapshots.findOne({ version: req.org.activeSnapshot }))?.items || [] : []);
const values = async (req) => (await factsFor(req.org).catch(() => ({ values: {} }))).values;

v1.get('/knowledge', async (req, res, next) => {
   try {
      const [items, vals] = await Promise.all([active(req), values(req)]);
      res.json({ version: req.org.activeSnapshot, items: items.map((i) => ({ ...i, rendered: render(i.answer, vals).text })) });
   } catch (e) { next(e); }
});

v1.post('/match', async (req, res, next) => {
   try {
      const message = String(req.body?.message || '').slice(0, 2000);
      const [items, vals] = await Promise.all([active(req), values(req)]);
      res.json({ version: req.org.activeSnapshot, ...shared(req.org), matches: retrieve(message, items, { limit: Math.min(Number(req.body?.limit) || 3, 10) }).map(({ r, score }) => ({ id: r.id, version: r.version, score, question: r.question, answer: render(r.answer, vals).text, followUp: r.followUp || '', escalate: r.escalate, escalationNote: r.escalationNote || '' })) });
   } catch (e) { next(e); }
});

/** The stage, and the playbook's contract when the owner chose to share it with their own agent. Pure. */
export function shared(org) {
   const p = playbookOf(org);
   return { stage: org.rollout?.stage || 'sandbox', contract: p.shareContract ? p.contract : '' };
}

v1.get('/rollout', (req, res) => res.json({ ...shared(req.org), intents: req.org.rollout?.intents || [], at: req.org.rollout?.at || null }));

v1.post('/feedback', async (req, res, next) => {
   try {
      const b = req.body || {};
      if (!b.question || !(b.aiReply || b.humanReply)) return res.status(400).json({ error: 'question and aiReply or humanReply are required' });
      const doc = await req.r.feedback.create({ source: String(b.source || 'api').slice(0, 40), question: redact(String(b.question).slice(0, 2000)), aiReply: redact(String(b.aiReply || '').slice(0, 2000)), humanReply: redact(String(b.humanReply || '').slice(0, 2000)), note: redact(String(b.note || '').slice(0, 500)) });
      res.status(201).json({ id: doc._id });
   } catch (e) { next(e); }
});

/** Conversations sent in: [{ conversation, messages: [{ from, text, at, id }] }], up to 2,000 messages a call. Stored masked. */
v1.post('/conversations', async (req, res, next) => {
   try {
      const list = Array.isArray(req.body?.conversations) ? req.body.conversations : [];
      const docs = [];
      for (const c of list) {
         for (const m of Array.isArray(c?.messages) ? c.messages : []) {
            const text = String(m?.text || '').trim();
            if (!text) continue;
            docs.push({ org: req.org._id, source: 'api', conversation: String(c.conversation ?? c.id ?? 'single').slice(0, 120), from: m.from === 'agent' ? 'agent' : 'customer', byAi: Boolean(m.byAi), text: redact(text).slice(0, 4000), at: m.at ? new Date(m.at) : new Date(), ...(m.id ? { externalId: String(m.id).slice(0, 120) } : {}) });
         }
      }
      if (docs.length > 2000) return res.status(400).json({ error: 'Up to 2,000 messages per call' });
      let stored = 0;
      try { stored = (await M.Message.insertMany(docs, { ordered: false })).length; } catch (e) { stored = e.insertedDocs?.length ?? e.result?.insertedCount ?? 0; }
      res.status(201).json({ received: docs.length, stored, duplicates: docs.length - stored });
   } catch (e) { next(e); }
});

/* ---------- WhatsApp Business webhook ---------- */

export const webhooks = Router();

webhooks.get('/whatsapp/:orgId', async (req, res) => {
   const org = /^[0-9a-f]{24}$/i.test(req.params.orgId) ? await M.Org.findById(req.params.orgId).lean() : null;
   if (org?.whatsapp?.verifyToken && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === org.whatsapp.verifyToken) return res.send(String(req.query['hub.challenge'] || ''));
   res.sendStatus(403);
});

/** Meta signs each delivery with the app secret: X-Hub-Signature-256 = sha256=HMAC(body). Pure. */
export function validSignature(rawBody, header, appSecret) {
   const m = /^sha256=([a-f0-9]{64})$/.exec(String(header || ''));
   if (!m || !appSecret || !rawBody) return false;
   return sameHash(m[1], crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex'));
}

/** Customer text messages from a webhook body. Pure. */
export function whatsappMessages(body) {
   const out = [];
   for (const entry of body?.entry || []) for (const ch of entry.changes || []) {
      const v = ch.value || {};
      for (const m of v.messages || []) {
         if (m.type !== 'text' || !m.text?.body) continue;
         out.push({ conversation: String(m.from), externalId: m.id, from: 'customer', text: m.text.body, at: new Date(Number(m.timestamp) * 1000) });
      }
   }
   return out;
}

webhooks.post('/whatsapp/:orgId', async (req, res) => {
   const org = /^[0-9a-f]{24}$/i.test(req.params.orgId) ? await M.Org.findById(req.params.orgId).lean() : null;
   if (!org?.whatsapp?.appSecretEnc || !validSignature(req.rawBody, req.headers['x-hub-signature-256'], decrypt(org.whatsapp.appSecretEnc))) return res.sendStatus(401);
   const msgs = whatsappMessages(req.body).map((m) => ({ ...m, org: org._id, source: 'whatsapp', text: redact(m.text).slice(0, 4000) }));
   if (msgs.length) await M.Message.insertMany(msgs, { ordered: false }).catch(() => null);
   res.sendStatus(200);
});
