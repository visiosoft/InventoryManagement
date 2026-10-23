import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { CallLog, Lead } from '../models/index.js';
import { ingestCalls, summariseCalls } from '../services/callLog.js';
import { displayNameFor } from '../services/leadNames.js';

/*
 * Calls from the reps' phones (the staff app syncs Android's call log here),
 * and what the team's calling looks like: per rep, per day, and the latest
 * calls. A rep sees their own; an admin sees everyone.
 */
const router = Router();
const isAdmin = (req) => ['admin', 'accounts_admin'].includes(req.user?.role);

/** The staff app sends the calls made or taken since its last sync. */
router.post('/sync', async (req, res) => {
    try {
        const calls = Array.isArray(req.body?.calls) ? req.body.calls : [];
        res.json(await ingestCalls(req.user.id, calls));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** Per rep and per day over the last `days`, plus the most recent calls. */
router.get('/summary', async (req, res) => {
    try {
        const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
        const since = new Date(Date.now() - days * 86400000);
        const filter = { startedAt: { $gte: since } };
        if (!isAdmin(req)) filter.user = req.user.id;
        else if (req.query.user && isValidObjectId(req.query.user)) filter.user = req.query.user;
        const rows = await CallLog.find(filter).sort({ startedAt: -1 }).limit(5000)
            .populate('user', 'name').populate('lead', 'fullName phone whatsappProfileName').lean();
        const dayKey = (d) => new Date(new Date(d).getTime() + 4 * 3600000).toISOString().slice(0, 10);
        const byDay = new Map();
        for (const r of rows) {
            const k = dayKey(r.startedAt);
            const t = byDay.get(k) || { date: k, made: 0, answered: 0, talkSec: 0 };
            if (r.direction === 'outgoing') { t.made += 1; if (r.durationSec >= 10) t.answered += 1; }
            t.talkSec += r.durationSec || 0;
            byDay.set(k, t);
        }
        res.json({
            days,
            reps: summariseCalls(rows),
            byDay: [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
            recent: rows.slice(0, 50).map((r) => ({
                _id: String(r._id), at: r.startedAt, direction: r.direction, durationSec: r.durationSec, note: r.note,
                rep: r.user?.name || '', leadId: r.lead?._id ? String(r.lead._id) : null,
                name: r.lead ? displayNameFor(r.lead) : r.isCustomer ? 'Customer' : '', phone: r.phoneNormalized,
            })),
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** A note on a call ("wants 50 sq ft from November"), copied to the lead. */
router.patch('/:id/note', async (req, res) => {
    try {
        const call = await CallLog.findById(req.params.id);
        if (!call) return res.status(404).json({ error: 'Call not found' });
        if (!isAdmin(req) && String(call.user) !== String(req.user.id)) return res.status(403).json({ error: 'Not your call' });
        const note = String(req.body?.note || '').trim().slice(0, 1000);
        call.note = note;
        await call.save();
        if (note && call.lead) {
            await Lead.updateOne({ _id: call.lead }, { $push: { timeline: { type: 'note', text: `After the call: ${note}`, user: req.user.id, at: new Date() } } });
        }
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
