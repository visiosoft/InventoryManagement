import { Router } from 'express';
import { summariesPending } from '../services/conversationSummary.js';
import { isValidObjectId } from 'mongoose';
import { requireAdmin } from '../middleware/auth.js';
import { listWhatsAppTemplates } from '../services/whatsapp.js';
import { quietThreshold, sendQuietFollowUp } from '../services/leadFollowUp.js';
import {
    buildQueue, detailFor, summarise, eligibilityFor, quietStages, setQuietStages,
} from '../services/followUpQueue.js';

const router = Router();

// Reps and accounts see their own; admin sees everyone or one rep with
// ?owner=. Same rule as routes/leadFollowUp.js, enforced here rather than
// trusted from a query param.
function isSalesRep(req) {
    return req.user?.role === 'sales_rep' || req.user?.role === 'accounts';
}
function scopeOwner(req) {
    if (isSalesRep(req)) return req.user.id;
    return req.query.owner && isValidObjectId(req.query.owner) ? String(req.query.owner) : null;
}

/**
 * The approved template a send names, looked up against Meta's own current
 * list — the client's picker is a convenience, never trusted for what a
 * template actually requires. Returns null when it is not approved.
 */
async function resolveTemplate(templateName) {
    const name = String(templateName || '').trim();
    if (!name) return null;
    const known = await listWhatsAppTemplates().catch(() => ({ templates: [] }));
    const meta = (known.templates || []).find((t) => t.name === name && String(t.status).toUpperCase() === 'APPROVED');
    if (!meta) return null;
    return {
        name: meta.name,
        label: meta.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        language: meta.language,
        variableCount: meta.variableCount,
        bodyText: meta.bodyText || '',
    };
}

router.get('/config', async (_req, res) => {
    try {
        res.json({ quietFollowUpDays: await quietThreshold(), stages: await quietStages() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/config', requireAdmin, async (req, res) => {
    try {
        res.json({ quietFollowUpDays: await quietThreshold(), stages: await setQuietStages(req.body?.stages) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** The queue: every item, already ranked, plus the counts for the tiles. */
router.get('/', async (req, res) => {
    try {
        const now = new Date();
        const items = await buildQueue({ ownerId: scopeOwner(req), now });
        res.json({
            items,
            summary: summarise(items),
            threshold: await quietThreshold(),
            stages: await quietStages(),
            // Sent back on a send, so "they replied after this list was drawn"
            // can be caught server-side.
            snapshotAt: now,
            // Summaries still being written in the background; the page
            // refetches once when this is non-zero.
            aiPending: summariesPending(),
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Eligibility for a batch, with the rendered preview per person — the review
 * screen. Nothing is sent. The same check runs again at send time.
 */
router.post('/bulk/validate', async (req, res) => {
    try {
        const leadIds = (Array.isArray(req.body?.leadIds) ? req.body.leadIds : []).map(String).filter(isValidObjectId);
        if (!leadIds.length) return res.status(400).json({ error: 'No leads selected' });
        const template = await resolveTemplate(req.body?.templateName);
        const extraVars = Array.isArray(req.body?.extraVars) ? req.body.extraVars.map((v) => String(v ?? '')) : [];
        const rows = await eligibilityFor(leadIds, {
            template, extraVars,
            snapshotAt: req.body?.snapshotAt || null,
            confirmResend: Boolean(req.body?.confirmResend),
            allowCustomers: Boolean(req.body?.allowCustomers),
            ownerId: isSalesRep(req) ? req.user.id : null,
        });
        res.json({
            rows,
            eligible: rows.filter((r) => r.ok).length,
            excluded: rows.filter((r) => !r.ok).length,
            templateApproved: Boolean(template),
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Send to the eligible subset of a batch. Re-validates every lead here —
 * the review screen's verdict is never trusted — and never sends to one
 * that fails. Excluded rows come back with their reason.
 */
router.post('/bulk/send', async (req, res) => {
    try {
        const leadIds = (Array.isArray(req.body?.leadIds) ? req.body.leadIds : []).map(String).filter(isValidObjectId);
        if (!leadIds.length) return res.status(400).json({ error: 'No leads selected' });
        const template = await resolveTemplate(req.body?.templateName);
        if (!template) return res.status(404).json({ error: 'That template is not approved — refresh and pick another.' });
        const extraVars = Array.isArray(req.body?.extraVars) ? req.body.extraVars.map((v) => String(v ?? '')) : [];

        const rows = await eligibilityFor(leadIds, {
            template, extraVars,
            snapshotAt: req.body?.snapshotAt || null,
            confirmResend: Boolean(req.body?.confirmResend),
            allowCustomers: Boolean(req.body?.allowCustomers),
            ownerId: isSalesRep(req) ? req.user.id : null,
        });
        const eligible = rows.filter((r) => r.ok).map((r) => r.leadId);
        const excluded = rows.filter((r) => !r.ok).map((r) => ({ leadId: r.leadId, name: r.name, reason: r.reason, explanation: r.explanation }));

        const reasonsIn = Array.isArray(req.body?.reasons) ? req.body.reasons : [];
        const reasons = new Map(reasonsIn.map((r) => [String(r.leadId), { reason: r.reason || '', daysQuiet: r.daysWaiting ?? 0 }]));

        const out = eligible.length
            ? await sendQuietFollowUp({
                leadIds: eligible, template, extraVars, reasons,
                byUser: { id: req.user.id, name: req.user.name, email: req.user.email },
            })
            : { sent: [], failed: [] };
        res.json({ ...out, excluded });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** One lead, for the drawer. A rep can only open their own. */
router.get('/:leadId', async (req, res) => {
    try {
        if (!isValidObjectId(req.params.leadId)) return res.status(400).json({ error: 'Bad lead id' });
        const detail = await detailFor({ leadId: req.params.leadId, ownerId: isSalesRep(req) ? req.user.id : null });
        if (!detail) return res.status(404).json({ error: 'Lead not found' });
        res.json(detail);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Send one approved template to one lead, from the drawer.
 *
 * The guard is server-side and it is a refusal, not a warning: a closed
 * lead, a customer who replied since the queue was drawn, or a send inside
 * the last 12 hours (without an explicit confirmResend) comes back 409 with
 * the reason. Two clicks on Send produce one message.
 */
router.post('/:leadId/send', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        if (!isValidObjectId(leadId)) return res.status(400).json({ error: 'Bad lead id' });
        const template = await resolveTemplate(req.body?.templateName);
        if (!template) return res.status(404).json({ error: 'That template is not approved — refresh and pick another.' });
        const extraVars = Array.isArray(req.body?.extraVars) ? req.body.extraVars.map((v) => String(v ?? '')) : [];

        const [row] = await eligibilityFor([leadId], {
            template, extraVars,
            snapshotAt: req.body?.snapshotAt || null,
            confirmResend: Boolean(req.body?.confirmResend),
            allowCustomers: Boolean(req.body?.allowCustomers),
            ownerId: isSalesRep(req) ? req.user.id : null,
        });
        if (!row?.ok) {
            const status = row?.reason === 'not_found' ? 404 : 409;
            return res.status(status).json({ error: row?.explanation || 'Cannot send', reason: row?.reason || 'not_found' });
        }

        const reasons = new Map([[leadId, { reason: req.body?.reason || '', daysQuiet: req.body?.daysWaiting ?? 0 }]]);
        const out = await sendQuietFollowUp({
            leadIds: [leadId], template, extraVars, reasons,
            byUser: { id: req.user.id, name: req.user.name, email: req.user.email },
        });
        if (out.failed?.length) return res.status(502).json({ error: out.failed[0].reason, ...out });
        res.json(out);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
