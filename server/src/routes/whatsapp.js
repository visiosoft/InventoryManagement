import { Router } from 'express';
import { mediaFromRaw } from './whatsappMedia.js';
import { WhatsAppMessage, Lead, Customer, AiBotThread, WhatsAppLabel, WhatsAppChatLabel, MessageTemplate } from '../models/index.js';
import { sendWhatsAppText, sendWhatsAppMedia, uploadWhatsAppMedia, whatsappMediaKind, whatsappSendConfigured, whatsappSendMissing } from '../services/whatsapp.js';
import { pauseBotForHuman } from '../services/aiBot.js';
import multer from 'multer';
import { createLeadFromWhatsAppPhone } from '../services/whatsappLeadSync.js';
import { summariseConversation, summariseRecent } from '../services/conversationSummary.js';
import { ensureDigest, dayKeyFor, previousDay } from '../services/dailyDigest.js';
import { DailyDigest } from '../models/index.js';
import { askInbox } from '../services/inboxAsk.js';

const router = Router();

/**
 * The WhatsApp thread belonging to a customer, for the Chat tab on a contract.
 *
 * Resolved here rather than in the browser because the numbers are stored
 * inconsistently — +971…, 0…, 971… — so matching is done on the last nine
 * digits, the same rule the inbox and the Zoho matcher already use. A customer
 * can have several numbers; whichever has been messaged most recently wins.
 */
router.get('/customer-thread/:customerId', async (req, res) => {
    const customer = await Customer.findById(req.params.customerId).select('fullName phone phones').lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const suffixes = [...(customer.phones || []), customer.phone]
        .map((p) => String(p || '').replace(/\D/g, ''))
        .filter((d) => d.length >= 9)
        .map((d) => d.slice(-9));

    if (suffixes.length === 0) {
        return res.json({ phoneNormalized: '', numbersTried: [], messages: [] });
    }

    const unique = [...new Set(suffixes)];
    const match = { $or: unique.map((sfx) => ({ phoneNormalized: { $regex: `${sfx}$` } })) };

    // Which of their numbers actually has a conversation, most recent first.
    const newest = await WhatsAppMessage.findOne(match).sort({ occurredAt: -1 }).select('phoneNormalized').lean();
    if (!newest) return res.json({ phoneNormalized: '', numbersTried: unique, messages: [] });

    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 300);
    const messages = await WhatsAppMessage.find({ phoneNormalized: newest.phoneNormalized })
        .sort({ occurredAt: -1 })
        .limit(limit)
        .lean();

    res.json({
        phoneNormalized: newest.phoneNormalized,
        numbersTried: unique,
        messages: messages.map((m) => {
            const media = mediaFromRaw(m.raw);
            const { raw, ...rest } = m;
            return media
                ? { ...rest, media: { kind: media.kind, mimeType: media.mimeType, filename: media.filename, caption: media.caption } }
                : rest;
        }),
    });
});

// ── Chat labels ──────────────────────────────────────────────────────────────
// Named tags a person puts on a conversation, the way the WhatsApp Business
// app does, so a chat can be found again later.

router.get('/labels', async (_req, res) => {
    const labels = await WhatsAppLabel.find({}).sort({ sortOrder: 1, name: 1 }).lean();
    // How many chats carry each one, so an unused label is obvious.
    const counts = await WhatsAppChatLabel.aggregate([
        { $unwind: '$labels' },
        { $group: { _id: '$labels', n: { $sum: 1 } } },
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json(labels.map((l) => ({ ...l, chatCount: byId.get(String(l._id)) || 0 })));
});

router.post('/labels', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'A label name is required' });
    const existing = await WhatsAppLabel.findOne({ name });
    if (existing) return res.status(409).json({ error: `There is already a label called "${name}"` });
    const label = await WhatsAppLabel.create({
        name,
        color: String(req.body?.color || '#5B2BC9'),
        sortOrder: Number(req.body?.sortOrder) || 0,
    });
    res.status(201).json({ ...label.toObject(), chatCount: 0 });
});

router.patch('/labels/:id', async (req, res) => {
    const label = await WhatsAppLabel.findById(req.params.id);
    if (!label) return res.status(404).json({ error: 'Label not found' });
    if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim();
        if (!name) return res.status(400).json({ error: 'A label name is required' });
        const clash = await WhatsAppLabel.findOne({ name, _id: { $ne: label._id } });
        if (clash) return res.status(409).json({ error: `There is already a label called "${name}"` });
        label.name = name;
    }
    if (req.body?.color !== undefined) label.color = String(req.body.color);
    if (req.body?.sortOrder !== undefined) label.sortOrder = Number(req.body.sortOrder) || 0;
    await label.save();
    res.json(label);
});

router.delete('/labels/:id', async (req, res) => {
    const label = await WhatsAppLabel.findById(req.params.id);
    if (!label) return res.status(404).json({ error: 'Label not found' });
    // Take it off every chat too, or those chats keep a reference to nothing.
    await WhatsAppChatLabel.updateMany({ labels: label._id }, { $pull: { labels: label._id } });
    await label.deleteOne();
    res.json({ ok: true });
});

// Set the labels on one conversation — the whole set, not a delta, so the
// picker can send exactly what is ticked.
router.put('/conversations/:phoneNormalized/labels', async (req, res) => {
    const phoneNormalized = String(req.params.phoneNormalized || '').replace(/\D/g, '');
    if (!phoneNormalized) return res.status(400).json({ error: 'A phone number is required' });

    const wanted = Array.isArray(req.body?.labelIds) ? req.body.labelIds.map(String) : [];
    // Only ids that still exist, so a label deleted in another tab cannot be
    // written back onto a chat.
    const valid = await WhatsAppLabel.find({ _id: { $in: wanted } }).select('_id').lean();
    const labels = valid.map((l) => l._id);

    await WhatsAppChatLabel.findOneAndUpdate(
        { phoneNormalized },
        { $set: { labels }, $setOnInsert: { phoneNormalized } },
        { upsert: true },
    );
    res.json({ ok: true, labels: labels.map(String) });
});

router.get('/messages', async (req, res) => {
    const phone = String(req.query.phone || '').trim();
    const q = {};

    if (phone) {
        q.phoneNormalized = phone.replace(/\D/g, '');
    }

    /* One conversation comes back whole.
     *
     * The limit defaulted to 100 for both cases, so opening a chat with more
     * than a hundred messages silently dropped its oldest ones. The history was
     * in the database the whole time — it was simply never sent. A single
     * thread is naturally bounded, so it gets a ceiling high enough not to bite
     * rather than a page size.
     *
     * The whole-inbox feed keeps a small one: it drives unread counts and the
     * ping, and does not need every message ever sent to do that.
     */
    const limit = phone
        ? Math.min(Math.max(Number(req.query.limit) || 2000, 1), 5000)
        : Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    const messages = await WhatsAppMessage.find(q)
        .populate('lead', 'fullName phone status source')
        .sort({ occurredAt: -1, createdAt: -1 })
        .limit(limit)
        .lean();

    // Attachments are described inside the stored webhook payload. Surface a
    // small descriptor so the client can render the right element without
    // shipping the whole raw payload to the browser.
    res.json(messages.map((m) => {
        const media = mediaFromRaw(m.raw);
        const { raw, ...rest } = m;
        return media
            ? { ...rest, media: { kind: media.kind, mimeType: media.mimeType, filename: media.filename, caption: media.caption } }
            : rest;
    }));
});

router.get('/conversations', async (_req, res) => {
    const rows = await WhatsAppMessage.aggregate([
        { $sort: { occurredAt: -1 } },
        {
            $group: {
                _id: '$phoneNormalized',
                lastAt: { $max: '$occurredAt' },
                count: { $sum: 1 },
                phone: { $first: '$phone' },
                // Newest linked lead on the thread — drives the inbox's
                // create-lead vs. save-as-customer button without a second call.
                leadId: { $first: '$lead' },
            },
        },
        { $sort: { lastAt: -1 } },
        { $limit: 200 },
        {
            $lookup: {
                from: 'leads',
                localField: 'leadId',
                foreignField: '_id',
                as: 'lead',
                pipeline: [{ $project: { fullName: 1, status: 1 } }],
            },
        },
    ]);

    // Resolve a real name where we have one. Customers are matched on the
    // last 9 digits because numbers are stored inconsistently (+971 …, 0…,
    // 971…), the same rule the Zoho matcher uses.
    const suffix = (v) => {
        const d = String(v || '').replace(/\D/g, '');
        return d.length >= 9 ? d.slice(-9) : '';
    };
    const customers = await Customer.find({}).select('fullName phone phones').lean();
    const byPhone = new Map();
    for (const c of customers) {
        for (const p of [...(c.phones || []), c.phone]) {
            const k = suffix(p);
            if (k && !byPhone.has(k)) byPhone.set(k, c);
        }
    }

    // Leads created from a chat get an auto-generated placeholder name. It is
    // not a name, so it must never win over the number.
    const isPlaceholderName = (n) => !n || /^whatsapp\s*contact/i.test(String(n).trim());

    // The AI assistant's state per thread — whether it has a suggestion waiting
    // and whether it has handed the conversation over.
    const botThreads = await AiBotThread.find({ phoneNormalized: { $in: rows.map((r) => r._id) } })
        .select('phoneNormalized status draftText escalationReason')
        .lean();
    const byThread = new Map(botThreads.map((t) => [t.phoneNormalized, t]));

    const chatLabels = await WhatsAppChatLabel.find({ phoneNormalized: { $in: rows.map((r) => r._id) } })
        .populate('labels', 'name color sortOrder')
        .lean();
    const byLabels = new Map(chatLabels.map((c) => [c.phoneNormalized, c.labels || []]));

    res.json(rows.map((r) => {
        const lead = r.lead?.[0] || null;
        const customer = byPhone.get(suffix(r._id)) || null;
        const leadName = isPlaceholderName(lead?.fullName) ? '' : lead.fullName;
        const bot = byThread.get(r._id) || null;
        return {
            phoneNormalized: r._id,
            phone: r.phone,
            count: r.count,
            lastAt: r.lastAt,
            lead: lead ? { _id: lead._id, fullName: lead.fullName, status: lead.status } : null,
            customer: customer ? { _id: customer._id, fullName: customer.fullName } : null,
            // What the inbox should show: a real name if we hold one,
            // otherwise the number itself — never a placeholder.
            displayName: customer?.fullName || leadName || (r.phone || r._id),
            labels: byLabels.get(r._id) || [],
            botStatus: bot?.status || '',
            botDraft: bot?.draftText || '',
            botEscalationReason: bot?.escalationReason || '',
        };
    }));
});

// Link a chat to a lead. Inbound chats usually get one automatically from the
// webhook sync, so this is the manual path for numbers that don't have one yet
// (e.g. a thread we started outbound). Idempotent — returns the existing lead
// rather than creating a duplicate.
/* ── Daily digest ─────────────────────────────────────────────────────────
   One day's conversations as read that morning. Declared before /:phone routes
   so "digest" is never taken for a phone number. */

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Which days have been built, newest first.
router.get('/digest/days', async (_req, res) => {
    try {
        const days = await DailyDigest.find().sort({ day: -1 }).select('day builtAt stats').limit(90).lean();
        res.json({ days, today: dayKeyFor(), yesterday: previousDay(dayKeyFor()) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/digest/:day', async (req, res) => {
    try {
        const day = String(req.params.day || '');
        if (!DAY_KEY.test(day)) return res.status(400).json({ error: 'Expected a day as YYYY-MM-DD' });
        const stored = await DailyDigest.findOne({ day }).lean();
        // Never built rather than nothing happened — the page says which.
        if (!stored) return res.json({ day, built: false, stats: null, chats: [] });
        res.json({ ...stored, built: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Build on demand, so today can be read before tomorrow morning.
router.post('/digest/:day/build', async (req, res) => {
    try {
        const day = String(req.params.day || '');
        if (!DAY_KEY.test(day)) return res.status(400).json({ error: 'Expected a day as YYYY-MM-DD' });
        const out = await ensureDigest(day, { rebuild: req.query.rebuild === '1' });
        res.json({ ...out, built: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Read every conversation that moved in the last couple of days.
 *
 * Bounded by window and by count, so one click cannot become a large bill.
 */
router.post('/summarise-recent', async (req, res) => {
    try {
        const days = Math.min(Math.max(1, Number(req.body?.days) || 2), 14);
        res.json(await summariseRecent({ days }));
    } catch (e) {
        res.status(500).json({ error: e.message || 'Could not summarise' });
    }
});

/**
 * Ask a question of the whole inbox.
 *
 * Most questions are answered straight from the database and cost nothing;
 * `usedModel` in the response says which. Read-only.
 */
router.get('/ask', async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (!q) return res.status(400).json({ error: 'Ask a question' });
        res.json(await askInbox(q));
    } catch (e) {
        res.status(500).json({ error: e.message || 'Could not answer that' });
    }
});

/**
 * A short read of one thread, for the strip above the chat.
 *
 * GET returns the stored summary and generates one only if the conversation
 * has moved since — so clicking through an inbox does not pay for the same
 * summary again. `?force=1` regenerates on demand.
 *
 * Read-only: it writes nothing to the Lead and sends nothing.
 */
router.get('/conversations/:phoneNormalized/summary', async (req, res) => {
    try {
        const phoneNormalized = String(req.params.phoneNormalized || '').replace(/\D/g, '');
        if (!phoneNormalized) return res.status(400).json({ error: 'A phone number is required' });
        const out = await summariseConversation(phoneNormalized, { force: req.query.force === '1' });
        res.json(out);
    } catch (e) {
        res.status(500).json({ error: e.message || 'Could not summarise this conversation' });
    }
});

router.post('/conversations/:phoneNormalized/lead', async (req, res) => {
    const phoneNormalized = String(req.params.phoneNormalized || '').replace(/\D/g, '');
    if (!phoneNormalized) return res.status(400).json({ error: 'A phone number is required' });

    const linked = await WhatsAppMessage.findOne({ phoneNormalized, lead: { $ne: null } })
        .sort({ occurredAt: -1 })
        .populate('lead', 'fullName status');
    if (linked?.lead) return res.json({ action: 'exists', lead: linked.lead });

    const existing = await Lead.findOne({ phoneNormalized }).select('fullName status');
    if (existing) {
        await WhatsAppMessage.updateMany({ phoneNormalized, lead: null }, { $set: { lead: existing._id } });
        return res.json({ action: 'exists', lead: existing });
    }

    const sample = await WhatsAppMessage.findOne({ phoneNormalized }).sort({ occurredAt: -1 }).select('phone');
    const lead = await createLeadFromWhatsAppPhone({
        phone: sample?.phone || phoneNormalized,
        phoneNormalized,
        fullName: req.body?.fullName,
        ownerId: req.user.id,
        timelineText: 'Lead created from the WhatsApp inbox',
    });
    if (!lead) return res.status(500).json({ error: 'Could not create the lead' });

    await WhatsAppMessage.updateMany({ phoneNormalized, lead: null }, { $set: { lead: lead._id } });
    res.status(201).json({ action: 'created', lead: { _id: lead._id, fullName: lead.fullName, status: lead.status } });
});

router.post('/send', async (req, res) => {
    if (!whatsappSendConfigured()) {
        return res.status(400).json({ error: `WhatsApp not configured. Missing: ${whatsappSendMissing().join(', ')}` });
    }
    const { to, body } = req.body || {};
    if (!to || !body) return res.status(400).json({ error: 'to and body are required' });

    const result = await sendWhatsAppText({ to, body });

    const phoneNormalized = String(to).replace(/\D/g, '');
    await WhatsAppMessage.create({
        messageId: result?.messages?.[0]?.id || '',
        phone: to,
        phoneNormalized,
        direction: 'outbound',
        type: 'text',
        text: body,
        status: 'sent',
        occurredAt: new Date(),
        // Set explicitly by the assistant's own send; a message from this route
        // is always someone typing it.
        sentByAi: false,
        raw: result,
    });

    // A colleague has taken the conversation, so the assistant steps back and
    // its pending suggestion — now stale — is dropped.
    await pauseBotForHuman(phoneNormalized);

    res.json({ ok: true, result });
});

/**
 * Send one quick reply — its file, its text, or both.
 *
 * Assembled on the server rather than the browser so the console does not need
 * to know whether a given reply carries a file, and so the URL is resolved
 * against what is actually stored rather than what the page happened to render.
 */
router.post('/send-quick-reply', async (req, res) => {
    try {
        if (!whatsappSendConfigured()) {
            return res.status(400).json({ error: `WhatsApp not configured. Missing: ${whatsappSendMissing().join(', ')}` });
        }
        const to = String(req.body?.to || '').trim();
        if (!to) return res.status(400).json({ error: 'to is required' });

        const template = await MessageTemplate.findById(req.body?.templateId).lean();
        if (!template) return res.status(404).json({ error: 'Quick reply not found' });

        const phoneNormalized = String(to).replace(/\D/g, '');
        const body = String(template.whatsappBody || '').trim();
        const sent = [];

        // The file goes first, with the text as its caption when both exist —
        // one message rather than two, which is how a person would send it.
        if (template.mediaUrl && template.mediaKind) {
            const captionable = ['image', 'video', 'document'].includes(template.mediaKind);
            const caption = captionable ? body : '';
            const result = await sendWhatsAppMedia({
                to,
                link: template.mediaUrl,
                kind: template.mediaKind,
                caption,
                filename: template.mediaFilename || undefined,
            });
            await WhatsAppMessage.create({
                messageId: result?.messages?.[0]?.id || '',
                phone: to,
                phoneNormalized,
                direction: 'outbound',
                type: template.mediaKind,
                text: caption,
                status: 'sent',
                occurredAt: new Date(),
                sentByAi: false,
                // Same shape the inbound webhook produces, so the thread renders
                // it and the media proxy can serve it back.
                raw: { [template.mediaKind]: { link: template.mediaUrl, caption, filename: template.mediaFilename || '' }, sendResult: result },
            });
            sent.push(template.mediaKind);
            if (caption) sent.push('text');
        }

        // Text on its own, or alongside a file that cannot carry a caption.
        const needsSeparateText = body && !sent.includes('text');
        if (needsSeparateText) {
            const result = await sendWhatsAppText({ to, body });
            await WhatsAppMessage.create({
                messageId: result?.messages?.[0]?.id || '',
                phone: to,
                phoneNormalized,
                direction: 'outbound',
                type: 'text',
                text: body,
                status: 'sent',
                occurredAt: new Date(),
                sentByAi: false,
                raw: result,
            });
            sent.push('text');
        }

        if (!sent.length) return res.status(400).json({ error: 'This quick reply has neither text nor a file' });

        await pauseBotForHuman(phoneNormalized);
        res.json({ ok: true, sent });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Send a file. Stored as an outbound message carrying the same media shape
// the webhook produces for inbound ones, so the thread renders both the same
// way and the media proxy can serve it back.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

router.post('/send-media', upload.single('file'), async (req, res) => {
    try {
        if (!whatsappSendConfigured()) {
            return res.status(400).json({ error: `WhatsApp not configured. Missing: ${whatsappSendMissing().join(', ')}` });
        }
        const to = String(req.body?.to || '').trim();
        if (!to) return res.status(400).json({ error: 'to is required' });
        if (!req.file) return res.status(400).json({ error: 'A file is required' });

        const caption = String(req.body?.caption || '').trim();
        const kind = whatsappMediaKind(req.file.mimetype);

        const mediaId = await uploadWhatsAppMedia({
            buffer: req.file.buffer,
            mimeType: req.file.mimetype,
            filename: req.file.originalname,
        });
        const result = await sendWhatsAppMedia({
            to, mediaId, kind, caption, filename: req.file.originalname,
        });

        await WhatsAppMessage.create({
            messageId: result?.messages?.[0]?.id || '',
            phone: to,
            phoneNormalized: String(to).replace(/\D/g, ''),
            direction: 'outbound',
            type: kind,
            text: caption,
            status: 'sent',
            occurredAt: new Date(),
            // Mirror the inbound webhook shape so mediaFromRaw finds it and the
            // same proxy serves it back into the thread.
            raw: { [kind]: { id: mediaId, mime_type: req.file.mimetype, filename: req.file.originalname, caption }, sendResult: result },
        });

        await pauseBotForHuman(String(to).replace(/\D/g, ''));

        res.json({ ok: true, kind, mediaId });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

export default router;
