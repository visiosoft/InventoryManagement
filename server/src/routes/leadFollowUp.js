import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { Lead, LeadFollowUp, MessageTemplate } from '../models/index.js';
import { requireAdmin } from '../middleware/auth.js';
import {
    quietThreshold, setQuietThreshold, quietLeads, attachReasons, attachLastNudge,
    quietSummary, sendQuietFollowUp,
} from '../services/leadFollowUp.js';

const router = Router();

// Sales reps and accounts only ever see their own — same rule leads.js
// enforces, kept server-side so it cannot be widened via a query param.
function isSalesRep(req) {
    return req.user?.role === 'sales_rep' || req.user?.role === 'accounts';
}

router.get('/config', async (req, res) => {
    res.json({ quietFollowUpDays: await quietThreshold() });
});

router.put('/config', requireAdmin, async (req, res) => {
    res.json({ quietFollowUpDays: await setQuietThreshold(req.body?.quietFollowUpDays) });
});

/**
 * The list itself. A rep gets their own; admin gets everyone's, or one rep's
 * with ?owner=, and can widen the window past their own default with ?days=.
 * Reasons and the last-nudge warning are attached in the same call — the
 * whole point is a rep or admin sees enough to decide without opening each
 * chat first.
 */
router.get('/quiet', async (req, res) => {
    try {
        const ownerId = isSalesRep(req)
            ? req.user.id
            : (req.query.owner && isValidObjectId(req.query.owner) ? req.query.owner : null);
        const days = req.query.days ? Number(req.query.days) : null;

        let leads = await quietLeads({ ownerId, days });
        leads = await attachReasons(leads);
        leads = await attachLastNudge(leads);
        res.json({ leads, threshold: days || await quietThreshold() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** Counts for the dashboard card and chart — a rep's own total, or, for
 *  admin, everyone's broken down by owner too. */
router.get('/summary', async (req, res) => {
    try {
        const ownerId = isSalesRep(req)
            ? req.user.id
            : (req.query.owner && isValidObjectId(req.query.owner) ? req.query.owner : null);
        res.json(await quietSummary({ ownerId }));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Send an approved template to a batch of quiet leads.
 *
 * A rep may only send to their own; admin may send to anyone's — the same
 * split as viewing them. The reason shown for each lead when the client asked
 * for the list is sent back here so it can be frozen onto the log record
 * without a second AI call.
 */
router.post('/send', async (req, res) => {
    try {
        const leadIds = (Array.isArray(req.body?.leadIds) ? req.body.leadIds : []).filter(isValidObjectId);
        if (!leadIds.length) return res.status(400).json({ error: 'No leads selected' });

        const templateId = req.body?.templateId;
        if (!templateId || !isValidObjectId(templateId)) return res.status(400).json({ error: 'Choose a template' });
        const template = await MessageTemplate.findById(templateId).lean();

        // What the client already knows about each lead — reason and days
        // quiet — passed back rather than recomputed, so a send is not a
        // second round of AI calls on top of the one that built the list.
        const reasonsIn = Array.isArray(req.body?.reasons) ? req.body.reasons : [];
        const reasons = new Map(reasonsIn.map((r) => [String(r.leadId), { reason: r.reason || '', daysQuiet: r.daysQuiet ?? 0 }]));

        if (isSalesRep(req)) {
            // Server-side, not trusted from the client: a rep can only ever
            // send to leads that are actually theirs.
            const owned = await Lead.find({ _id: { $in: leadIds }, owner: req.user.id }).select('_id').lean();
            const ownedIds = new Set(owned.map((l) => String(l._id)));
            const notOwned = leadIds.filter((id) => !ownedIds.has(id));
            if (notOwned.length) return res.status(403).json({ error: 'Some of those leads are not yours' });
        }

        const out = await sendQuietFollowUp({
            leadIds, template, reasons,
            byUser: { id: req.user.id, name: req.user.name, email: req.user.email },
        });
        res.json(out);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** The report: sent / replied / still quiet. Admin sees everyone, optionally
 *  filtered to one rep; a rep sees only their own sends. */
router.get('/log', async (req, res) => {
    try {
        const filter = {};
        if (isSalesRep(req)) filter.sentBy = req.user.id;
        else if (req.query.owner && isValidObjectId(req.query.owner)) filter.sentBy = req.query.owner;

        const rows = await LeadFollowUp.find(filter)
            .sort({ sentAt: -1 })
            .limit(200)
            .populate('lead', 'fullName phone phoneNormalized')
            .lean();

        const sent = rows.filter((r) => r.status === 'sent').length;
        const replied = rows.filter((r) => r.status === 'sent' && r.repliedAt).length;
        const stillQuiet = sent - replied;

        res.json({
            counts: { sent, replied, stillQuiet, failed: rows.filter((r) => r.status === 'failed').length },
            rows: rows.map((r) => ({
                id: String(r._id),
                leadId: r.lead?._id ? String(r.lead._id) : null,
                leadName: r.lead?.fullName || '',
                phone: r.lead?.phone || r.phoneNormalized,
                sentByName: r.sentByName,
                templateLabel: r.templateLabel,
                reason: r.reason,
                daysQuietAtSend: r.daysQuietAtSend,
                status: r.status,
                error: r.error,
                sentAt: r.sentAt,
                repliedAt: r.repliedAt,
            })),
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
