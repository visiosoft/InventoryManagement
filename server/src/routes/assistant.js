import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { askAssistant, getAssistantConfig, DEFAULT_PROMPT } from '../services/assistant/index.js';
import { toolNames } from '../services/assistant/tools.js';
import { takeProposal, dropProposal, runAction } from '../services/assistant/actions.js';
import { openaiConfigured, openaiModel } from '../services/openai.js';

const router = Router();

const PROMPT_LIMIT = 20000;

/** Who may ask. Set on the config; reports are admin and accounts, and this
 *  sees the same figures, so that is the default. */
async function allowed(req) {
   const config = await getAssistantConfig();
   const roles = config.roles?.length ? config.roles : ['admin', 'accounts'];
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
      });
      res.json(out);
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

async function mayAct(req) {
   const c = await getAssistantConfig();
   if (c.actionsEnabled === false) return false;
   return (c.actionRoles?.length ? c.actionRoles : ['admin']).includes(req.user?.role);
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

export default router;
