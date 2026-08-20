import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { AiBotThread, User } from '../models/index.js';
import { getAiBotConfig, generateReply, runAiBotTick, aiBotState, DEFAULT_PROMPT } from '../services/aiBot.js';
import { openaiConfigured, openaiModel } from '../services/openai.js';

const router = Router();

const shape = (config) => ({
    enabled: config.enabled,
    mode: config.mode,
    systemPrompt: config.systemPrompt,
    useAvailability: config.useAvailability,
    escalateTo: config.escalateTo ? String(config.escalateTo) : '',
    handoverKeywords: config.handoverKeywords || [],
    maxRepliesPerThreadPerDay: config.maxRepliesPerThreadPerDay,
    humanPauseHours: config.humanPauseHours,
    defaultPrompt: DEFAULT_PROMPT,
    openai: { configured: openaiConfigured(), model: openaiModel() },
});

router.get('/config', requireAdmin, async (_req, res) => {
    res.json(shape(await getAiBotConfig()));
});

router.put('/config', requireAdmin, async (req, res) => {
    const config = await getAiBotConfig();
    const b = req.body || {};

    if (b.enabled !== undefined) config.enabled = Boolean(b.enabled);
    if (b.mode === 'draft' || b.mode === 'auto') config.mode = b.mode;
    if (b.systemPrompt !== undefined) config.systemPrompt = String(b.systemPrompt).slice(0, 8000);
    if (b.useAvailability !== undefined) config.useAvailability = Boolean(b.useAvailability);
    if (b.handoverKeywords !== undefined) {
        config.handoverKeywords = (Array.isArray(b.handoverKeywords) ? b.handoverKeywords : [])
            .map((k) => String(k).trim().toLowerCase()).filter(Boolean).slice(0, 30);
    }
    if (b.maxRepliesPerThreadPerDay !== undefined) {
        config.maxRepliesPerThreadPerDay = Math.min(200, Math.max(1, Number(b.maxRepliesPerThreadPerDay) || 20));
    }
    if (b.humanPauseHours !== undefined) {
        config.humanPauseHours = Math.min(168, Math.max(0, Number(b.humanPauseHours) || 0));
    }

    if (b.escalateTo !== undefined) {
        const id = String(b.escalateTo || '').trim();
        if (!id) {
            config.escalateTo = null;
        } else {
            // Escalating to a deleted or deactivated account would silently
            // drop every handover, so the assignee is checked on save.
            const user = await User.findById(id).select('_id isActive').catch(() => null);
            if (!user) return res.status(400).json({ error: 'That escalation assignee no longer exists' });
            if (user.isActive === false) return res.status(400).json({ error: 'That escalation assignee is deactivated' });
            config.escalateTo = user._id;
        }
    }

    // Turning the assistant on without somewhere to escalate means anything it
    // cannot answer goes nowhere at all.
    if (config.enabled && !config.escalateTo) {
        return res.status(400).json({ error: 'Choose who receives escalations before turning the assistant on' });
    }
    if (config.enabled && !openaiConfigured()) {
        return res.status(400).json({ error: 'Connect an OpenAI key in Settings → Integrations first' });
    }

    await config.save();
    res.json(shape(config));
});

// Compose a reply for a message you type, and send nothing. This is how the
// prompt gets tuned without experimenting on real customers.
router.post('/test', requireAdmin, async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Type a customer message to test' });
    if (!openaiConfigured()) return res.status(501).json({ error: 'OpenAI is not configured' });

    const config = await getAiBotConfig();
    // Any unsaved prompt from the editor, so the box tests what is on screen.
    if (typeof req.body?.systemPrompt === 'string' && req.body.systemPrompt.trim()) {
        config.systemPrompt = req.body.systemPrompt;
    }

    try {
        const result = await generateReply({
            phoneNormalized: String(req.body?.phone || '').replace(/\D/g, ''),
            inboundText: text,
            config,
        });
        res.json(result);
    } catch (err) {
        res.status(502).json({ error: err?.message || 'Could not reach OpenAI' });
    }
});

// Threads the assistant has handed over, so they are visible somewhere other
// than the task list.
router.get('/threads', requireAdmin, async (_req, res) => {
    const threads = await AiBotThread.find({ status: 'escalated' })
        .sort({ escalatedAt: -1 }).limit(50).lean();
    res.json({ threads, state: aiBotState });
});

// Put an escalated thread back under the assistant.
router.post('/threads/:phone/resume', requireAdmin, async (req, res) => {
    const phoneNormalized = String(req.params.phone).replace(/\D/g, '');
    const thread = await AiBotThread.findOne({ phoneNormalized });
    if (!thread) return res.status(404).json({ error: 'No assistant state for that number' });
    thread.status = 'bot';
    thread.pausedUntil = null;
    thread.escalatedAt = null;
    thread.escalationReason = '';
    await thread.save();
    res.json({ ok: true });
});

// Clear a suggestion a human does not want.
router.post('/threads/:phone/dismiss-draft', async (req, res) => {
    const phoneNormalized = String(req.params.phone).replace(/\D/g, '');
    await AiBotThread.updateOne({ phoneNormalized }, { $set: { draftText: '', draftAt: null } });
    res.json({ ok: true });
});

// Run a pass now rather than waiting for the interval — used when testing.
router.post('/run', requireAdmin, async (_req, res) => {
    res.json(await runAiBotTick());
});

export default router;
