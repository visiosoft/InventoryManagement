import { Router } from 'express';
import { ExitSurvey } from '../models/index.js';
import { sendExitSurvey, summarise, REASONS, COME_BACK } from '../services/exitSurvey.js';

/**
 * /api/exit-surveys — the move-out feedback collected by the EXIT_SURVEY
 * WhatsApp Flow. Answers arrive on the WhatsApp webhook, not here (see
 * services/exitSurvey.js); these endpoints send the survey and read results.
 */
const router = Router();

const dubaiDay = (s, endOfDay) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
    return new Date(`${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+04:00`);
};

// GET /api/exit-surveys?from=YYYY-MM-DD&to=YYYY-MM-DD&contract=<id>
// Rows newest first, plus totals for the same filter.
router.get('/', async (req, res) => {
    try {
        const q = {};
        const from = dubaiDay(req.query.from, false);
        const to = dubaiDay(req.query.to, true);
        if (from || to) q.submittedAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
        if (req.query.contract) q.contract = req.query.contract;

        const rows = await ExitSurvey.find(q)
            .sort({ submittedAt: -1 })
            .limit(Math.min(Number(req.query.limit) || 500, 2000))
            .populate('customer', 'fullName phone')
            .populate('contract', 'contractNo endDate')
            .populate('unit', 'unitNumber')
            .lean();

        res.json({
            summary: summarise(rows),
            rows: rows.map((r) => ({
                ...r,
                reasonLabel: REASONS[r.reason] || r.reason,
                comeBackLabel: COME_BACK[r.comeBack] || r.comeBack,
            })),
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/exit-surveys/send  { contractId }  or  { phone }
router.post('/send', async (req, res) => {
    try {
        const { contractId, phone } = req.body || {};
        if (!contractId && !phone) return res.status(400).json({ error: 'contractId or phone is required' });
        res.json(await sendExitSurvey({ contractId, phone }));
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
});

export default router;
