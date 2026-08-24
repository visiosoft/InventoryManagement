import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { SentEmail } from '../models/index.js';

/**
 * Everything the system has emailed, from the one log sendMail() writes.
 *
 * Deliberately a single list rather than a view over the three partial
 * histories that existed before — automation logs, campaign recipients and a
 * per-customer array — none of which covered transactional mail like a contract
 * PDF. "Did we email them?" now has one place to look.
 */
const router = Router();

router.use(requireAdmin);

const escRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get('/', async (req, res) => {
    const filter = {};

    if (req.query.status === 'sent' || req.query.status === 'failed') filter.status = req.query.status;
    if (req.query.kind) filter.kind = String(req.query.kind);

    if (req.query.search) {
        const re = new RegExp(escRegex(req.query.search), 'i');
        // Searched in the query, not after paging — filtering a fetched page
        // makes anything older than that page unfindable.
        filter.$or = [{ to: re }, { bcc: re }, { subject: re }, { label: re }, { sentBy: re }];
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 500);

    const [rows, total, failed] = await Promise.all([
        SentEmail.find(filter)
            .sort({ at: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .populate('customer', 'fullName')
            .populate('contract', 'contractNo')
            .lean(),
        SentEmail.countDocuments(filter),
        SentEmail.countDocuments({ ...filter, status: 'failed' }),
    ]);

    // The kinds actually present, so the filter offers real options rather than
    // a hardcoded list that drifts from what is in the data.
    const kinds = await SentEmail.distinct('kind');

    res.json({ data: rows, total, failed, page, pages: Math.ceil(total / limit), limit, kinds: kinds.sort() });
});

export default router;
