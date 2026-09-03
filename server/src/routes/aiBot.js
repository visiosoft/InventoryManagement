import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { AiBotThread, User } from '../models/index.js';
import { getAiBotConfig, generateReply, decideAction, runAiBotTick, aiBotState, DEFAULT_PROMPT } from '../services/aiBot.js';
import { openaiConfigured, openaiModel } from '../services/openai.js';

const router = Router();

/** How long the assistant's instructions may be. Generous, and enforced
 *  rather than applied silently — see the note in the handler. */
const PROMPT_LIMIT = 40000;

const shape = (config) => ({
    enabled: config.enabled,
    mode: config.mode,
    systemPrompt: config.systemPrompt,
    useAvailability: config.useAvailability,
    autoSummarise: config.autoSummarise !== false,
    escalateTo: config.escalateTo ? String(config.escalateTo) : '',
    handoverKeywords: config.handoverKeywords || [],
    maxRepliesPerThreadPerDay: config.maxRepliesPerThreadPerDay,
    humanPauseHours: config.humanPauseHours,
    defaultPrompt: DEFAULT_PROMPT,
    // So the page can show the real ceiling rather than a number copied by hand.
    promptLimit: PROMPT_LIMIT,
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
    /* The instructions, whole or refused — never quietly shortened.
     *
     * This used to slice at 8,000 characters and save the stump. Somebody
     * pasted a prompt with eleven numbered sections, saved it, and got back
     * one that stopped mid-word in section 11 — "the customer's first
     * interaction. D" — with everything after it gone and nothing said. From
     * the page it read as "it is not saving".
     *
     * 40,000 leaves room for a prompt of that shape several times over and is
     * still a fraction of what the model will read. Over it, the request is
     * refused with the number, so the person can see what to cut. */
    if (b.systemPrompt !== undefined) {
        const prompt = String(b.systemPrompt);
        if (prompt.length > PROMPT_LIMIT) {
            return res.status(400).json({
                error: `Those instructions are ${prompt.length.toLocaleString()} characters and the limit is ${PROMPT_LIMIT.toLocaleString()}. Nothing was saved — shorten them and save again.`,
            });
        }
        config.systemPrompt = prompt;
    }
    if (b.useAvailability !== undefined) config.useAvailability = Boolean(b.useAvailability);
    if (b.autoSummarise !== undefined) config.autoSummarise = Boolean(b.autoSummarise);
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

    // Run the same guards the worker runs, so the box shows the real outcome.
    // Testing only the model would hide the handover keywords entirely, and
    // those decide a good share of real conversations.
    const decision = decideAction({
        thread: {
            status: 'bot',
            pendingText: text,
            pendingType: 'text',
            pendingAt: new Date(),
            repliesOn: '',
            repliesCount: 0,
        },
        config,
    });

    if (decision.action === 'escalate') {
        return res.json({ reply: '', needsHuman: true, reason: decision.reason, decidedBy: 'rule' });
    }

    try {
        const result = await generateReply({
            phoneNormalized: String(req.body?.phone || '').replace(/\D/g, ''),
            inboundText: text,
            config,
        });
        res.json({ ...result, decidedBy: 'model' });
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
