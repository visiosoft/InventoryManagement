import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import * as M from '../models.js';
import { can, render } from '../core/knowledge.js';
import { compareRuns } from '../core/evaluate.js';
import * as svc from '../service.js';
import { hostFor, factsFor } from '../host.js';
import { orgContext, need, wrap } from './org.js';

/**
 * The training work of one organisation: imports, intents and review, the
 * approved-answer library, publishing, and tests. Mounted behind sign-in and
 * orgContext, so `req.r` is already scoped to the organisation and `req.role`
 * is its member's role.
 */

svc.onSetActive(async (org, version) => {
   await M.Org.updateOne({ _id: org._id }, { $set: { activeSnapshot: version } });
});

const router = Router();
router.use(orgContext);

router.get('/overview', need('read'), wrap(async (req, res) => res.json(await svc.overview(req.r, req.org))));

/* ---------- imports ---------- */

router.get('/imports', need('read'), wrap(async (req, res) => res.json({ imports: await req.r.imports.find({}, { sort: { createdAt: -1 }, limit: 30 }) })));
router.get('/imports/:id', need('read'), wrap(async (req, res) => res.json({ import: await req.r.imports.byId(req.params.id) })));

const SOURCE_LABEL = { connector: 'Connected system', api: 'Sent by API', whatsapp: 'WhatsApp' };
router.post('/imports', need('import'), wrap(async (req, res) => {
   const { source = 'connector', limit = 500, days = 60, perConversation = 3, suggest = 60 } = req.body || {};
   if (!SOURCE_LABEL[source]) return res.status(400).json({ error: 'Unknown source' });
   if (source === 'connector' && !req.org.connector?.enabled) return res.status(400).json({ error: 'Connect a system first (Settings → Connected system)' });
   if (await req.r.imports.count({ status: 'running' })) return res.status(409).json({ error: 'An import is already running' });
   const doc = await svc.startImport(req.r, req.org, hostFor(req.org), { source, params: { limit: Math.min(Number(limit) || 500, 20000), days, perConversation, suggest, label: `${SOURCE_LABEL[source]} · last ${days} days` }, user: req.user });
   res.status(202).json({ import: doc });
}));

/** How many messages are waiting in each stored source. */
router.get('/sources', need('read'), wrap(async (req, res) => {
   const rows = await M.Message.aggregate([{ $match: { org: req.org._id } }, { $group: { _id: '$source', messages: { $sum: 1 }, last: { $max: '$at' } } }]);
   res.json({ connector: Boolean(req.org.connector?.enabled), stored: Object.fromEntries(rows.map((r) => [r._id, { messages: r.messages, last: r.last }])) });
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/** CSV with a header row, JSON (an array of rows, or { messages: [...] }), or an Excel sheet. */
export async function parseUpload(name, buf) {
   if (/\.xlsx$/i.test(name)) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      if (!ws) return [];
      const keys = [];
      ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { keys[i] = String(c.text || '').trim().toLowerCase(); });
      const rows = [];
      ws.eachRow((row, n) => {
         if (n === 1) return;
         const o = {};
         row.eachCell({ includeEmpty: true }, (c, i) => { if (keys[i]) o[keys[i]] = c.value instanceof Date ? c.value.toISOString() : String(c.text ?? ''); });
         rows.push(o);
      });
      return rows;
   }
   const text = buf.toString('utf8').replace(/^\uFEFF/, '');
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
   const [head = [], ...rest] = rows.filter((r) => r.some((x) => x.trim()));
   const keys = head.map((h) => h.trim().toLowerCase());
   return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}

router.post('/imports/upload', need('import'), upload.single('file'), wrap(async (req, res) => {
   if (!req.file) return res.status(400).json({ error: 'Choose a CSV, Excel or JSON file' });
   let rows;
   try { rows = await parseUpload(req.file.originalname, req.file.buffer); } catch { return res.status(400).json({ error: 'That file could not be read as CSV, Excel or JSON' }); }
   if (!rows.length) return res.status(400).json({ error: 'No messages found. Columns needed: conversation, from (customer/agent), text, at' });
   if (rows.length > 200000) return res.status(400).json({ error: 'Up to 200,000 messages per file' });
   const doc = await svc.startImport(req.r, req.org, hostFor(req.org), { source: 'upload', rows, params: { limit: Number(req.body?.limit) || 500, label: req.file.originalname.slice(0, 80) }, user: req.user });
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
      factsFor(req.org).then((f) => f.values).catch(() => ({})),
   ]);
   res.json({ cluster: c, questions, record, preview: c.suggestion?.text ? render(c.suggestion.text, values) : null });
}));

router.post('/clusters/:id/suggest', need('review'), wrap(async (req, res) => {
   const c = await req.r.clusters.byId(req.params.id);
   if (!c) return res.status(404).json({ error: 'Intent not found' });
   res.json({ suggestion: await svc.suggest(req.r, req.org, hostFor(req.org), c, req.user) });
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
router.get('/variables', need('read'), wrap(async (req, res) => res.json({ values: (await factsFor(req.org).catch(() => ({ values: {} }))).values })));

router.get('/snapshots', need('read'), wrap(async (req, res) => {
   const [snapshots, examples, live] = await Promise.all([
      req.r.snapshots.find({}, { sort: { version: -1 }, limit: 50, select: 'version count note publishedBy createdAt conflicts' }),
      req.r.scenarios.count({ status: 'approved', idealResponse: { $nin: ['', null] } }),
      req.org.activeSnapshot ? req.r.snapshots.findOne({ version: req.org.activeSnapshot }) : null,
   ]);
   // Approved scenarios (sandbox corrections included) go out with the next publish as worked examples.
   res.json({ active: req.org.activeSnapshot, snapshots, examples, liveExamples: live?.examples?.length || 0 });
}));
router.post('/publish', need('publish'), wrap(async (req, res) => {
   const out = await svc.publish(req.r, req.org, { note: req.body?.note, force: Boolean(req.body?.force) }, req.user);
   res.status(out.error ? 409 : 200).json(out);
}));
router.post('/rollback', need('publish'), wrap(async (req, res) => {
   const out = await svc.rollback(req.r, req.org, req.body?.version, req.user);
   res.status(out.error ? 400 : 200).json(out);
}));

/* ---------- evaluation ---------- */

router.get('/agent', need('read'), (req, res) => res.json({ name: hostFor(req.org).agent.name, connected: Boolean(req.org.connector?.enabled) }));
router.get('/evals', need('read'), wrap(async (req, res) => {
   const evals = await req.r.evals.find({}, { sort: { createdAt: -1 }, limit: 20, select: '-cases' });
   const done = evals.filter((e) => e.status === 'done');
   res.json({ evals, comparison: done.length >= 2 ? compareRuns(done[1].summary, done[0].summary) : null });
}));
router.get('/evals/:id', need('read'), wrap(async (req, res) => res.json({ eval: await req.r.evals.byId(req.params.id) })));
router.post('/evals', need('evaluate'), wrap(async (req, res) => {
   if (await req.r.evals.count({ status: 'running' })) return res.status(409).json({ error: 'A test is already running' });
   const out = await svc.startEval(req.r, req.org, hostFor(req.org), { limit: req.body?.limit, label: req.body?.label }, req.user);
   res.status(out.error ? 400 : 202).json(out.error ? out : { eval: out });
}));

/* ---------- feedback ---------- */

router.get('/feedback', need('read'), wrap(async (req, res) => res.json({ feedback: await req.r.feedback.find({ status: req.query.status || 'open' }, { sort: { createdAt: -1 }, limit: 200 }) })));
router.patch('/feedback/:id', need('review'), wrap(async (req, res) => {
   const status = ['open', 'used', 'dismissed'].includes(req.body?.status) ? req.body.status : 'dismissed';
   await req.r.feedback.updateOne({ _id: req.params.id }, { $set: { status } });
   res.json({ ok: true });
}));


router.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

export default router;
