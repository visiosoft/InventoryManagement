import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { AgentDefinition, AgentRun, AgentFinding } from '../models/index.js';
import { agentTypes, agentType, runAgent, estimateCost } from '../services/agents/engine.js';
import { loadThreads } from '../services/agents/shared.js';
import { WhatsAppMessage, Lead } from '../models/index.js';

// Registering a type is what puts it in the catalogue, so every one this
// deployment offers has to be imported somewhere. Here is that somewhere.
import '../services/agents/types/unansweredChats.js';
import '../services/agents/types/missedLeads.js';

const router = Router();

/* Admin only, and deliberately not a permission module: a module key can be
 * granted to a sales rep, and these lists carry every lead's estimated value
 * and, in time, an assessment of the reps themselves. */
router.use(requireAdmin);

/** The behaviours a new agent can be an instance of. */
router.get('/types', (_req, res) => {
   res.json({ types: agentTypes() });
});

/**
 * How far back the data actually goes.
 *
 * Worth saying out loud on the page: leads only exist from mid-August and the
 * WhatsApp archive is shallower than people assume, so a range set before that
 * legitimately returns almost nothing. Without this the agent looks broken
 * when it is being accurate.
 */
router.get('/horizon', async (_req, res) => {
   try {
      const [oldestMessage, oldestLead] = await Promise.all([
         WhatsAppMessage.findOne({}).sort({ occurredAt: 1 }).select('occurredAt').lean(),
         Lead.findOne({}).sort({ leadDateTime: 1 }).select('leadDateTime').lean(),
      ]);
      res.json({
         earliestMessageAt: oldestMessage?.occurredAt || null,
         earliestLeadAt: oldestLead?.leadDateTime || null,
      });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

/**
 * What a run would cost, before starting one.
 *
 * Counting the conversations in range is cheap and honest; guessing is
 * neither. An unexplained bill is how somebody stops trusting a feature that
 * was working perfectly well.
 */
router.get('/estimate', async (req, res) => {
   try {
      const type = agentType(String(req.query.type || ''));
      if (!type) return res.status(404).json({ error: 'No such agent type' });
      if (type.judges === false) return res.json({ items: 0, usd: 0, free: true });

      const threads = await loadThreads({ from: req.query.from || null, to: req.query.to || null });
      res.json({ items: threads.length, usd: Number(estimateCost(threads.length).toFixed(2)), free: false });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

const slug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

router.get('/', async (_req, res) => {
   try {
      const defs = await AgentDefinition.find({}).sort({ createdAt: 1 }).lean();
      const ids = defs.map((d) => d._id);
      const [runs, open] = await Promise.all([
         AgentRun.find({ definition: { $in: ids } }).sort({ startedAt: -1 }).limit(200)
            .select('definition status startedAt finishedAt counts estimateUsd').lean(),
         AgentFinding.aggregate([
            { $match: { definition: { $in: ids }, state: 'open' } },
            { $group: { _id: '$definition', n: { $sum: 1 } } },
         ]),
      ]);
      const lastRun = new Map();
      for (const r of runs) if (!lastRun.has(String(r.definition))) lastRun.set(String(r.definition), r);
      const openBy = new Map(open.map((o) => [String(o._id), o.n]));

      res.json({
         agents: defs.map((d) => ({
            ...d,
            typeLabel: agentType(d.type)?.label || d.type,
            lastRun: lastRun.get(String(d._id)) || null,
            openFindings: openBy.get(String(d._id)) || 0,
         })),
      });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

router.post('/', async (req, res) => {
   try {
      const { name, type, config, extraInstructions, schedule, description } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Give the agent a name' });
      if (!agentType(type)) return res.status(400).json({ error: 'No such agent type' });

      let key = slug(name);
      // Two agents of the same type with different scopes is a normal thing to
      // want — "missed leads, last month" beside "missed leads, this year".
      if (await AgentDefinition.exists({ key })) key = `${key}-${Date.now().toString(36).slice(-4)}`;

      const created = await AgentDefinition.create({
         key, name, type, description: description || '',
         config: config || {},
         extraInstructions: extraInstructions || '',
         schedule: schedule || { mode: 'off' },
         createdBy: req.user?.id || null,
      });
      res.status(201).json(created);
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

router.put('/:key', async (req, res) => {
   try {
      const { name, config, extraInstructions, schedule, enabled, description } = req.body || {};
      const set = {};
      if (name !== undefined) set.name = name;
      if (config !== undefined) set.config = config;
      if (extraInstructions !== undefined) set.extraInstructions = extraInstructions;
      if (schedule !== undefined) set.schedule = schedule;
      if (enabled !== undefined) set.enabled = Boolean(enabled);
      if (description !== undefined) set.description = description;

      const updated = await AgentDefinition.findOneAndUpdate({ key: req.params.key }, { $set: set }, { new: true });
      if (!updated) return res.status(404).json({ error: 'No such agent' });
      res.json(updated);
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

router.delete('/:key', async (req, res) => {
   try {
      const def = await AgentDefinition.findOne({ key: req.params.key });
      if (!def) return res.status(404).json({ error: 'No such agent' });
      // Its runs and findings go with it; they mean nothing on their own.
      await Promise.all([
         AgentFinding.deleteMany({ definition: def._id }),
         AgentRun.deleteMany({ definition: def._id }),
         AgentDefinition.deleteOne({ _id: def._id }),
      ]);
      res.json({ ok: true });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

/**
 * Start a run.
 *
 * Answers as soon as the run exists rather than when it finishes: a sweep over
 * every conversation takes minutes, which is far longer than any sensible
 * request timeout. The page follows it through `GET /runs/:id`.
 */
router.post('/:key/run', async (req, res) => {
   try {
      const def = await AgentDefinition.findOne({ key: req.params.key });
      if (!def) return res.status(404).json({ error: 'No such agent' });
      if (!agentType(def.type)) return res.status(400).json({ error: `This deployment has no "${def.type}" agent` });

      const running = await AgentRun.findOne({ definition: def._id, status: 'running' }).select('_id').lean();
      if (running) return res.status(409).json({ error: 'It is already running', runId: running._id });

      // A one-off scope for this run only, without editing the agent.
      if (req.body?.config) def.config = { ...(def.config || {}), ...req.body.config };

      const started = await new Promise((resolve, reject) => {
         let settled = false;
         runAgent(def, { startedBy: req.user?.id || null, startedByName: req.user?.name || '', trigger: 'manual' })
            .then((out) => { if (!settled) { settled = true; resolve(out); } })
            .catch((e) => { if (!settled) { settled = true; reject(e); } });
         // Whichever comes first: the run finishing, or its document existing.
         setTimeout(async () => {
            if (settled) return;
            const run = await AgentRun.findOne({ definition: def._id }).sort({ startedAt: -1 }).select('_id').lean();
            if (run && !settled) { settled = true; resolve({ runId: run._id, pending: true }); }
         }, 400);
      });

      res.status(202).json(started);
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

/** Progress, the activity feed, and the findings once there are any. */
router.get('/runs/:id', async (req, res) => {
   try {
      const run = await AgentRun.findById(req.params.id).lean();
      if (!run) return res.status(404).json({ error: 'No such run' });

      const findings = run.status === 'running'
         ? []
         : await AgentFinding.find({ run: run._id }).sort({ score: -1 }).limit(Number(req.query.limit || 500)).lean();

      res.json({ run, findings });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

router.post('/runs/:id/stop', async (req, res) => {
   try {
      // Noticed between items, so nothing is left half-written.
      const run = await AgentRun.findByIdAndUpdate(req.params.id, { $set: { stopRequested: true } }, { new: true }).lean();
      if (!run) return res.status(404).json({ error: 'No such run' });
      res.json({ ok: true });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

router.get('/runs', async (req, res) => {
   try {
      const def = await AgentDefinition.findOne({ key: req.query.agent }).select('_id').lean();
      if (!def) return res.status(404).json({ error: 'No such agent' });
      const runs = await AgentRun.find({ definition: def._id }).sort({ startedAt: -1 }).limit(20)
         .select('status startedAt finishedAt counts estimateUsd startedByName trigger').lean();
      res.json({ runs });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

/** The current findings for an agent, whichever run produced them. */
router.get('/:key/findings', async (req, res) => {
   try {
      const def = await AgentDefinition.findOne({ key: req.params.key }).select('_id name').lean();
      if (!def) return res.status(404).json({ error: 'No such agent' });

      const filter = { definition: def._id };
      if (req.query.state) filter.state = req.query.state;
      else filter.state = { $ne: 'dismissed' };
      if (req.query.category) filter['data.category'] = req.query.category;

      const findings = await AgentFinding.find(filter).sort({ score: -1 }).limit(Number(req.query.limit || 500)).lean();

      // Snoozed rows are hidden until their date, and a reply always wakes one:
      // somebody who writes back is live again whatever was decided about them.
      const now = new Date();
      const visible = findings.filter((f) => {
         if (f.state === 'snoozed' && f.snoozeUntil && f.snoozeUntil > now) {
            const wroteSince = f.data?.lastInboundAt && f.stateAt && new Date(f.data.lastInboundAt) > new Date(f.stateAt);
            return Boolean(wroteSince);
         }
         return true;
      });

      const byCategory = {};
      for (const f of visible) {
         const c = f.data?.category || 'all';
         byCategory[c] = (byCategory[c] || 0) + 1;
      }
      res.json({ findings: visible, counts: { total: visible.length, byCategory } });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

const STATES = { dismiss: 'dismissed', done: 'done', snooze: 'snoozed', reopen: 'open' };

router.post('/findings/:id/:action', async (req, res) => {
   try {
      const state = STATES[req.params.action];
      if (!state) return res.status(400).json({ error: 'Unknown action' });

      const finding = await AgentFinding.findById(req.params.id);
      if (!finding) return res.status(404).json({ error: 'No such finding' });

      finding.state = state;
      finding.stateAt = new Date();
      finding.handledBy = req.user?.id || null;
      finding.snoozeUntil = state === 'snoozed'
         ? new Date(Date.now() + Math.max(1, Number(req.body?.days || 7)) * 864e5)
         : null;
      finding.history.push({
         state, at: new Date(), byName: req.user?.name || '', reason: String(req.body?.reason || ''),
      });
      await finding.save();
      res.json({ ok: true, finding });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

export default router;
