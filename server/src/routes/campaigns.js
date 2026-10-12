import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { Campaign, CampaignRecipient, Customer, Lead, WhatsAppMessage } from '../models/index.js';
import { softDelete, softDeleteMany } from '../utils/softDelete.js';
import { buildAudience } from '../services/campaignAudience.js';
import { mailConfigured, sendMail } from '../services/mail.js';
import { listWhatsAppTemplates, sendWhatsAppTemplate, whatsappSendConfigured } from '../services/whatsapp.js';
import { runCampaignTick, fillVariables } from '../services/campaignSender.js';
import { campaignFunnel, allFunnels, segmentFilter, SEGMENT_LABELS } from '../services/campaignStats.js';
import { customerContactKeys } from '../services/customerLeads.js';
import { digitTail } from '../services/leadRouting.js';

const router = Router();

// Marketing goes to people who are not expecting it, so it stays admin-only.
router.use(requireAdmin);

// What can be sent at all, so the composer can say why a channel is unavailable
// rather than failing at send time.
router.get('/channels', async (req, res) => {
    const templates = await listWhatsAppTemplates({ force: req.query.refresh === '1' }).catch((e) => ({ configured: false, error: e.message, templates: [] }));
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

/**
 * Record a WhatsApp marketing opt-in for everyone who has written to us.
 *
 * Meta requires an opt-in before a MARKETING template may be sent, and nobody
 * has one, so the WhatsApp audience is empty until this is run. Someone who
 * messaged the business first is a defensible basis for that consent — but it
 * is a judgement about your customers, so it is an explicit action taken once,
 * not a default buried in a query.
 */
router.post('/opt-in/backfill', async (req, res) => {
    const dryRun = req.body?.dry === true || req.query.dry === '1';

    const numbers = await WhatsAppMessage.distinct('phoneNormalized', { direction: 'inbound' });
    const wrote = new Set(numbers.map((n) => String(n || '').slice(-9)).filter((n) => n.length === 9));
    if (!wrote.size) return res.json({ ok: true, dryRun, customers: 0, leads: 0 });

    // Matched in code rather than in the query: numbers are stored in several
    // formats, so identity is the last nine digits — the same rule the inbox and
    // the Zoho matcher use, and not something a Mongo filter expresses well.
    const key = (v) => {
        const d = String(v || '').replace(/\D/g, '');
        return d.length >= 9 ? d.slice(-9) : '';
    };

    const customers = await Customer.find({ 'whatsappOptIn.at': null }).select('phone phones').lean();
    const customerIds = customers
        .filter((c) => [...(c.phones || []), c.phone].map(key).some((k) => k && wrote.has(k)))
        .map((c) => c._id);

    const leads = await Lead.find({ 'whatsappOptIn.at': null }).select('phone whatsappNo phoneNormalized').lean();
    const leadIds = leads
        .filter((l) => [l.phoneNormalized, l.phone, l.whatsappNo].map(key).some((k) => k && wrote.has(k)))
        .map((l) => l._id);

    if (dryRun) {
        return res.json({
            ok: true, dryRun: true,
            customers: customerIds.length, leads: leadIds.length,
            note: 'Preview only — nothing was changed',
        });
    }

    const set = { $set: { whatsappOptIn: { at: new Date(), source: 'inbound_message' } } };
    const [c, l] = await Promise.all([
        Customer.updateMany({ _id: { $in: customerIds } }, set),
        Lead.updateMany({ _id: { $in: leadIds } }, set),
    ]);
    res.json({ ok: true, dryRun: false, customers: c.modifiedCount, leads: l.modifiedCount });
});

router.get('/', async (_req, res) => {
    const campaigns = await Campaign.find().sort({ createdAt: -1 }).limit(100).lean();
    res.json(campaigns);
});


/* ── Campaign Studio ─────────────────────────────────────────────────────── */

const escRe = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The leads a person can pick for a campaign, with the filters the studio offers. */
async function peopleFilter(q) {
    const filter = { deletedAt: null, unsubscribed: { $ne: true } };
    if (q.stage) filter.status = String(q.stage);
    const day = (v, end) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? new Date(`${v}T${end ? '23:59:59.999' : '00:00:00.000'}+04:00`) : null);
    const from = day(q.from, false);
    const to = day(q.to, true);
    if (from || to) { filter.leadDateTime = {}; if (from) filter.leadDateTime.$gte = from; if (to) filter.leadDateTime.$lte = to; }
    if (q.hasEmail === '1') filter.email = { $nin: ['', null] };
    if (q.optIn === '1') filter['whatsappOptIn.at'] = { $ne: null };
    if (q.search) {
        const re = new RegExp(escRe(String(q.search).trim()), 'i');
        filter.$or = [{ fullName: re }, { whatsappProfileName: re }, { email: re }, { phone: re }, { phoneNormalized: re }];
    }
    return filter;
}

async function withoutCustomers(rows, exclude) {
    if (!exclude) return rows;
    const keys = await customerContactKeys();
    return rows.filter((l) => {
        const t = digitTail(l.phoneNormalized || l.phone);
        const e = String(l.email || '').trim().toLowerCase();
        return !((t && keys.tails.has(t)) || (e && keys.emails.has(e)));
    });
}

const SORTS = { newest: { leadDateTime: -1 }, oldest: { leadDateTime: 1 }, name: { fullName: 1 } };

router.get('/people', async (req, res) => {
    try {
        const filter = await peopleFilter(req.query);
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
        const exclude = req.query.excludeCustomers !== '0';
        const sort = SORTS[req.query.sort] || SORTS.newest;

        // Customers are filtered after the query (they are matched on the last
        // nine digits), so the page is built from a wider read and then trimmed.
        const all = await Lead.find(filter)
            .select('fullName whatsappProfileName email phone phoneNormalized status source leadDateTime whatsappOptIn')
            .sort(sort).limit(8000).lean();
        const kept = await withoutCustomers(all, exclude);
        const total = kept.length;
        const slice = kept.slice((page - 1) * limit, page * limit);

        // The last campaign each of them was in, so nobody is messaged blindly twice.
        const ids = slice.map((l) => l._id);
        const last = ids.length ? await CampaignRecipient.aggregate([
            { $match: { refId: { $in: ids }, channel: 'whatsapp', status: 'sent' } },
            { $sort: { sentAt: -1 } },
            { $group: { _id: '$refId', at: { $first: '$sentAt' }, campaign: { $first: '$campaign' }, readAt: { $first: '$readAt' }, repliedAt: { $first: '$repliedAt' } } },
        ]) : [];
        const lastBy = new Map(last.map((r) => [String(r._id), r]));
        const names = last.length ? new Map((await Campaign.find({ _id: { $in: last.map((r) => r.campaign) } }).select('name').lean()).map((c) => [String(c._id), c.name])) : new Map();

        res.json({
            total, page, pages: Math.max(1, Math.ceil(total / limit)),
            rows: slice.map((l) => {
                const lc = lastBy.get(String(l._id));
                const nm = l.fullName || '';
                return {
                    id: String(l._id),
                    name: /^whatsapp\s*contact/i.test(nm) ? (l.whatsappProfileName || '') : nm,
                    phone: l.phoneNormalized ? `+${l.phoneNormalized}` : (l.phone || ''),
                    email: l.email || '',
                    stage: l.status,
                    source: l.source || '',
                    leadDate: l.leadDateTime,
                    optIn: Boolean(l.whatsappOptIn?.at),
                    lastCampaign: lc ? { name: names.get(String(lc.campaign)) || '', at: lc.at, read: Boolean(lc.readAt), replied: Boolean(lc.repliedAt) } : null,
                };
            }),
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** Every id matching the filters, for "select all N". */
router.get('/people/ids', async (req, res) => {
    try {
        const filter = await peopleFilter(req.query);
        const all = await Lead.find(filter).select('email phone phoneNormalized').limit(8000).lean();
        const kept = await withoutCustomers(all, req.query.excludeCustomers !== '0');
        res.json({ ids: kept.map((l) => String(l._id)) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** Every campaign with its funnel, for the reports list. */
router.get('/reports', async (_req, res) => {
    const [campaigns, funnels] = await Promise.all([
        Campaign.find({}).sort({ createdAt: -1 }).limit(200).lean(),
        allFunnels(),
    ]);
    res.json(campaigns.map((c) => ({
        _id: c._id, name: c.name, status: c.status, createdAt: c.createdAt, startedAt: c.startedAt, createdByName: c.createdByName,
        template: c.whatsapp?.templateName || '', headerImageUrl: c.whatsapp?.headerImageUrl || '',
        funnel: funnels.get(String(c._id)) || { targeted: c.stats?.targeted || 0, sent: c.stats?.sent || 0, delivered: 0, read: 0, replied: 0, failed: c.stats?.failed || 0 },
    })));
});

router.get('/:id/report', async (req, res) => {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const [funnel, recipients, reasons] = await Promise.all([
        campaignFunnel(campaign._id),
        CampaignRecipient.find({ campaign: campaign._id, channel: 'whatsapp' }).sort({ sentAt: -1, name: 1 }).limit(2000).lean(),
        CampaignRecipient.aggregate([
            { $match: { campaign: campaign._id, status: 'failed' } },
            { $group: { _id: '$reason', n: { $sum: 1 } } }, { $sort: { n: -1 } },
        ]),
    ]);
    res.json({
        campaign: { _id: campaign._id, name: campaign.name, status: campaign.status, startedAt: campaign.startedAt, finishedAt: campaign.finishedAt, createdByName: campaign.createdByName, whatsapp: campaign.whatsapp, audience: campaign.audience },
        funnel,
        failureReasons: reasons.map((r) => ({ reason: r._id || 'Unknown', count: r.n })),
        segments: SEGMENT_LABELS,
        recipients: recipients.map((r) => ({
            id: String(r._id), refId: String(r.refId), name: r.name, phone: r.phoneNormalized ? `+${r.phoneNormalized}` : '',
            status: r.status, reason: r.reason, sentAt: r.sentAt, deliveredAt: r.deliveredAt, readAt: r.readAt, repliedAt: r.repliedAt,
        })),
    });
});

/** A follow-up campaign for part of an earlier one — the retargeting step. */
router.post('/:id/retarget', async (req, res) => {
    const original = await Campaign.findById(req.params.id);
    if (!original) return res.status(404).json({ error: 'Campaign not found' });
    const segment = String(req.body?.segment || '');
    const filter = segmentFilter(original._id, segment);
    if (!filter) return res.status(400).json({ error: 'Unknown group' });
    const rows = await CampaignRecipient.find({ ...filter, kind: 'lead' }).select('refId').lean();
    if (!rows.length) return res.status(400).json({ error: `Nobody is in "${SEGMENT_LABELS[segment]}" yet` });

    const campaign = await Campaign.create({
        name: String(req.body?.name || '').trim() || `${original.name} — ${SEGMENT_LABELS[segment].toLowerCase()}`,
        channel: 'whatsapp',
        audience: { tenants: false, pastTenants: false, leads: true, leadIds: rows.map((r) => r.refId), excludeCustomers: false, minDaysBetween: 1 },
        whatsapp: { templateName: '', language: 'en', variables: [], headerImageUrl: '' },
        status: 'draft',
        createdBy: req.user.id,
        createdByName: req.user.name || req.user.email || '',
    });
    res.status(201).json({ _id: campaign._id, people: rows.length });
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
    await softDeleteMany(CampaignRecipient, { campaign: campaign._id }, req.user.id);
    await softDelete(campaign, req.user.id);
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
                variables: fillVariables(campaign.whatsapp.variables || [], String(req.body?.name || 'Test')),
                headerImageUrl: campaign.whatsapp.headerImageUrl || undefined,
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
    if (wantsWhatsApp) {
        const list = await listWhatsAppTemplates().catch(() => ({ templates: [] }));
        const tpl = (list.templates || []).find((t) => t.name === campaign.whatsapp.templateName && t.status === 'APPROVED');
        if (!tpl) return res.status(400).json({ error: 'That template is not approved by Meta (or no longer exists)' });
        if (tpl.headerFormat === 'IMAGE' && !/^https:\/\//i.test(campaign.whatsapp.headerImageUrl || '')) {
            return res.status(400).json({ error: 'This template has an image header — add a public https link to the image' });
        }
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
