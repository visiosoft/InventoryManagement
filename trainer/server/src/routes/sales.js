import { Router } from 'express';
import crypto from 'node:crypto';
import * as M from '../models.js';
import { can } from '../core/knowledge.js';
import { TEMPLATES, STAGES, playbookOf, cleanPlaybook, promptVersion, canMoveTo } from '../core/playbook.js';
import { storageSeeds } from '../core/seeds.js';
import { redact } from '../core/text.js';
import { hostFor } from '../host.js';
import * as sales from '../sales.js';
import { audit } from '../service.js';
import { orgContext, need, wrap } from './org.js';

/**
 * The sales playbook, scenario library, sandbox, test suite and rollout of
 * one organisation. Behind sign-in and orgContext like /training.
 */

const router = Router();
router.use(orgContext);
const by = (req) => ({ userId: String(req.user?.id), name: req.user?.name || req.user?.email });
const ID = /^[0-9a-f]{24}$/i;

/* ---------- playbook ---------- */

router.get('/playbook', need('read'), (req, res) => {
   const p = playbookOf(req.org);
   res.json({
      playbook: p, custom: Boolean(req.org.playbook?.template), promptVersion: promptVersion(p),
      templates: Object.values(TEMPLATES).map((t) => ({ key: t.template, name: t.name, goal: t.goal })),
      stages: STAGES, rollout: { stage: req.org.rollout?.stage || 'sandbox', intents: req.org.rollout?.intents || [], note: req.org.rollout?.note || '', changedBy: req.org.rollout?.changedBy, at: req.org.rollout?.at },
   });
});

router.put('/playbook', need('manage'), wrap(async (req, res) => {
   let p;
   try { p = cleanPlaybook(req.body?.playbook); } catch (e) { return res.status(400).json({ error: e.message }); }
   await M.Org.updateOne({ _id: req.org._id }, { $set: { playbook: p } });
   await audit(req.r, req.user, 'playbook.save', '', { template: p.template, promptVersion: promptVersion(p) });
   res.json({ playbook: p, promptVersion: promptVersion(p) });
}));

/** Start from a template; the self-storage one can bring its starter scenarios as drafts. */
router.post('/playbook/template', need('manage'), wrap(async (req, res) => {
   const t = TEMPLATES[req.body?.template];
   if (!t) return res.status(400).json({ error: 'Unknown template' });
   const p = cleanPlaybook(t);
   await M.Org.updateOne({ _id: req.org._id }, { $set: { playbook: p } });
   let seeded = 0;
   if (req.body?.seed && t.template === 'self_storage_sales') seeded = await seed(req);
   await audit(req.r, req.user, 'playbook.template', t.template, { seeded });
   res.json({ playbook: p, seeded });
}));

async function seed(req) {
   const have = new Set((await req.r.scenarios.find({ source: 'seed' }, { select: 'title', limit: 1000 })).map((s) => s.title));
   const docs = storageSeeds().filter((s) => !have.has(s.title));
   if (docs.length) await req.r.scenarios.insertMany(docs);
   return docs.length;
}
router.post('/scenarios/seed', need('manage'), wrap(async (req, res) => res.json({ seeded: await seed(req) })));

/* ---------- scenarios ---------- */

const ESC = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get('/scenarios', need('read'), wrap(async (req, res) => {
   const filter = { status: req.query.status ? String(req.query.status) : { $ne: 'archived' } };
   if (req.query.group) filter.group = String(req.query.group);
   if (req.query.q) filter.$or = [{ title: { $regex: ESC(req.query.q), $options: 'i' } }, { message: { $regex: ESC(req.query.q), $options: 'i' } }, { intent: { $regex: ESC(req.query.q), $options: 'i' } }];
   const [scenarios, counts] = await Promise.all([
      req.r.scenarios.find(filter, { sort: { group: 1, createdAt: 1 }, limit: 1000, select: '-history' }),
      req.r.scenarios.aggregate([{ $match: { status: { $ne: 'archived' } } }, { $group: { _id: { group: '$group', status: '$status' }, n: { $sum: 1 } } }]),
   ]);
   const p = playbookOf(req.org);
   const coverage = p.groups.map((g) => ({ ...g, approved: counts.find((c) => c._id.group === g.key && c._id.status === 'approved')?.n || 0, draft: counts.find((c) => c._id.group === g.key && c._id.status === 'draft')?.n || 0 }));
   res.json({ scenarios, coverage });
}));

const FIELDS = (p, b) => {
   const actions = new Set(p.actions.map((a) => a.key));
   const media = new Set(p.media.map((m) => m.key));
   const set = {};
   for (const [k, n] of [['title', 120], ['message', 2000], ['intent', 120], ['idealResponse', 4000], ['badResponse', 4000], ['critique', 1000], ['commercial', 300]]) if (typeof b[k] === 'string') set[k] = (k === 'message' || k === 'badResponse' ? redact(b[k]) : b[k]).trim().slice(0, n);
   if (typeof b.group === 'string' && p.groups.some((g) => g.key === b.group)) set.group = b.group;
   if (Array.isArray(b.nba)) set.nba = b.nba.filter((k) => actions.has(k));
   if (Array.isArray(b.media)) set.media = b.media.filter((k) => media.has(k));
   if (Array.isArray(b.qaTags)) set.qaTags = b.qaTags.map((t) => String(t).slice(0, 30)).slice(0, 12);
   if (Array.isArray(b.context)) set.context = b.context.slice(0, 20).map((m) => ({ from: m?.from === 'agent' ? 'agent' : 'customer', text: redact(String(m?.text || '')).slice(0, 2000) })).filter((m) => m.text);
   if (b.leadBefore && typeof b.leadBefore === 'object') set.leadBefore = Object.fromEntries(Object.entries(b.leadBefore).filter(([k]) => p.fields.some((f) => f.key === k)).map(([k, v]) => [k, String(v ?? '').slice(0, 200)]));
   for (const k of ['mustEscalate', 'factual', 'core']) if (typeof b[k] === 'boolean') set[k] = b[k];
   if (['', 'visit', 'booking', 'follow_up', 'escalation', 'lost', 'ghosted'].includes(b.outcome)) set.outcome = b.outcome;
   return set;
};

router.post('/scenarios', need('review'), wrap(async (req, res) => {
   const p = playbookOf(req.org);
   const set = FIELDS(p, req.body || {});
   if (!set.message) return res.status(400).json({ error: 'Write the customer message' });
   const doc = await req.r.scenarios.create({ group: p.groups[0]?.key || 'general', title: set.message.slice(0, 80), ...set, source: 'manual', status: 'draft', history: [{ action: 'created', by: by(req), at: new Date() }] });
   res.status(201).json({ scenario: doc });
}));

router.get('/scenarios/:id', need('read'), wrap(async (req, res) => {
   const s = await req.r.scenarios.byId(req.params.id);
   return s ? res.json({ scenario: s }) : res.status(404).json({ error: 'Scenario not found' });
}));

/** An edit by someone who cannot approve sends an approved scenario back to draft. */
router.patch('/scenarios/:id', need('review'), wrap(async (req, res) => {
   const s = await req.r.scenarios.byId(req.params.id);
   if (!s) return res.status(404).json({ error: 'Scenario not found' });
   const set = FIELDS(playbookOf(req.org), req.body || {});
   if (s.status === 'approved' && !can(req.role, 'approve')) set.status = 'draft';
   await req.r.scenarios.updateOne({ _id: s._id }, { $set: set, $push: { history: { action: 'edited', by: by(req), at: new Date(), note: Object.keys(set).join(', ') } } });
   res.json({ scenario: await req.r.scenarios.byId(s._id) });
}));

router.post('/scenarios/:id/approve', need('approve'), wrap(async (req, res) => {
   const s = await req.r.scenarios.byId(req.params.id);
   if (!s) return res.status(404).json({ error: 'Scenario not found' });
   if (!s.nba?.length) return res.status(400).json({ error: 'Choose the correct next action first' });
   if (!s.idealResponse?.trim() && !s.mustEscalate) return res.status(400).json({ error: 'Write or draft the ideal reply first' });
   await req.r.scenarios.updateOne({ _id: s._id }, { $set: { status: 'approved', approvedBy: by(req), approvedAt: new Date() }, $push: { history: { action: 'approved', by: by(req), at: new Date() } } });
   await audit(req.r, req.user, 'scenario.approve', s._id);
   res.json({ ok: true });
}));

router.post('/scenarios/:id/archive', need('review'), wrap(async (req, res) => {
   await req.r.scenarios.updateOne({ _id: req.params.id }, { $set: { status: 'archived' }, $push: { history: { action: 'archived', by: by(req), at: new Date() } } });
   res.json({ ok: true });
}));

/** The playbook agent's reply as a starting point. Not saved. */
router.post('/scenarios/:id/draft', need('review'), wrap(async (req, res) => {
   const s = await req.r.scenarios.byId(req.params.id);
   if (!s) return res.status(404).json({ error: 'Scenario not found' });
   res.json(await sales.draftIdeal(hostFor(req.org), req.org, s));
}));

router.post('/scenarios/generate', need('review'), wrap(async (req, res) => {
   const out = await sales.generate(req.r, req.org, hostFor(req.org), { group: String(req.body?.group || ''), count: req.body?.count }, req.user);
   res.status(out.error ? 400 : 200).json(out);
}));

/* ---------- sandbox ---------- */

const convo = (arr) => (Array.isArray(arr) ? arr : []).slice(-30).map((m) => ({ from: m?.from === 'agent' ? 'agent' : 'customer', text: String(m?.text || '').slice(0, 2000) })).filter((m) => m.text);

router.post('/sandbox/turn', need('evaluate'), wrap(async (req, res) => {
   const message = String(req.body?.message || '').trim().slice(0, 2000);
   if (!message) return res.status(400).json({ error: 'Write a customer message' });
   const context = convo(req.body?.context);
   const lead = req.body?.lead && typeof req.body.lead === 'object' ? req.body.lead : {};
   let out;
   try { out = await sales.turn(hostFor(req.org), req.org, { context, message, lead, agent: req.body?.agent }); } catch (e) { return res.status(502).json({ error: `The agent could not reply: ${e.message}` }); }
   const doc = await req.r.sandbox.create({
      session: /^[a-z0-9-]{6,40}$/i.test(req.body?.session) ? req.body.session : crypto.randomUUID(), scenario: ID.test(req.body?.scenario) ? req.body.scenario : undefined,
      agent: out.agent, model: out.model, promptVersion: out.promptVersion, knowledgeVersion: out.knowledgeVersion,
      context: context.map((m) => ({ ...m, text: redact(m.text) })), message: redact(message), leadBefore: lead, out, by: by(req),
   });
   res.json({ id: doc._id, session: doc.session, out });
}));

router.post('/sandbox/:id/score', need('evaluate'), wrap(async (req, res) => {
   const t = await req.r.sandbox.byId(req.params.id);
   if (!t) return res.status(404).json({ error: 'Turn not found' });
   const s = t.scenario ? await req.r.scenarios.byId(t.scenario) : null;
   let g;
   try { g = await sales.score(hostFor(req.org), req.org, { context: t.context, message: t.message, lead: t.leadBefore, scenario: s || {} }, t.out); } catch (e) { return res.status(502).json({ error: `Scoring failed: ${e.message}` }); }
   await req.r.sandbox.updateOne({ _id: t._id }, { $set: { grade: g } });
   res.json({ grade: g });
}));

/**
 * A reviewer's verdict on a sandbox turn becomes a scenario: approved as it
 * is, or corrected (the agent's reply kept as the bad example). Every
 * correction is a new regression case (§23 step 6).
 */
router.post('/sandbox/:id/save', need('review'), wrap(async (req, res) => {
   const t = await req.r.sandbox.byId(req.params.id);
   if (!t) return res.status(404).json({ error: 'Turn not found' });
   const p = playbookOf(req.org);
   const b = req.body || {};
   const ideal = String(b.idealResponse ?? t.out.reply).trim().slice(0, 4000);
   const corrected = ideal !== String(t.out.reply).trim() || (Array.isArray(b.nba) && !b.nba.includes(t.out.nba));
   const set = FIELDS(p, { ...b, idealResponse: ideal, badResponse: corrected ? t.out.reply : '', nba: Array.isArray(b.nba) && b.nba.length ? b.nba : [t.out.nba].filter(Boolean) });
   const approve = can(req.role, 'approve');
   const doc = await req.r.scenarios.create({
      group: p.groups[0]?.key || 'general', title: t.message.slice(0, 80), intent: '', ...set,
      context: t.context, message: t.message, leadBefore: t.leadBefore, media: set.media ?? t.out.media,
      source: corrected ? 'correction' : 'sandbox', status: approve && set.nba?.length ? 'approved' : 'draft', core: true,
      ...(approve ? { approvedBy: by(req), approvedAt: new Date() } : {}), history: [{ action: corrected ? 'corrected in sandbox' : 'saved from sandbox', by: by(req), at: new Date() }],
   });
   await req.r.sandbox.updateOne({ _id: t._id }, { $set: { decision: { action: corrected ? 'corrected' : 'approved', by: by(req), at: new Date() } } });
   await audit(req.r, req.user, corrected ? 'sandbox.correct' : 'sandbox.approve', doc._id, { turn: t._id });
   res.status(201).json({ scenario: doc, corrected });
}));

router.get('/sandbox', need('read'), wrap(async (req, res) => {
   res.json({ turns: await req.r.sandbox.find({}, { sort: { createdAt: -1 }, limit: 50, select: 'session message out.reply out.nba grade.score grade.pass agent model promptVersion knowledgeVersion decision by createdAt' }) });
}));

/* ---------- suite runs ---------- */

router.get('/runs', need('read'), wrap(async (req, res) => res.json({ runs: await req.r.runs.find({}, { sort: { createdAt: -1 }, limit: 30, select: '-cases' }) })));
router.get('/runs/:id', need('read'), wrap(async (req, res) => {
   const run = await req.r.runs.byId(req.params.id);
   return run ? res.json({ run }) : res.status(404).json({ error: 'Run not found' });
}));
router.post('/runs', need('evaluate'), wrap(async (req, res) => {
   if (await req.r.runs.count({ status: 'running' })) return res.status(409).json({ error: 'A run is already in progress' });
   const out = await sales.startSuite(req.r, req.org, hostFor(req.org), { scope: String(req.body?.scope || 'core'), agent: req.body?.agent }, req.user);
   res.status(out.error ? 400 : 202).json(out.error ? out : { run: out });
}));

/** Blind review: the next unrated reply, without its score, agent or expected answer. */
router.get('/runs/:id/blind', need('review'), wrap(async (req, res) => {
   const run = await req.r.runs.byId(req.params.id);
   if (!run) return res.status(404).json({ error: 'Run not found' });
   const open = run.cases.map((c, i) => ({ c, i })).filter(({ c }) => c.out && !c.blind?.rating);
   const pick = open[Math.floor(Math.random() * open.length)];
   res.json({ remaining: open.length, rated: run.cases.filter((c) => c.blind?.rating).length, item: pick ? { index: pick.i, context: pick.c.context, message: pick.c.message, reply: pick.c.out.reply, media: pick.c.out.media } : null });
}));

const RATINGS = ['send', 'minor', 'major', 'wrong'];
router.post('/runs/:id/blind', need('review'), wrap(async (req, res) => {
   const run = await req.r.runs.byId(req.params.id);
   const i = Number(req.body?.index);
   if (!run || run.status !== 'done' || !run.cases[i]?.out) return res.status(400).json({ error: 'Nothing to rate there' });
   if (!RATINGS.includes(req.body?.rating)) return res.status(400).json({ error: 'Rate send, minor, major or wrong' });
   run.cases[i].blind = { rating: req.body.rating, by: by(req), at: new Date() };
   await req.r.runs.updateOne({ _id: run._id }, { $set: { [`cases.${i}.blind`]: run.cases[i].blind } });
   res.json(await sales.regate(req.r, req.org, run));
}));

/** A reviewer corrects a run's reply: the scenario's ideal reply is updated and the agent's kept as the bad example. */
router.post('/runs/:id/cases/:i/correct', need('approve'), wrap(async (req, res) => {
   const run = await req.r.runs.byId(req.params.id);
   const c = run?.cases?.[Number(req.params.i)];
   if (!c?.out) return res.status(404).json({ error: 'Case not found' });
   const set = FIELDS(playbookOf(req.org), { idealResponse: req.body?.idealResponse, nba: req.body?.nba, critique: req.body?.critique, badResponse: c.out.reply });
   if (!set.idealResponse) return res.status(400).json({ error: 'Write the reply it should have sent' });
   await req.r.scenarios.updateOne({ _id: c.scenario }, { $set: { ...set, status: 'approved', approvedBy: by(req), approvedAt: new Date() }, $push: { history: { action: 'corrected from test run', by: by(req), at: new Date(), note: String(run._id) } } });
   await audit(req.r, req.user, 'scenario.correct', c.scenario, { run: run._id });
   res.json({ ok: true });
}));

/* ---------- rollout ---------- */

router.put('/rollout', need('manage'), wrap(async (req, res) => {
   const to = String(req.body?.stage || '');
   const from = req.org.rollout?.stage || 'sandbox';
   const last = await req.r.runs.findOne({ status: 'done', scope: { $in: ['core', 'all'] } }, { sort: { createdAt: -1 } });
   const ok = canMoveTo(from, to, Boolean(last?.passedAll));
   if (!ok.ok) return res.status(400).json({ error: ok.error });
   const rollout = {
      stage: to, intents: Array.isArray(req.body?.intents) ? req.body.intents.map((x) => String(x).slice(0, 120)).slice(0, 100) : req.org.rollout?.intents || [],
      note: String(req.body?.note || '').slice(0, 500), run: last?._id, changedBy: by(req), at: new Date(),
   };
   await M.Org.updateOne({ _id: req.org._id }, { $set: { rollout } });
   await audit(req.r, req.user, 'rollout.change', to, { from, run: last?._id, passedAll: Boolean(last?.passedAll) });
   res.json({ rollout });
}));

router.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

export default router;
