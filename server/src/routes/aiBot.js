import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { AiBotThread, User, WhatsAppMessage } from '../models/index.js';
import { getAiBotConfig, generateReply, decideAction, runAiBotTick, aiBotState, pauseBotForHuman, speakAsConfigured, DEFAULT_PROMPT } from '../services/aiBot.js';
import { openaiConfigured, openaiModel, synthesizeSpeech } from '../services/openai.js';
import { sendWhatsAppMedia, uploadWhatsAppMedia, whatsappSendConfigured } from '../services/whatsapp.js';
import { understandMedia } from '../services/mediaUnderstanding.js';
import { mediaFromRaw } from './whatsappMedia.js';

const router = Router();

/** How long the assistant's instructions may be. Generous, and enforced
 *  rather than applied silently — see the note in the handler. */
const PROMPT_LIMIT = 40000;

/** The voices OpenAI offers for spoken replies. */
/* Every voice the speech model offers. The first five are the newer, more
   natural ones; alloy and echo are the flattest, which is what people mean
   when they say it sounds robotic. */
/** What can be put behind the voice. */
/** What the assistant can make sense of itself. Mirrors READABLE_TYPES in
 *  services/aiBot.js — the worker and this button must agree about what can be
 *  answered, or one of them refuses what the other handles. */
const READABLE = new Set(['audio', 'voice', 'image']);

/** What a customer would call the thing they just sent. The words go into the
 *  prompt, so "a audio" reads back in the suggestion; these do not. */
const ATTACHMENT_NAMES = {
    audio: 'a voice note',
    voice: 'a voice note',
    image: 'a photo',
    video: 'a video',
    document: 'a document',
    location: 'their location',
    sticker: 'a sticker',
    contacts: 'a contact card',
};
function describeAttachment(type) {
    return ATTACHMENT_NAMES[String(type)] || 'something the assistant cannot open';
}

const AMBIENCE = ['none', 'room', 'office', 'callcentre'];

const VOICES = ['coral', 'sage', 'ballad', 'ash', 'verse', 'nova', 'shimmer', 'fable', 'onyx', 'alloy', 'echo'];

/* What the assistant may be set to answer with.
 *
 * A short list rather than everything the key can reach: each of these was put
 * through the same two questions against the real instructions and the real
 * price list, and each behaved. An untested model in a dropdown is a promise
 * nobody checked.
 *
 * `cost` is relative to the cheapest, on this prompt — the instructions are
 * 33,000 characters, so input dominates and the multiples hold.
 */
const MODELS = [
    {
        id: 'gpt-4o-mini',
        label: 'GPT-4o mini',
        cost: '1×',
        note: 'Cheapest. Quoted a price off a guessed size when asked what a 2-bedroom flat needs.',
    },
    {
        id: 'gpt-4.1-mini',
        label: 'GPT-4.1 mini',
        cost: '~3×',
        note: 'Asked what was being stored before quoting. The best balance of the four.',
    },
    {
        id: 'gpt-4o',
        label: 'GPT-4o',
        cost: '~13×',
        note: 'Quoted off a guess, then handed the conversation to a person.',
    },
    {
        id: 'gpt-4.1',
        label: 'GPT-4.1',
        cost: '~13×',
        note: 'Best answers of the four, and the readiest to state availability on its own.',
    },
];
const MODEL_IDS = MODELS.map((m) => m.id);

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
    voiceSpeed: config.voiceSpeed ?? 1.15,
    voiceAmbience: config.voiceAmbience || 'none',
    voiceAmbienceLevel: config.voiceAmbienceLevel ?? 0.08,
    voices: VOICES,
    // Empty means whatever the server is set to, which is what the page shows
    // as the default rather than pretending a choice has been made.
    model: config.model || '',
    models: MODELS,
    serverModel: openaiModel(),
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
    /* Only a model that was actually tried. An empty string is allowed and
       means "follow the server", which is how somebody undoes a choice. */
    if (b.model !== undefined) {
        const wanted = String(b.model || '');
        if (wanted && !MODEL_IDS.includes(wanted)) {
            return res.status(400).json({ error: `That model is not one of: ${MODEL_IDS.join(', ')}` });
        }
        config.model = wanted;
    }
    if (b.useAvailability !== undefined) config.useAvailability = Boolean(b.useAvailability);
    if (b.autoSummarise !== undefined) config.autoSummarise = Boolean(b.autoSummarise);
    if (b.sendVideoOnFirstContact !== undefined) config.sendVideoOnFirstContact = Boolean(b.sendVideoOnFirstContact);
    if (b.replyWithVoice !== undefined) config.replyWithVoice = Boolean(b.replyWithVoice);
    // Only the voices OpenAI actually offers; anything else is a silent failure.
    if (b.voice !== undefined && VOICES.includes(String(b.voice))) config.voice = String(b.voice);
    if (b.voiceStyle !== undefined) config.voiceStyle = String(b.voiceStyle).slice(0, 600);
    if (b.voiceSpeed !== undefined) config.voiceSpeed = Math.min(2, Math.max(0.5, Number(b.voiceSpeed) || 1));
    if (b.voiceAmbience !== undefined && AMBIENCE.includes(String(b.voiceAmbience))) config.voiceAmbience = String(b.voiceAmbience);
    if (b.voiceAmbienceLevel !== undefined) config.voiceAmbienceLevel = Math.min(0.4, Math.max(0, Number(b.voiceAmbienceLevel) || 0));
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
            .sort({ occurredAt: -1 }).select('text type transcript raw occurredAt').lean();

        let inboundText = String(thread?.pendingText || lastInbound?.text || lastInbound?.transcript || '').trim();
        let note = '';

        /* A voice note or a photo is read here too.
         *
         * This asked only for text and refused everything else — "there is
         * nothing of theirs to answer" — while the worker that writes
         * suggestions on its own had been reading both for days. Pressing the
         * button after somebody sent a voice note gave an error about a
         * limitation that no longer existed.
         */
        if (!inboundText && READABLE.has(String(lastInbound?.type))) {
            const read = await understandMedia({
                kind: lastInbound.type,
                mediaId: mediaFromRaw(lastInbound.raw)?.id || '',
                sentAt: lastInbound.occurredAt,
            });
            if (read.text) {
                inboundText = read.text;
                // Kept, so a colleague sees the words rather than a player.
                if (read.kind === 'audio') {
                    await WhatsAppMessage.updateOne({ _id: lastInbound._id }, { $set: { transcript: read.text } }).catch(() => {});
                }
            } else {
                /* Why it could not be read stays out of the prompt: those
                   messages are for us ("reconnect the token in Settings"), and
                   a customer must never be told about our plumbing. */
                note = 'it could not be opened';
            }
        }

        /* Every message gets an answer.
         *
         * This used to refuse anything it could not read, which meant the
         * button did nothing on exactly the conversations somebody most wants
         * help with — a video, a document, a sticker. The whole conversation is
         * still there to answer from, so an attachment nobody can read is
         * described and the assistant replies to it the way a person would:
         * acknowledging what arrived and asking about it.
         */
        if (!inboundText) {
            inboundText = `[The customer sent ${describeAttachment(lastInbound?.type)}${note ? `, and ${note}` : ''}. Acknowledge what they sent, answer from the rest of the conversation, and ask them about it if you need to.]`;
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
        /* Anything supplied is tried without being saved, so a voice, a pace,
           a style or a room can be heard before it is committed to. */
        const config = await getAiBotConfig();
        const audio = await speakAsConfigured(text, {
            voice: VOICES.includes(String(req.body?.voice)) ? String(req.body.voice) : (config.voice || 'coral'),
            voiceStyle: req.body?.voiceStyle !== undefined
                ? String(req.body.voiceStyle).slice(0, 600)
                : (config.voiceStyle || ''),
            voiceSpeed: req.body?.voiceSpeed !== undefined
                ? Number(req.body.voiceSpeed)
                : (config.voiceSpeed ?? 1.15),
            voiceAmbience: AMBIENCE.includes(String(req.body?.voiceAmbience))
                ? String(req.body.voiceAmbience)
                : (config.voiceAmbience || 'none'),
            voiceAmbienceLevel: req.body?.voiceAmbienceLevel !== undefined
                ? Number(req.body.voiceAmbienceLevel)
                : (config.voiceAmbienceLevel ?? 0.08),
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
        const audio = await speakAsConfigured(text, config);
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
