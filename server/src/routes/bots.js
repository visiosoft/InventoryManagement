import { Router } from 'express';
import { Bot, BotRun, BOT_KINDS } from '../models/index.js';
import { softDelete } from '../utils/softDelete.js';
import { botDeps, describeSchedule, runBot, sendItems, emailSummary, DEFAULT_MESSAGE, DEFAULT_SUBJECT, RECOMMENDED_BOTS } from '../services/bots.js';

/**
 * Bots (services/bots.js): admins make them, run them, and send what a
 * run prepared. Everything here is admin-only — a bot emails customers.
 */
const router = Router();
router.use((req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' })));

const CADENCES = ['manual', 'daily', 'weekly', 'monthly'];
const int = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

/** What a bot may be saved as. Unknown fields are dropped. */
export function cleanBot(b = {}, prev = {}) {
   const s = { ...(prev.schedule || {}), ...(b.schedule || {}) };
   const kind = BOT_KINDS.includes(b.kind) ? b.kind : prev.kind;
   const out = {
      name: String(b.name ?? prev.name ?? '').trim().slice(0, 80),
      kind,
      icon: String(b.icon ?? prev.icon ?? '').slice(0, 8),
      instruction: String(b.instruction ?? prev.instruction ?? '').trim().slice(0, 2000),
      web: Boolean(b.web ?? prev.web),
      days: int(b.days ?? prev.days, 1, 120, 30),
      subject: String(b.subject ?? prev.subject ?? '').slice(0, 200),
      message: String(b.message ?? prev.message ?? '').slice(0, 5000),
      quietDays: int(b.quietDays ?? prev.quietDays, 1, 60, 3),
      maxQuietDays: int(b.maxQuietDays ?? prev.maxQuietDays, 2, 180, 30),
      templateName: String(b.templateName ?? prev.templateName ?? '').trim().slice(0, 120),
      templateLanguage: String(b.templateLanguage ?? prev.templateLanguage ?? 'en').trim().slice(0, 12) || 'en',
      sendMode: (b.sendMode ?? prev.sendMode) === 'auto' ? 'auto' : 'review',
      dailyCap: int(b.dailyCap ?? prev.dailyCap, 1, 500, 50),
      schedule: {
         cadence: CADENCES.includes(s.cadence) ? s.cadence : 'weekly',
         hour: int(s.hour, 0, 23, 9), dayOfWeek: int(s.dayOfWeek, 0, 6, 1), dayOfMonth: int(s.dayOfMonth, 1, 28, 1),
      },
      showOnDashboard: Boolean(b.showOnDashboard ?? prev.showOnDashboard ?? true),
      enabled: Boolean(b.enabled ?? prev.enabled ?? true),
   };
   const errors = [];
   if (!out.name) errors.push('Give it a name');
   if (!out.kind) errors.push('Choose what it does');
   if (out.kind === 'ai_report' && out.instruction.length < 5) errors.push('Say what it should find out');
   if (out.kind === 'quiet_leads' && !out.templateName) errors.push('Choose the WhatsApp template it sends');
   return { bot: out, errors };
}

const view = (b, last) => ({ ...b, scheduleLabel: describeSchedule(b.schedule), lastRun: last || null });

router.get('/', async (_req, res) => {
   const bots = await Bot.find().sort({ createdAt: 1 }).lean();
   const lasts = await Promise.all(bots.map((b) => BotRun.findOne({ bot: b._id }).sort({ createdAt: -1 }).lean()));
   const have = new Set(bots.map((b) => b.name.toLowerCase()));
   res.json({
      bots: bots.map((b, i) => view(b, lasts[i])),
      defaults: { subject: DEFAULT_SUBJECT, message: DEFAULT_MESSAGE },
      recommendedMissing: RECOMMENDED_BOTS.filter((b) => !have.has(b.name.toLowerCase())).map((b) => b.name),
   });
});

router.post('/', async (req, res) => {
   const { bot, errors } = cleanBot(req.body);
   if (errors.length) return res.status(400).json({ error: errors.join('. ') });
   const doc = await Bot.create({ ...bot, createdBy: req.user.id });
   res.status(201).json({ bot: view(doc.toObject(), null) });
});

/** Add the recommended bots that are not there yet (by name). Nothing runs until its time comes. */
router.post('/recommended', async (req, res) => {
   const have = new Set((await Bot.find().select('name').lean()).map((b) => b.name.toLowerCase()));
   const missing = RECOMMENDED_BOTS.filter((b) => !have.has(b.name.toLowerCase()));
   const made = [];
   for (const b of missing) {
      const { bot } = cleanBot(b);
      made.push(await Bot.create({ ...bot, createdBy: req.user.id }));
   }
   res.status(201).json({ added: made.map((b) => b.name) });
});

/** Approved WhatsApp templates a quiet-leads bot can send: one blank (the first name) or none. */
router.get('/templates', async (_req, res) => {
   try {
      const { listWhatsAppTemplates } = await import('../services/whatsapp.js');
      const list = await listWhatsAppTemplates();
      res.json({
         error: list.error || '',
         templates: (list.templates || [])
            .filter((t) => String(t.status).toUpperCase() === 'APPROVED' && t.variableCount <= 1 && !['IMAGE', 'VIDEO', 'DOCUMENT'].includes(t.headerFormat))
            .map((t) => ({ name: t.name, language: t.language, bodyText: t.bodyText, variableCount: t.variableCount })),
      });
   } catch (e) {
      res.json({ error: e.message, templates: [] });
   }
});

router.put('/:id', async (req, res) => {
   const prev = await Bot.findById(req.params.id).lean();
   if (!prev) return res.status(404).json({ error: 'No such bot' });
   const { bot, errors } = cleanBot(req.body, prev);
   if (errors.length) return res.status(400).json({ error: errors.join('. ') });
   const doc = await Bot.findByIdAndUpdate(prev._id, { $set: bot }, { new: true }).lean();
   res.json({ bot: view(doc, await BotRun.findOne({ bot: doc._id }).sort({ createdAt: -1 }).lean()) });
});

router.delete('/:id', async (req, res) => {
   const doc = await Bot.findById(req.params.id);
   if (!doc) return res.status(404).json({ error: 'No such bot' });
   await softDelete(doc, req.user.id);
   res.json({ ok: true });
});

/** Run it now. An email bot prepares; it sends now only if it is set to send by itself. */
router.post('/:id/run', async (req, res) => {
   try {
      const bot = await Bot.findById(req.params.id).lean();
      if (!bot) return res.status(404).json({ error: 'No such bot' });
      const run = await runBot(bot, { trigger: 'manual' });
      await Bot.updateOne({ _id: bot._id }, { $set: { lastRunAt: new Date() } });
      res.json({ run });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

router.get('/:id/runs', async (req, res) => {
   const runs = await BotRun.find({ bot: req.params.id }).sort({ createdAt: -1 }).limit(20).lean();
   res.json({ runs });
});

/** Send a run's waiting emails — all, or the ones ticked. */
router.post('/runs/:runId/send', async (req, res) => {
   try {
      const run = await BotRun.findById(req.params.runId);
      if (!run) return res.status(404).json({ error: 'No such run' });
      const bot = await Bot.findById(run.bot).lean();
      const { sendMail } = await import('../services/mail.js');
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
      let b = bot || { name: 'Bot' };
      const deps = await botDeps();
      if (b.kind === 'quiet_leads') {
         // Checked again at send time: a template paused since the run must not go.
         const tpl = await deps.template(b.templateName);
         if (!tpl || String(tpl.status).toUpperCase() !== 'APPROVED') return res.status(400).json({ error: `The template "${b.templateName}" is not approved in WhatsApp any more` });
         b = { ...b, templateVariableCount: tpl.variableCount };
      }
      const sent = await sendItems(run, b, ids, { sendMail, sendWhatsApp: deps.sendWhatsApp, by: req.user?.name || 'admin', byUser: req.user });
      run.status = run.items.some((i) => i.status === 'pending') ? 'waiting' : 'ok';
      run.summary = emailSummary(run.items, b.kind);
      await run.save();
      res.json({ sent, run });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

/** Leave some out: they are not sent from this run. */
router.post('/runs/:runId/skip', async (req, res) => {
   const run = await BotRun.findById(req.params.runId);
   if (!run) return res.status(404).json({ error: 'No such run' });
   const ids = new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String));
   for (const i of run.items) if (i.status === 'pending' && ids.has(String(i._id))) i.status = 'skipped';
   run.status = run.items.some((i) => i.status === 'pending') ? 'waiting' : 'ok';
   run.summary = emailSummary(run.items, (await Bot.findById(run.bot).select('kind').lean())?.kind);
   await run.save();
   res.json({ run });
});

export default router;
