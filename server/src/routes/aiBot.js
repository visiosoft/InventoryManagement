import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { AiBotThread, User, WhatsAppMessage } from '../models/index.js';
import { getAiBotConfig, generateReply, decideAction, runAiBotTick, aiBotState, pauseBotForHuman, DEFAULT_PROMPT } from '../services/aiBot.js';
import { openaiConfigured, openaiModel, synthesizeSpeech } from '../services/openai.js';
import { sendWhatsAppMedia, uploadWhatsAppMedia, whatsappSendConfigured } from '../services/whatsapp.js';

const router = Router();

/** How long the assistant's instructions may be. Generous, and enforced
 *  rather than applied silently — see the note in the handler. */
const PROMPT_LIMIT = 40000;

/** The voices OpenAI offers for spoken replies. */
/* Every voice the speech model offers. The first five are the newer, more
   natural ones; alloy and echo are the flattest, which is what people mean
   when they say it sounds robotic. */
const VOICES = ['coral', 'sage', 'ballad', 'ash', 'verse', 'nova', 'shimmer', 'fable', 'onyx', 'alloy', 'echo'];

const shape = (config) => ({
    enabled: config.enabled,
    mode: config.mode,
    systemPrompt: config.systemPrompt,
    useAvailability: config.useAvailability,
    autoSummarise: config.autoSummarise !== false,
    sendVideoOnFirstContact: Boolean(config.sendVideoOnFirstContact),
    replyWithVoice: Boolean(config.replyWithVoice),
    voice: config.voice || 'coral',
    voiceStyle: config.voiceStyle || '',
    voices: VOICES,
    escalateTo: config.escalateTo ? String(config.escalateTo) : '',
    handoverKeywords: config.handoverKeywords || [],
    maxRepliesPerThreadPerDay: config.maxRepliesPerThreadPerDay,
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
    if (b.sendVideoOnFirstContact !== undefined) config.sendVideoOnFirstContact = Boolean(b.sendVideoOnFirstContact);
    if (b.replyWithVoice !== undefined) config.replyWithVoice = Boolean(b.replyWithVoice);
    // Only the voices OpenAI actually offers; anything else is a silent failure.
    if (b.voice !== undefined && VOICES.includes(String(b.voice))) config.voice = String(b.voice);
    if (b.voiceStyle !== undefined) config.voiceStyle = String(b.voiceStyle).slice(0, 600);
    if (b.handoverKeywords !== undefined) {
        config.handoverKeywords = (Array.isArray(b.handoverKeywords) ? b.handoverKeywords : [])
            .map((k) => String(k).trim().toLowerCase()).filter(Boolean).slice(0, 30);
    }
    if (b.maxRepliesPerThreadPerDay !== undefined) {
        config.maxRepliesPerThreadPerDay = Math.min(200, Math.max(1, Number(b.maxRepliesPerThreadPerDay) || 20));
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

/**
 * Write a fresh suggestion for whatever the customer last said.
 *
 * A dismissed suggestion is gone — that is what dismissing means — and there
 * was no way to ask for another short of waiting for the customer to write
 * again. This asks now, against the same conversation, so a suggestion
 * dismissed by accident or a wording worth a second try is one click away.
 */
router.post('/threads/:phone/suggest', async (req, res) => {
    try {
        const phoneNormalized = String(req.params.phone).replace(/\D/g, '');
        const config = await getAiBotConfig();
        if (!openaiConfigured()) return res.status(400).json({ error: 'OpenAI is not configured' });

        const thread = await AiBotThread.findOne({ phoneNormalized });
        // The last thing they actually said, which is what a reply answers.
        const lastInbound = await WhatsAppMessage.findOne({ phoneNormalized, direction: 'inbound' })
            .sort({ occurredAt: -1 }).select('text type').lean();

        const inboundText = String(thread?.pendingText || lastInbound?.text || '').trim();
        if (!inboundText) {
            return res.status(400).json({ error: 'There is nothing of theirs to answer — the last thing they sent was not text the assistant can read' });
        }

        const result = await generateReply({ phoneNormalized, inboundText, config });
        if (!result.reply) {
            return res.status(502).json({ error: result.reason || 'The assistant had nothing to suggest' });
        }

        await AiBotThread.updateOne(
            { phoneNormalized },
            { $set: { draftText: result.reply, draftAt: new Date() }, $setOnInsert: { phoneNormalized } },
            { upsert: true },
        );
        res.json({ ok: true, reply: result.reply, needsHuman: Boolean(result.needsHuman) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Clear a suggestion a human does not want.
router.post('/threads/:phone/dismiss-draft', async (req, res) => {
    const phoneNormalized = String(req.params.phone).replace(/\D/g, '');
    await AiBotThread.updateOne({ phoneNormalized }, { $set: { draftText: '', draftAt: null } });
    res.json({ ok: true });
});

// Run a pass now rather than waiting for the interval — used when testing.
/**
 * Hear a suggested reply before it goes anywhere.
 *
 * Synthesised on demand rather than stored with the draft, so what you hear is
 * the wording as it stands — including an edit made a moment ago. Nothing is
 * sent and nothing is written down.
 */
router.post('/speak', async (req, res) => {
    try {
        const text = String(req.body?.text || '').trim();
        if (!text) return res.status(400).json({ error: 'Nothing to say' });

        /* A voice and a style may be supplied so the settings page can try one
           before saving it; otherwise it speaks as it currently would. */
        const config = await getAiBotConfig();
        const audio = await synthesizeSpeech({
            text,
            voice: VOICES.includes(String(req.body?.voice)) ? String(req.body.voice) : (config.voice || 'coral'),
            instructions: req.body?.voiceStyle !== undefined
                ? String(req.body.voiceStyle).slice(0, 600)
                : (config.voiceStyle || ''),
        });
        if (!audio) return res.status(502).json({ error: 'The voice could not be produced' });

        res.setHeader('Content-Type', 'audio/ogg');
        res.setHeader('Cache-Control', 'no-store');
        res.send(audio);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Send a suggestion as a voice note.
 *
 * The same words are spoken again here rather than a recording being carried
 * over from the preview: the preview may have been of an earlier wording, and
 * sending a customer something different from what was approved is the one
 * outcome worth ruling out. The words are stored on the message either way, so
 * the thread stays readable.
 */
router.post('/speak-and-send', async (req, res) => {
    try {
        const phoneNormalized = String(req.body?.phone || '').replace(/\D/g, '');
        const text = String(req.body?.text || '').trim();
        if (!phoneNormalized) return res.status(400).json({ error: 'Which conversation?' });
        if (!text) return res.status(400).json({ error: 'Nothing to say' });
        if (!whatsappSendConfigured()) return res.status(400).json({ error: 'WhatsApp is not configured' });

        const config = await getAiBotConfig();
        const audio = await synthesizeSpeech({ text, voice: config.voice || 'coral', instructions: config.voiceStyle || '' });
        if (!audio) return res.status(502).json({ error: 'The voice could not be produced — send it as text instead' });

        const mediaId = await uploadWhatsAppMedia({ buffer: audio, mimeType: 'audio/ogg', filename: 'reply.ogg' });
        const sent = await sendWhatsAppMedia({ to: phoneNormalized, mediaId, kind: 'audio', filename: 'reply.ogg' });

        await WhatsAppMessage.create({
            messageId: sent?.messages?.[0]?.id || '',
            phone: phoneNormalized,
            phoneNormalized,
            direction: 'outbound',
            type: 'audio',
            text,
            transcript: text,
            status: 'sent',
            occurredAt: new Date(),
            // A person approved these words, so it must pause the assistant the
            // way any other reply by hand does.
            sentByAi: false,
            raw: sent,
        });

        await pauseBotForHuman(phoneNormalized);
        await AiBotThread.updateOne({ phoneNormalized }, { $set: { draftText: '', draftAt: null } });

        res.json({ ok: true });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

router.post('/run', requireAdmin, async (_req, res) => {
    res.json(await runAiBotTick());
});

export default router;
