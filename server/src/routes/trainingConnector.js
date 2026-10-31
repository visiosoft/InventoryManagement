import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import axios from 'axios';
import { WhatsAppMessage } from '../models/index.js';
import { conversations, facts, agentFor } from '../services/trainingConnector.js';
import { updateEnvFile } from '../utils/env.js';

/**
 * PurpleBox as a customer of the AI Training Center (a separate product at
 * train.purplebox.ae). Two parts:
 *
 *   /api/training-connector/*   the Connector protocol the Training Center
 *                               calls, with the token set here
 *   /api/training-settings      admins connect the two: generate that token,
 *                               and save the Training Center API key Aisha
 *                               uses to read the published answers
 *
 * Phone numbers never leave the CRM: a conversation goes out under an opaque
 * reference (a keyed hash of the number), mapped back only here when the
 * Training Center asks Aisha to answer a test question.
 */

const token = () => process.env.TRAINING_CONNECTOR_TOKEN || '';
const refKey = () => crypto.createHash('sha256').update(`ref:${token()}`).digest();
export const refFor = (phone) => `wa_${crypto.createHmac('sha256', refKey()).update(String(phone)).digest('hex').slice(0, 24)}`;

let refMap = { at: 0, map: new Map() };
async function phoneForRef(ref) {
   if (Date.now() - refMap.at > 10 * 60_000 || !refMap.map.has(ref)) {
      const phones = await WhatsAppMessage.distinct('phoneNormalized', { occurredAt: { $gte: new Date(Date.now() - 400 * 86_400_000) } });
      refMap = { at: Date.now(), map: new Map(phones.filter(Boolean).map((p) => [refFor(p), p])) };
   }
   return refMap.map.get(ref) || '';
}

function authorized(req) {
   const m = /^Bearer\s+(.+)$/.exec(String(req.headers.authorization || ''));
   const t = token();
   if (!m || !t || t.length < 24) return false;
   const a = crypto.createHash('sha256').update(m[1]).digest(); const b = crypto.createHash('sha256').update(t).digest();
   return crypto.timingSafeEqual(a, b);
}

export const connector = Router();
connector.use((req, res, next) => (authorized(req) ? next() : res.status(401).json({ error: 'Invalid connector token' })));

connector.get('/health', (_req, res) => res.json({ ok: true, name: 'PurpleBox CRM' }));

connector.get('/conversations', async (req, res, next) => {
   try {
      const threads = await conversations({ limit: Math.min(Number(req.query.limit) || 500, 20000), days: Number(req.query.days) || 60, perConversation: Math.min(Math.max(Number(req.query.perConversation) || 3, 1), 20) });
      res.json({ threads: threads.map((t) => ({ ref: refFor(t.ref), messages: t.messages })) });
   } catch (e) { next(e); }
});

connector.get('/facts', async (_req, res, next) => {
   try { res.json(await facts()); } catch (e) { next(e); }
});

connector.post('/agent-reply', async (req, res, next) => {
   try {
      const { AgentProfile } = await import('../agents/models.js');
      const agent = await AgentProfile.findOne({ kind: 'conversational', isActive: { $ne: false } }).sort({ isDefault: -1, createdAt: 1 }).lean();
      if (!agent) return res.status(404).json({ error: 'No conversational agent is set up' });
      const phone = req.body?.ref ? await phoneForRef(String(req.body.ref)) : '';
      const context = Array.isArray(req.body?.context) ? req.body.context.slice(-30).map((m) => ({ from: m?.from === 'agent' ? 'agent' : 'customer', text: String(m?.text || '').slice(0, 2000) })) : null;
      const out = await agentFor(agent).reply({ question: String(req.body?.question || '').slice(0, 2000), ref: context ? '' : phone, at: req.body?.at, context });
      res.json({ reply: out.reply, needsHuman: out.needsHuman, tools: out.tools || [] });
   } catch (e) { next(e); }
});

/* ---------- admins connect the two ---------- */

export const settings = Router();
settings.use((req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' })));

const hint = (s) => (s ? `…${String(s).slice(-4)}` : '');
settings.get('/', (_req, res) => res.json({
   connectorToken: hint(token()),
   trainerKey: hint(process.env.TRAINER_API_KEY),
   trainerUrl: process.env.TRAINER_API_URL || 'http://127.0.0.1:5020/api/v1',
}));

/** A new connector token, shown once, to paste into the Training Center. */
settings.post('/connector-token', async (_req, res, next) => {
   try {
      const t = crypto.randomBytes(32).toString('base64url');
      await updateEnvFile({ TRAINING_CONNECTOR_TOKEN: t });
      process.env.TRAINING_CONNECTOR_TOKEN = t;
      refMap = { at: 0, map: new Map() };
      res.json({ token: t, url: CONNECTOR_URL });
   } catch (e) { next(e); }
});

const CONNECTOR_URL = 'https://api.purplebox.ae/api/training-connector';

/** TRAINER_LINK_TOKEN from the environment, else from the Training Center's own .env on this machine. */
export async function linkToken(read = () => fs.readFile(new URL('../../../trainer/server/.env', import.meta.url), 'utf8')) {
   if (process.env.TRAINER_LINK_TOKEN) return process.env.TRAINER_LINK_TOKEN;
   const text = await read().catch(() => '');
   return /^TRAINER_LINK_TOKEN=(.+)$/m.exec(text)?.[1]?.trim() || '';
}

/**
 * One click: a fresh connector token goes to the Training Center (on this
 * machine), which connects to this CRM and returns an API key for Aisha.
 * Nothing is copied by hand.
 */
settings.post('/connect', async (_req, res, next) => {
   try {
      const link = await linkToken();
      if (!link) return res.status(400).json({ error: 'The AI Training Center is not set up on this server yet' });
      const t = crypto.randomBytes(32).toString('base64url');
      await updateEnvFile({ TRAINING_CONNECTOR_TOKEN: t });
      process.env.TRAINING_CONNECTOR_TOKEN = t;
      refMap = { at: 0, map: new Map() };
      const base = `http://127.0.0.1:${Number(process.env.TRAINER_PORT || 5020)}`;
      let data;
      try {
         ({ data } = await axios.post(`${base}/internal/link`, { url: CONNECTOR_URL, token: t, org: 'purplebox' }, { headers: { 'X-Link-Token': link }, timeout: 30_000 }));
      } catch (e) {
         return res.status(502).json({ error: e.response?.data?.error || 'The AI Training Center did not answer' });
      }
      await updateEnvFile({ TRAINER_API_KEY: data.key });
      process.env.TRAINER_API_KEY = data.key;
      res.json({ ok: true, org: data.org, check: data.check });
   } catch (e) { next(e); }
});

/** The Training Center API key Aisha reads the published answers with. */
settings.post('/trainer-key', async (req, res, next) => {
   try {
      const key = String(req.body?.key || '').trim();
      if (key && !/^tq_[a-f0-9]{12}_[A-Za-z0-9_-]{20,}$/.test(key)) return res.status(400).json({ error: 'That is not a Training Center API key (tq_…)' });
      await updateEnvFile({ TRAINER_API_KEY: key });
      process.env.TRAINER_API_KEY = key;
      res.json({ ok: true });
   } catch (e) { next(e); }
});
