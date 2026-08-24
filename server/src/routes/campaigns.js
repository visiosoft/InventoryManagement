import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { Campaign, CampaignRecipient } from '../models/index.js';
import { buildAudience } from '../services/campaignAudience.js';
import { mailConfigured, sendMail } from '../services/mail.js';
import { listWhatsAppTemplates, sendWhatsAppTemplate, whatsappSendConfigured } from '../services/whatsapp.js';
import { runCampaignTick } from '../services/campaignSender.js';

const router = Router();

// Marketing goes to people who are not expecting it, so it stays admin-only.
router.use(requireAdmin);

// What can be sent at all, so the composer can say why a channel is unavailable
// rather than failing at send time.
router.get('/channels', async (_req, res) => {
    const templates = await listWhatsAppTemplates().catch((e) => ({ configured: false, error: e.message, templates: [] }));
    res.json({
        email: mailConfigured(),
        whatsapp: whatsappSendConfigured(),
        templates: {
            configured: templates.configured,
            error: templates.error || '',
            // Only approved marketing/utility templates can actually be sent.
            approved: (templates.templates || []).filter((t) => t.status === 'APPROVED'),
            all: templates.templates || [],
        },
    });
});

// Resolve an audience without saving anything, so the composer can show a live
// count while the segment is being chosen.
router.post('/preview', async (req, res) => {
    try {
        const { counts, people } = await buildAudience(req.body?.audience || {});
        res.json({ counts, sample: people.slice(0, 8).map((p) => ({ name: p.name, email: p.email, phone: p.phoneNormalized })) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/', async (_req, res) => {
    const campaigns = await Campaign.find().sort({ createdAt: -1 }).limit(100).lean();
    res.json(campaigns);
});

router.get('/:id', async (req, res) => {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const recipients = await CampaignRecipient.find({ campaign: campaign._id })
        .sort({ status: 1, name: 1 }).limit(1000).lean();
    res.json({ campaign, recipients });
});

router.post('/', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Give the campaign a name' });
    const campaign = await Campaign.create({
        ...req.body,
        name,
        status: 'draft',
        createdBy: req.user.id,
        createdByName: req.user.name || req.user.email || '',
    });
    res.status(201).json(campaign);
});

router.put('/:id', async (req, res) => {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    // Once it has started going out, the wording is history — editing it would
    // make the record disagree with what people actually received.
    if (campaign.status !== 'draft') {
        return res.status(409).json({ error: 'This campaign has already been sent and can no longer be edited' });
    }
    for (const k of ['name', 'channel', 'audience', 'emailSubject', 'emailHtml', 'whatsapp']) {
        if (req.body?.[k] !== undefined) campaign[k] = req.body[k];
    }
    await campaign.save();
    res.json(campaign);
});

router.delete('/:id', async (req, res) => {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status === 'sending') return res.status(409).json({ error: 'This campaign is sending; cancel it first' });
    await CampaignRecipient.deleteMany({ campaign: campaign._id });
    await campaign.deleteOne();
    res.json({ ok: true });
});

/**
 * Send to one address or number you type — never to the audience.
 *
 * Required before a campaign can go out: nobody should read this wording for
 * the first time in a customer's inbox.
 */
router.post('/:id/test', async (req, res) => {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const email = String(req.body?.email || '').trim();
    const phone = String(req.body?.phone || '').replace(/\D/g, '');
    if (!email && !phone) return res.status(400).json({ error: 'Give an email address or a phone number to test with' });

    const done = [];
    try {
        if (email) {
            if (!mailConfigured()) return res.status(501).json({ error: 'Email is not configured — connect Gmail in Settings' });
            await sendMail({
                to: email,
                subject: `[TEST] ${campaign.emailSubject || campaign.name}`,
                html: campaign.emailHtml,
                text: String(campaign.emailHtml || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
            });
            done.push(`email to ${email}`);
        }
        if (phone) {
            if (!campaign.whatsapp?.templateName) return res.status(400).json({ error: 'Choose a WhatsApp template first' });
            await sendWhatsAppTemplate({
                to: phone,
                name: campaign.whatsapp.templateName,
                language: campaign.whatsapp.language || 'en',
                variables: campaign.whatsapp.variables || [],
            });
            done.push(`WhatsApp to ${phone}`);
        }
        res.json({ ok: true, sent: done });
    } catch (e) {
        res.status(502).json({ error: e.message, sent: done });
    }
});

/**
 * Freeze the audience into recipient rows and hand the campaign to the worker.
 *
 * The list is materialised here rather than resolved as it sends, so the record
 * of who it went to cannot drift, and a restart mid-send resumes instead of
 * starting over.
 */
router.post('/:id/send', async (req, res) => {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status !== 'draft') return res.status(409).json({ error: `This campaign is already ${campaign.status}` });

    const wantsEmail = campaign.channel === 'email' || campaign.channel === 'both';
    const wantsWhatsApp = campaign.channel === 'whatsapp' || campaign.channel === 'both';

    if (wantsEmail && !mailConfigured()) return res.status(501).json({ error: 'Email is not configured — connect Gmail in Settings' });
    if (wantsEmail && !String(campaign.emailSubject || '').trim()) return res.status(400).json({ error: 'The email needs a subject' });
    if (wantsWhatsApp && !whatsappSendConfigured()) return res.status(501).json({ error: 'WhatsApp is not configured' });
    if (wantsWhatsApp && !campaign.whatsapp?.templateName) {
        return res.status(400).json({ error: 'WhatsApp marketing must use a template Meta has approved' });
    }

    const { people } = await buildAudience(campaign.audience || {});

    const rows = [];
    for (const p of people) {
        if (wantsEmail && p.email) {
            rows.push({ campaign: campaign._id, kind: p.kind, refId: p.refId, name: p.name, channel: 'email', email: p.email });
        }
        if (wantsWhatsApp && p.phoneNormalized) {
            rows.push({ campaign: campaign._id, kind: p.kind, refId: p.refId, name: p.name, channel: 'whatsapp', phoneNormalized: p.phoneNormalized });
        }
    }
    if (!rows.length) return res.status(400).json({ error: 'Nobody in this audience can be reached on the chosen channel' });

    // ordered:false so one duplicate cannot abort the whole insert — the unique
    // index is there to stop double-sends, not to stop the campaign.
    await CampaignRecipient.insertMany(rows, { ordered: false }).catch(() => {});

    campaign.status = 'sending';
    campaign.startedAt = new Date();
    campaign.stats = { targeted: rows.length, sent: 0, failed: 0, skipped: 0 };
    campaign.lastError = '';
    await campaign.save();

    // Start immediately rather than waiting for the next tick.
    runCampaignTick().catch(() => {});

    res.json({ ok: true, targeted: rows.length, status: campaign.status });
});

router.post('/:id/cancel', async (req, res) => {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status !== 'sending') return res.status(409).json({ error: 'This campaign is not sending' });
    campaign.status = 'cancelled';
    campaign.finishedAt = new Date();
    await campaign.save();
    // Anything already sent stays sent; only the queue is abandoned.
    const left = await CampaignRecipient.updateMany(
        { campaign: campaign._id, status: 'pending' },
        { $set: { status: 'skipped', reason: 'Campaign cancelled' } },
    );
    res.json({ ok: true, cancelled: left.modifiedCount });
});

export default router;
