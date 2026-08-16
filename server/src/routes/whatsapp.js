import { Router } from 'express';
import { WhatsAppMessage, Lead } from '../models/index.js';
import { sendWhatsAppText, whatsappSendConfigured, whatsappSendMissing } from '../services/whatsapp.js';
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
        .limit(limit);

    res.json(messages);
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

    res.json(rows.map((r) => ({
        phoneNormalized: r._id,
        phone: r.phone,
        count: r.count,
        lastAt: r.lastAt,
        lead: r.lead?.[0]
            ? { _id: r.lead[0]._id, fullName: r.lead[0].fullName, status: r.lead[0].status }
            : null,
    })));
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
        raw: result,
    });

    res.json({ ok: true, result });
});

export default router;
