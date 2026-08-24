import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { SentEmail, Customer } from '../models/index.js';

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
        const or = [{ to: re }, { bcc: re }, { subject: re }, { label: re }, { sentBy: re }];

        // The customer is a reference, so their name is not on the row to match
        // against. Resolve the ids first, which is what makes "find everything
        // we sent this person" work at all.
        const named = await Customer.find({ fullName: re }).select('_id').limit(500).lean();
        if (named.length) or.push({ customer: { $in: named.map((c) => c._id) } });

        filter.$or = or;
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 500);

    const [rows, total, failed] = await Promise.all([
        SentEmail.find(filter)
            // Bodies are excluded here: fifty of them would make the list
            // payload megabytes for content nobody has asked to read yet.
            .select('-html -text')
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

// One email in full, fetched when a row is opened.
router.get('/:id', async (req, res) => {
    const row = await SentEmail.findById(req.params.id)
        .populate('customer', 'fullName email')
        .populate('contract', 'contractNo')
        .lean();
    if (!row) return res.status(404).json({ error: 'Email not found' });
    res.json(row);
});

export default router;
