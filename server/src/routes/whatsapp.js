import { Router } from 'express';
import { mediaFromRaw } from './whatsappMedia.js';
import { WhatsAppMessage, Lead, Customer, AiBotThread } from '../models/index.js';
import { sendWhatsAppText, sendWhatsAppMedia, uploadWhatsAppMedia, whatsappMediaKind, whatsappSendConfigured, whatsappSendMissing } from '../services/whatsapp.js';
import { pauseBotForHuman } from '../services/aiBot.js';
import multer from 'multer';
import { createLeadFromWhatsAppPhone } from '../services/whatsappLeadSync.js';

const router = Router();

router.get('/messages', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const phone = String(req.query.phone || '').trim();
    const q = {};

    if (phone) {
        q.phoneNormalized = phone.replace(/\D/g, '');
    }

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
