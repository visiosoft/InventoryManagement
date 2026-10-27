import { Router } from 'express';
import multer from 'multer';
import { requireAdmin } from '../middleware/auth.js';
import { askAssistant, getAssistantConfig, DEFAULT_PROMPT } from '../services/assistant/index.js';
import { toolNames } from '../services/assistant/tools.js';
import { takeProposal, dropProposal, runAction } from '../services/assistant/actions.js';
import { getAdminInsight } from '../services/assistant/adminInsight.js';
import { buildDataset, DATASETS } from '../services/assistant/datasets.js';
import { tablePdf, tableWorkbook } from '../services/tableExport.js';
import { siteScope } from '../utils/siteScope.js';
import { User } from '../models/index.js';
import { addRecentAsk } from '../services/recentAsks.js';
import { openaiConfigured, openaiModel, transcribeAudio } from '../services/openai.js';
import { CLAUDE_EFFORTS, claudeConfigured } from '../services/claude.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const PROMPT_LIMIT = 20000;

/** Everyone signed in may ask. What it can *do* (actions) is still limited by
 *  the action roles on the config, and what it can see by each tool's own checks. */
async function allowed(req) {
   return Boolean(req.user);
}

/**
 * One question. History is the last few turns from the widget so a
 * follow-up like "and on floor 2?" makes sense; nothing is stored server-side.
 */
router.post('/ask', async (req, res) => {
   try {
      if (!(await allowed(req))) return res.status(403).json({ error: 'The assistant is not enabled for your role' });
      const { question, history, site, context, web } = req.body || {};
      const out = await askAssistant({
         question, history: Array.isArray(history) ? history : [],
         siteId: site || req.query.site || null,
         user: req.user,
         authHeader: req.headers.authorization || '',
         // The staff app says which screen and lead it is on (see askAssistant).
         context: context && typeof context === 'object' ? context : null,
         web: web === true,
      });
      res.json(out);
      // The opening question of a conversation is kept for the person's
      // "Recent searches" card. Never holds up or fails the answer.
      if (!(Array.isArray(history) && history.length) && req.user?.id && String(question || '').trim()) {
         User.findById(req.user.id).select('recentAsks').then((u) => {
            if (!u) return null;
            u.recentAsks = addRecentAsk(u.recentAsks?.map((x) => ({ q: x.q, at: x.at })), question);
            return u.save();
         }).catch(() => {});
      }
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

/** The signed-in person's own recent questions, newest first. */
router.get('/recent', async (req, res) => {
   const u = await User.findById(req.user?.id).select('recentAsks').lean().catch(() => null);
   res.json({ recent: (u?.recentAsks || []).map((x) => ({ q: x.q, at: x.at })) });
});

/** Clear them. */
router.delete('/recent', async (req, res) => {
   await User.updateOne({ _id: req.user?.id }, { $set: { recentAsks: [] } }).catch(() => null);
   res.json({ ok: true });
});

/**
 * Speech in, text out — for BayOps' command-bar mic. The same transcription
 * OpenAI service the WhatsApp voice-note pipeline already uses
 * (services/mediaUnderstanding.js); this just exposes it for the app to
 * call directly instead of only ever running against an inbound WhatsApp
 * voice note. Text only comes back — the caller still runs it through /ask
 * itself, exactly as if it had been typed.
 */
/**
 * A file the assistant offered: the same table its answer counted, rebuilt
 * for this person (their role and site decide what is in it) and sent as a
 * PDF or an Excel workbook.
 */
router.get('/export', async (req, res) => {
   try {
      if (!(await allowed(req))) return res.status(403).json({ error: 'The assistant is not enabled for your role' });
      const { dataset, format, site, ...args } = req.query;
      if (!DATASETS.includes(String(dataset))) return res.status(400).json({ error: 'Unknown list' });
      const scope = await siteScope(site).catch(() => null);
      const table = await buildDataset(String(dataset), args, { user: req.user, scope, now: new Date() });
      const stamp = new Date().toISOString().slice(0, 10);
      const base = `${table.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${stamp}`;
      const columns = table.columns;
      if (format === 'excel') {
         const buf = await tableWorkbook({ title: table.title, subtitle: table.subtitle, columns, rows: table.rows });
         res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
         res.set('Content-Disposition', `attachment; filename="${base}.xlsx"`);
         return res.send(buf);
      }
      const buf = await tablePdf({ title: table.title, subtitle: table.subtitle, columns, rows: table.rows });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `inline; filename="${base}.pdf"`);
      res.send(buf);
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

router.post('/transcribe', upload.single('audio'), async (req, res) => {
   try {
      if (!(await allowed(req))) return res.status(403).json({ error: 'The assistant is not enabled for your role' });
      if (!req.file) return res.status(400).json({ error: 'No audio file' });
      const text = await transcribeAudio({
         buffer: req.file.buffer,
         mimeType: req.file.mimetype || 'audio/m4a',
         filename: req.file.originalname || 'voice.m4a',
      });
      if (!text) return res.status(422).json({ error: "Couldn't make that out — try again, or type it instead." });
      res.json({ text });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

async function mayAct(req) {
   const c = await getAssistantConfig();
   if (c.actionsEnabled === false) return false;
   return (c.actionRoles?.length ? c.actionRoles : ['admin', 'sales_rep']).includes(req.user?.role);
}

/**
 * The person pressed Confirm.
 *
 * The proposal is the one the same person was shown, taken once so it cannot
 * run twice, and executed with their own token so everything it creates is
 * attributed to them exactly as if they had used the page.
 */
router.post('/confirm', async (req, res) => {
   try {
      if (!(await mayAct(req))) return res.status(403).json({ error: 'You are not allowed to confirm actions' });
      const p = takeProposal(String(req.body?.id || ''), req.user?.id);
      if (!p) return res.status(410).json({ error: 'That proposal has expired or was already used — ask again.' });
      const out = await runAction(p, { authHeader: req.headers.authorization || '' });
      res.json(out);
   } catch (e) {
      res.status(500).json({ ok: false, error: e.message, message: `Stopped: ${e.message}` });
   }
});

router.post('/cancel', async (req, res) => {
   dropProposal(String(req.body?.id || ''));
   res.json({ ok: true, message: 'Cancelled — nothing was created or sent.' });
});

/**
 * The AI insight card under admin Overview's stat tiles — see
 * services/assistant/adminInsight.js for the grounding rule (every number
 * it may mention is computed here first, never invented by the model).
 */
router.get('/admin-insight', async (req, res) => {
   try {
      if (!['admin', 'accounts'].includes(req.user?.role)) return res.status(403).json({ error: 'Admins only' });
      res.json(await getAdminInsight());
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

/** What it can ask the database, so the widget can say so honestly. */
router.get('/capabilities', async (req, res) => {
   res.json({
      enabled: openaiConfigured() && (await getAssistantConfig()).enabled,
      allowed: await allowed(req),
      tools: toolNames(),
      // Searching the internet runs on Claude, so it is offered once the key is set.
      web: claudeConfigured(),
   });
});

router.get('/config', requireAdmin, async (_req, res) => {
   try {
      const c = await getAssistantConfig();
      res.json({
         enabled: c.enabled, systemPrompt: c.systemPrompt, model: c.model, effort: c.effort || '', maxToolRounds: c.maxToolRounds, roles: c.roles,
         actionsEnabled: c.actionsEnabled !== false, actionRoles: c.actionRoles,
         defaultPrompt: DEFAULT_PROMPT, promptLimit: PROMPT_LIMIT, serverModel: openaiModel(),
         tools: toolNames(),
         openai: { configured: openaiConfigured() },
      });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

router.put('/config', requireAdmin, async (req, res) => {
   try {
      const c = await getAssistantConfig();
      const b = req.body || {};
      if (b.enabled !== undefined) c.enabled = Boolean(b.enabled);
      if (b.systemPrompt !== undefined) {
         if (String(b.systemPrompt).length > PROMPT_LIMIT) {
            return res.status(400).json({ error: `The prompt is ${String(b.systemPrompt).length} characters; the limit is ${PROMPT_LIMIT}.` });
         }
         c.systemPrompt = String(b.systemPrompt);
      }
      if (b.model !== undefined) c.model = String(b.model || '');
      if (b.effort !== undefined) {
         const effort = String(b.effort || '');
         if (effort && !CLAUDE_EFFORTS.includes(effort)) return res.status(400).json({ error: `Effort must be one of ${CLAUDE_EFFORTS.join(', ')}` });
         c.effort = effort;
      }
      if (b.maxToolRounds !== undefined) c.maxToolRounds = Math.min(8, Math.max(1, Number(b.maxToolRounds) || 4));
      if (Array.isArray(b.roles)) c.roles = b.roles.map(String);
      if (b.actionsEnabled !== undefined) c.actionsEnabled = Boolean(b.actionsEnabled);
      if (Array.isArray(b.actionRoles)) c.actionRoles = b.actionRoles.map(String);
      await c.save();
      res.json({ ok: true });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

router.use((error, _req, res, _next) => {
   if (error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Recording is too long — under 10MB, please.' });
   res.status(500).json({ error: error.message });
});

export default router;
