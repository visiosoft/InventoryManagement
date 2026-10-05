import { Router } from 'express';
import multer from 'multer';
import { requireAdmin } from '../middleware/auth.js';
import { askAssistant, getAssistantConfig, DEFAULT_PROMPT } from '../services/assistant/index.js';
import { toolNames } from '../services/assistant/tools.js';
import { takeProposal, dropProposal, runAction } from '../services/assistant/actions.js';
import { getAdminInsight } from '../services/assistant/adminInsight.js';
import { openaiConfigured, openaiModel, transcribeAudio } from '../services/openai.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const PROMPT_LIMIT = 20000;

/** Who may ask. Set on the config; reports are admin and accounts, and this
 *  sees the same figures, so that is the default. */
async function allowed(req) {
   const config = await getAssistantConfig();
   // sales_rep in the default: BayOps (the mobile command bar) is a rep tool
   // first — a fresh install with nobody having touched this config should
   // not leave reps locked out of the thing built for them. Still fully
   // admin-configurable from here down.
   const roles = config.roles?.length ? config.roles : ['admin', 'accounts', 'sales_rep'];
   return roles.includes(req.user?.role);
}

/**
 * One question. History is the last few turns from the widget so a
 * follow-up like "and on floor 2?" makes sense; nothing is stored server-side.
 */
router.post('/ask', async (req, res) => {
   try {
      if (!(await allowed(req))) return res.status(403).json({ error: 'The assistant is not enabled for your role' });
      const { question, history, site } = req.body || {};
      const out = await askAssistant({
         question, history: Array.isArray(history) ? history : [],
         siteId: site || req.query.site || null,
         user: req.user,
         authHeader: req.headers.authorization || '',
      });
      res.json(out);
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

/**
 * Speech in, text out — for BayOps' command-bar mic. The same transcription
 * OpenAI service the WhatsApp voice-note pipeline already uses
 * (services/mediaUnderstanding.js); this just exposes it for the app to
 * call directly instead of only ever running against an inbound WhatsApp
 * voice note. Text only comes back — the caller still runs it through /ask
 * itself, exactly as if it had been typed.
 */
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
   });
});

router.get('/config', requireAdmin, async (_req, res) => {
   try {
      const c = await getAssistantConfig();
      res.json({
         enabled: c.enabled, systemPrompt: c.systemPrompt, model: c.model, maxToolRounds: c.maxToolRounds, roles: c.roles,
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
