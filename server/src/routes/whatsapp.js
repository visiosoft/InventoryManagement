import { Router } from 'express';
import { WhatsAppMessage } from '../models/index.js';

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
        {
            $group: {
                _id: '$phoneNormalized',
                lastAt: { $max: '$occurredAt' },
                count: { $sum: 1 },
                phone: { $first: '$phone' },
            },
        },
        { $sort: { lastAt: -1 } },
        { $limit: 200 },
    ]);

    res.json(rows.map((r) => ({
        phoneNormalized: r._id,
        phone: r.phone,
        count: r.count,
        lastAt: r.lastAt,
    })));
});

export default router;
