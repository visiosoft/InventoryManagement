import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import * as M from './models.js';
import { scoped } from './repo.js';
import { can, ROLES, render, retrieve } from './core/knowledge.js';
import * as svc from './service.js';
import { compareRuns } from './core/evaluate.js';
import { redact } from './core/text.js';
import { forgetKnowledge } from './live.js';
import { PURPLEBOX, host as purpleboxHost, facts as purpleboxFacts } from './adapters/purplebox.js';

/**
 * AI Training & Quality Control — HTTP.
 *
 *   /api/training/*     staff, signed in to the CRM; every request resolves the
 *                       person's organisation and role, and each route states
 *                       the permission it needs (checked here, not in the UI)
 *   /api/training/v1/*  external agents, by API key: published knowledge,
 *                       matching, and feedback — read-only apart from feedback
 */

svc.onSetActive(async (org, version) => {
   await M.TrainingOrg.updateOne({ _id: org._id }, { $set: { activeSnapshot: version } });
   forgetKnowledge(org.slug);
});

/** The Purplebox organisation, created on first use. */
async function ensureOrg() {
   const found = await M.TrainingOrg.findOne({ slug: PURPLEBOX.slug }).lean();
   if (found) return found;
   const created = await M.TrainingOrg.create({ slug: PURPLEBOX.slug, name: PURPLEBOX.name, business: PURPLEBOX.business, categories: PURPLEBOX.categories, prohibited: PURPLEBOX.prohibited });
   return created.toObject();
}

/** Who is asking, in which organisation, with which role. CRM admins are owners of the Purplebox organisation. */
async function member(req, res, next) {
   try {
      const org = await ensureOrg();
      const userId = String(req.user?.id || req.user?._id || '');
      let m = await M.TrainingMember.findOne({ org: org._id, userId }).lean();
      if (!m && req.user?.role === 'admin') m = (await M.TrainingMember.create({ org: org._id, userId, name: req.user.name, email: req.user.email, role: 'owner' })).toObject();
      if (!m) return res.status(403).json({ error: 'You are not a member of the AI Training workspace. Ask an admin to add you.' });
      req.org = org; req.role = m.role; req.r = scoped(M, org._id);
      next();
   } catch (e) { next(e); }
}

const need = (action) => (req, res, next) => (can(req.role, action) ? next() : res.status(403).json({ error: `Your role (${req.role}) cannot ${action}` }));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

async function hostFor(req, agentId) {
   let agent = null;
   const { AgentProfile } = await import('../agents/models.js');
   if (agentId) agent = await AgentProfile.findById(agentId).lean().catch(() => null);
   if (!agent) agent = await AgentProfile.findOne({ kind: 'conversational', isActive: { $ne: false } }).sort({ isDefault: -1, createdAt: 1 }).lean();
   return purpleboxHost(agent);
}

const router = Router();
router.use(member);

router.get('/me', (req, res) => res.json({ org: { id: req.org._id, name: req.org.name, categories: req.org.categories, activeSnapshot: req.org.activeSnapshot, business: req.org.business, prohibited: req.org.prohibited }, role: req.role, permissions: ['import', 'review', 'approve', 'publish', 'evaluate', 'manage'].filter((a) => can(req.role, a)) }));

router.get('/overview', need('read'), wrap(async (req, res) => res.json(await svc.overview(req.r, req.org))));

/* ---------- imports ---------- */

router.get('/imports', need('read'), wrap(async (req, res) => res.json({ imports: await req.r.imports.find({}, { sort: { createdAt: -1 }, limit: 30 }) })));
router.get('/imports/:id', need('read'), wrap(async (req, res) => res.json({ import: await req.r.imports.byId(req.params.id) })));

router.post('/imports', need('import'), wrap(async (req, res) => {
   const { source = 'whatsapp', limit = 500, days = 60, perConversation = 3, suggest = 60 } = req.body || {};
   if (source !== 'whatsapp') return res.status(400).json({ error: 'Unknown source' });
   if (await req.r.imports.count({ status: 'running' })) return res.status(409).json({ error: 'An import is already running' });
   const doc = await svc.startImport(req.r, req.org, await hostFor(req), { source, params: { limit: Math.min(Number(limit) || 500, 5000), days, perConversation, suggest, label: `WhatsApp · last ${days} days` }, user: req.user });
   res.status(202).json({ import: doc });
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/** CSV with a header row, or JSON (an array of rows, or { messages: [...] }). Pure. */
export function parseUpload(name, buf) {
   const text = buf.toString('utf8').replace(/^﻿/, '');
   if (/\.json$/i.test(name) || /^\s*[[{]/.test(text)) {
      const data = JSON.parse(text);
      return Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : [];
   }
   const rows = []; let field = ''; let row = []; let q = false;
   for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c; continue; }
      if (c === '"') q = true; else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; } else field += c;
   }
   if (field || row.length) { row.push(field); rows.push(row); }
   const [head = [], ...body] = rows.filter((r) => r.some((x) => x.trim()));
   const keys = head.map((h) => h.trim().toLowerCase());
   return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}

router.post('/imports/upload', need('import'), upload.single('file'), wrap(async (req, res) => {
   if (!req.file) return res.status(400).json({ error: 'Choose a CSV or JSON file' });
   let rows;
   try { rows = parseUpload(req.file.originalname, req.file.buffer); } catch { return res.status(400).json({ error: 'That file could not be read as CSV or JSON' }); }
   if (!rows.length) return res.status(400).json({ error: 'No messages found. Columns needed: conversation, from (customer/agent), text, at' });
   if (rows.length > 200000) return res.status(400).json({ error: 'Up to 200,000 messages per file' });
   const doc = await svc.startImport(req.r, req.org, await hostFor(req), { source: 'upload', rows, params: { limit: Number(req.body?.limit) || 500, label: req.file.originalname.slice(0, 80) }, user: req.user });
   res.status(202).json({ import: doc });
}));

/* ---------- intents ---------- */

router.get('/clusters', need('read'), wrap(async (req, res) => {
   const { status, category, q } = req.query;
   const filter = {};
   if (status) filter.status = String(status);
   if (category) filter.category = String(category);
   if (q) filter.$or = [{ name: { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { question: { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }];
   const clusters = await req.r.clusters.find(filter, { sort: { count: -1, createdAt: 1 }, limit: 500, select: '-history -comments' });
   res.json({ clusters: clusters.map((c) => ({ ...c, bulkEligible: svc.bulkEligible(c) })) });
}));

router.get('/clusters/:id', need('read'), wrap(async (req, res) => {
   const c = await req.r.clusters.byId(req.params.id);
   if (!c) return res.status(404).json({ error: 'Intent not found' });
   const [questions, record, values] = await Promise.all([
      req.r.questions.find({ cluster: c._id }, { sort: { repeats: -1, at: -1 }, limit: 60, select: 'text lang repeats split context humanReply at' }),
      c.record ? req.r.knowledge.byId(c.record) : null,
      purpleboxFacts().then((f) => f.values).catch(() => ({})),
   ]);
   res.json({ cluster: c, questions, record, preview: c.suggestion?.text ? render(c.suggestion.text, values) : null });
}));

router.post('/clusters/:id/suggest', need('review'), wrap(async (req, res) => {
   const c = await req.r.clusters.byId(req.params.id);
   if (!c) return res.status(404).json({ error: 'Intent not found' });
   res.json({ suggestion: await svc.suggest(req.r, req.org, await hostFor(req), c, req.user) });
}));

router.post('/clusters/:id/review', wrap(async (req, res) => {
   const action = String(req.body?.action || '');
   const needs = ['approve', 'edit', 'save_new', 'escalate'].includes(action) ? 'approve' : 'review';
   if (!can(req.role, needs)) return res.status(403).json({ error: `Your role (${req.role}) cannot ${action}` });
   const c = await req.r.clusters.byId(req.params.id);
   if (!c) return res.status(404).json({ error: 'Intent not found' });
   try {
      const out = await svc.review(req.r, c, action, req.body || {}, req.user);
      await svc.audit(req.r, req.user, `review.${action}`, c._id, { record: out.record, version: out.version });
      res.json(out);
   } catch (e) { res.status(400).json({ error: e.message }); }
}));

router.post('/clusters/bulk-approve', need('approve'), wrap(async (req, res) => {
   const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).slice(0, 200);
   let approved = 0; const skipped = [];
   for (const id of ids) {
      const c = await req.r.clusters.byId(id);
      if (!c || !svc.bulkEligible(c)) { skipped.push(id); continue; }
      await svc.review(req.r, c, 'approve', { note: 'Bulk approved' }, req.user);
      approved += 1;
   }
   await svc.audit(req.r, req.user, 'review.bulk_approve', '', { approved, skipped: skipped.length });
   res.json({ approved, skipped: skipped.length });
}));

router.patch('/clusters/:id', need('review'), wrap(async (req, res) => {
   const set = {};
   for (const k of ['name', 'question']) if (typeof req.body?.[k] === 'string' && req.body[k].trim()) set[k] = req.body[k].trim().slice(0, 300);
   if (req.body?.category && req.org.categories.includes(req.body.category)) set.category = req.body.category;
   await req.r.clusters.updateOne({ _id: req.params.id }, { $set: set, $push: { history: { action: 'renamed', by: { userId: String(req.user?.id), name: req.user?.name }, at: new Date(), note: JSON.stringify(set).slice(0, 300) } } });
   res.json({ ok: true });
}));

/** Merge: this intent's questions move into another; this one is removed. */
router.post('/clusters/:id/merge', need('review'), wrap(async (req, res) => {
   const [from, into] = await Promise.all([req.r.clusters.byId(req.params.id), req.r.clusters.byId(req.body?.into)]);
   if (!from || !into || String(from._id) === String(into._id)) return res.status(400).json({ error: 'Pick a different intent to merge into' });
   if (from.record) return res.status(400).json({ error: 'This intent has an approved answer — archive it first, or merge the other way' });
   await req.r.questions.updateMany({ cluster: from._id }, { $set: { cluster: into._id } });
   await req.r.clusters.deleteMany({ _id: from._id });
   await svc.recount(req.r);
   await svc.audit(req.r, req.user, 'cluster.merge', into._id, { from: from.key });
   res.json({ ok: true, into: into._id });
}));

/** Split: chosen questions leave for a new intent of their own. */
router.post('/clusters/:id/split', need('review'), wrap(async (req, res) => {
   const from = await req.r.clusters.byId(req.params.id);
   const ids = (Array.isArray(req.body?.questionIds) ? req.body.questionIds : []).slice(0, 500);
   const name = String(req.body?.name || '').trim().slice(0, 80);
   if (!from || !ids.length || !name) return res.status(400).json({ error: 'Pick questions and name the new intent' });
   const key = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Date.now().toString(36)}`;
   const first = await req.r.questions.findOne({ _id: ids[0], cluster: from._id });
   const created = await req.r.clusters.create({ key, name, category: req.org.categories.includes(req.body?.category) ? req.body.category : from.category, question: first?.text || name, status: 'new' });
   await req.r.questions.updateMany({ _id: { $in: ids }, cluster: from._id }, { $set: { cluster: created._id } });
   await svc.recount(req.r);
   await svc.audit(req.r, req.user, 'cluster.split', created._id, { from: from.key, questions: ids.length });
   res.json({ ok: true, cluster: created._id });
}));

/* ---------- knowledge ---------- */

router.get('/knowledge', need('read'), wrap(async (req, res) => {
   const filter = {};
   if (req.query.status) filter.status = String(req.query.status);
   else filter.status = { $ne: 'archived' };
   res.json({ records: await req.r.knowledge.find(filter, { sort: { category: 1, updatedAt: -1 }, limit: 1000 }) });
}));

router.patch('/knowledge/:id', need('approve'), wrap(async (req, res) => {
   const rec = await req.r.knowledge.byId(req.params.id, { doc: true });
   if (!rec) return res.status(404).json({ error: 'Answer not found' });
   const answer = String(req.body?.answer ?? rec.answer).trim();
   if (!answer || answer.length > 2000) return res.status(400).json({ error: 'An answer is 1–2,000 characters' });
   const by = { userId: String(req.user?.id), name: req.user?.name };
   rec.versions.push({ version: rec.version + 1, answer, followUp: req.body?.followUp ?? rec.followUp, status: 'approved', by, at: new Date(), note: String(req.body?.note || '').slice(0, 300), original: rec.answer });
   Object.assign(rec, {
      answer, version: rec.version + 1, status: 'approved', approvedBy: by, approvedAt: new Date(),
      ...(typeof req.body?.followUp === 'string' ? { followUp: req.body.followUp.slice(0, 500) } : {}),
      ...(typeof req.body?.question === 'string' && req.body.question.trim() ? { question: req.body.question.trim().slice(0, 300) } : {}),
      ...(Array.isArray(req.body?.variations) ? { variations: req.body.variations.map(String).slice(0, 30) } : {}),
      ...(typeof req.body?.escalate === 'boolean' ? { escalate: req.body.escalate } : {}),
      ...(req.body?.expiresAt !== undefined ? { expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null } : {}),
   });
   await rec.save();
   await svc.audit(req.r, req.user, 'knowledge.edit', rec._id, { version: rec.version });
   res.json({ record: rec });
}));

router.post('/knowledge/:id/archive', need('approve'), wrap(async (req, res) => {
   await req.r.knowledge.updateOne({ _id: req.params.id }, { $set: { status: 'archived' } });
   await svc.audit(req.r, req.user, 'knowledge.archive', req.params.id);
   res.json({ ok: true });
}));

router.get('/conflicts', need('read'), wrap(async (req, res) => res.json({ conflicts: await svc.conflicts(req.r) })));
router.get('/variables', need('read'), wrap(async (req, res) => res.json({ values: (await purpleboxFacts().catch(() => ({ values: {} }))).values })));

router.get('/snapshots', need('read'), wrap(async (req, res) => res.json({ active: req.org.activeSnapshot, snapshots: await req.r.snapshots.find({}, { sort: { version: -1 }, limit: 50, select: 'version count note publishedBy createdAt conflicts' }) })));
router.post('/publish', need('publish'), wrap(async (req, res) => {
   const out = await svc.publish(req.r, req.org, { note: req.body?.note, force: Boolean(req.body?.force) }, req.user);
   res.status(out.error ? 409 : 200).json(out);
}));
router.post('/rollback', need('publish'), wrap(async (req, res) => {
   const out = await svc.rollback(req.r, req.org, req.body?.version, req.user);
   res.status(out.error ? 400 : 200).json(out);
}));

/* ---------- evaluation ---------- */

router.get('/agents', need('read'), wrap(async (_req, res) => {
   const { AgentProfile } = await import('../agents/models.js');
   res.json({ agents: await AgentProfile.find({ kind: 'conversational' }).select('name role isDefault isActive').lean() });
}));
router.get('/evals', need('read'), wrap(async (req, res) => {
   const evals = await req.r.evals.find({}, { sort: { createdAt: -1 }, limit: 20, select: '-cases' });
   const done = evals.filter((e) => e.status === 'done');
   res.json({ evals, comparison: done.length >= 2 ? compareRuns(done[1].summary, done[0].summary) : null });
}));
router.get('/evals/:id', need('read'), wrap(async (req, res) => res.json({ eval: await req.r.evals.byId(req.params.id) })));
router.post('/evals', need('evaluate'), wrap(async (req, res) => {
   if (await req.r.evals.count({ status: 'running' })) return res.status(409).json({ error: 'A test is already running' });
   const out = await svc.startEval(req.r, req.org, await hostFor(req, req.body?.agentId), { limit: req.body?.limit, label: req.body?.label }, req.user);
   res.status(out.error ? 400 : 202).json(out.error ? out : { eval: out });
}));

/* ---------- feedback, keys, team, audit ---------- */

router.get('/feedback', need('read'), wrap(async (req, res) => res.json({ feedback: await req.r.feedback.find({ status: req.query.status || 'open' }, { sort: { createdAt: -1 }, limit: 200 }) })));
router.patch('/feedback/:id', need('review'), wrap(async (req, res) => {
   const status = ['open', 'used', 'dismissed'].includes(req.body?.status) ? req.body.status : 'dismissed';
   await req.r.feedback.updateOne({ _id: req.params.id }, { $set: { status } });
   res.json({ ok: true });
}));

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
router.get('/keys', need('manage'), wrap(async (req, res) => {
   const org = await M.TrainingOrg.findById(req.org._id).select('apiKeys').lean();
   res.json({ keys: (org.apiKeys || []).map(({ hash: _h, ...k }) => k) });
}));
router.post('/keys', need('manage'), wrap(async (req, res) => {
   const id = crypto.randomBytes(6).toString('hex'); const secret = crypto.randomBytes(24).toString('base64url');
   const key = `tq_${id}_${secret}`;
   await M.TrainingOrg.updateOne({ _id: req.org._id }, { $push: { apiKeys: { id, label: String(req.body?.label || 'API key').slice(0, 60), hash: hash(secret), last4: secret.slice(-4), createdAt: new Date() } } });
   await svc.audit(req.r, req.user, 'key.create', id);
   res.status(201).json({ key, note: 'Copy it now — it is not shown again.' });
}));
router.delete('/keys/:id', need('manage'), wrap(async (req, res) => {
   await M.TrainingOrg.updateOne({ _id: req.org._id, 'apiKeys.id': req.params.id }, { $set: { 'apiKeys.$.revokedAt': new Date() } });
   await svc.audit(req.r, req.user, 'key.revoke', req.params.id);
   res.json({ ok: true });
}));

router.get('/members', need('read'), wrap(async (req, res) => res.json({ members: await req.r.members.find({}, { sort: { createdAt: 1 } }), roles: ROLES })));
router.post('/members', need('manage'), wrap(async (req, res) => {
   const { userId, role } = req.body || {};
   if (!ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
   const { User } = await import('../models/index.js');
   const u = await User.findById(userId).select('name email').lean().catch(() => null);
   if (!u) return res.status(404).json({ error: 'No such user' });
   await req.r.members.updateOne({ userId: String(u._id) }, { $set: { role, name: u.name, email: u.email } }, { upsert: true });
   await svc.audit(req.r, req.user, 'member.set', u._id, { role });
   res.json({ ok: true });
}));
router.get('/audit', need('manage'), wrap(async (req, res) => res.json({ audit: await req.r.audit.find({}, { sort: { at: -1 }, limit: 200 }) })));

router.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

export default router;

/* ---------- public API, for external agents ---------- */

/** The organisation an API key belongs to, or null. `tq_<id>_<secret>`. */
export async function orgForKey(header) {
   const m = /^Bearer\s+tq_([a-f0-9]{12})_([A-Za-z0-9_-]{20,})$/.exec(String(header || ''));
   if (!m) return null;
   const org = await M.TrainingOrg.findOne({ 'apiKeys.id': m[1] }).lean();
   const k = org?.apiKeys?.find((x) => x.id === m[1]);
   if (!k || k.revokedAt) return null;
   const a = Buffer.from(k.hash, 'hex'); const b = Buffer.from(hash(m[2]), 'hex');
   return a.length === b.length && crypto.timingSafeEqual(a, b) ? org : null;
}

export const publicRouter = Router();
publicRouter.use(rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }));
publicRouter.use(wrap(async (req, res, next) => {
   const org = await orgForKey(req.headers.authorization);
   if (!org) return res.status(401).json({ error: 'A valid API key is required' });
   req.org = org; req.r = scoped(M, org._id);
   next();
}));

const activeItems = async (req) => (req.org.activeSnapshot ? (await req.r.snapshots.findOne({ version: req.org.activeSnapshot }))?.items || [] : []);
const valuesFor = async (req) => (req.org.slug === PURPLEBOX.slug ? (await purpleboxFacts().catch(() => ({ values: {} }))).values : {});

publicRouter.get('/knowledge', wrap(async (req, res) => {
   const [items, values] = await Promise.all([activeItems(req), valuesFor(req)]);
   res.json({ version: req.org.activeSnapshot, items: items.map((i) => ({ ...i, rendered: render(i.answer, values).text })) });
}));
publicRouter.post('/match', wrap(async (req, res) => {
   const message = String(req.body?.message || '').slice(0, 2000);
   const [items, values] = await Promise.all([activeItems(req), valuesFor(req)]);
   res.json({ version: req.org.activeSnapshot, matches: retrieve(message, items, { limit: Number(req.body?.limit) || 3 }).map(({ r, score }) => ({ id: r.id, version: r.version, score, question: r.question, answer: render(r.answer, values).text, escalate: r.escalate })) });
}));
publicRouter.post('/feedback', wrap(async (req, res) => {
   const b = req.body || {};
   if (!b.question || !(b.aiReply || b.humanReply)) return res.status(400).json({ error: 'question and aiReply or humanReply are required' });
   const doc = await req.r.feedback.create({ source: String(b.source || 'api').slice(0, 40), question: redact(String(b.question).slice(0, 2000)), aiReply: redact(String(b.aiReply || '').slice(0, 2000)), humanReply: redact(String(b.humanReply || '').slice(0, 2000)), note: redact(String(b.note || '').slice(0, 500)) });
   res.status(201).json({ id: doc._id });
}));
