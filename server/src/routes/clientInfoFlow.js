import { Router } from 'express';
import { ClientInfoSubmission, Lead } from '../models/index.js';
import { sendClientInfoFlow } from '../services/clientInfoFlow.js';

/** /api/client-info — send the client-details WhatsApp Flow. The answers come
 *  back to the flow endpoint, POST /api/whatsapp/flow. */
const router = Router();

// POST /api/client-info/send  { phone, name? }
router.post('/send', async (req, res) => {
    try {
        res.json(await sendClientInfoFlow({ phone: req.body?.phone, name: req.body?.name }));
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
});

// GET /api/client-info/submissions?customer=<id>&days=14&mine=1&limit=20
// What came in through the WhatsApp ID form, newest first, with whether the
// photos reached Google Drive. mine=1: only numbers whose lead this user owns.
router.get('/submissions', async (req, res) => {
    try {
        const q = {};
        if (req.query.customer) q.customer = req.query.customer;
        const days = Number(req.query.days);
        if (days > 0) q.createdAt = { $gte: new Date(Date.now() - days * 864e5) };
        if (req.query.mine === '1') {
            const phones = await Lead.find({ owner: req.user.id }).distinct('phoneNormalized');
            q.phoneNormalized = { $in: phones };
        }
        const rows = await ClientInfoSubmission.find(q)
            .sort({ createdAt: -1 })
            .limit(Math.min(Number(req.query.limit) || 20, 200))
            .populate('customer', 'fullName phone')
            .lean();
        const counts = rows.reduce((acc, r) => {
            acc[r.status] = (acc[r.status] || 0) + 1;
            if ((r.status === 'failed' || r.status === 'partial') && !r.resolvedAt) acc.needsAction += 1;
            return acc;
        }, { saved: 0, partial: 0, failed: 0, processing: 0, needsAction: 0 });
        res.json({ counts, rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/client-info/submissions/:id/resolve — a failure has been dealt with.
router.post('/submissions/:id/resolve', async (req, res) => {
    try {
        const r = await ClientInfoSubmission.findByIdAndUpdate(
            req.params.id,
            { $set: { resolvedAt: new Date(), resolvedBy: req.user?.name || req.user?.email || '' } },
            { new: true },
        );
        if (!r) return res.status(404).json({ error: 'Not found' });
        res.json(r);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
