import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Unit } from '../models/index.js';
import { buildWebsitePricing } from '../services/websitePricing.js';

/**
 * The price list for the marketing website — no login, no token, by design.
 *
 * Read-only and carries nothing that is not already printed on the website:
 * sizes, prices, discounts and how many units are free. It never exposes unit
 * numbers, customers or contracts. The limit is per-IP because there is no
 * account to key it to.
 *
 *   GET /api/public/pricing
 *   GET /api/public/pricing?sizes=10,25,35      only these sizes
 */
const router = Router();

const limiter = rateLimit({
    windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests — please wait a minute and try again.' },
    skip: () => process.env.NODE_ENV === 'test',
});

router.get('/', limiter, async (req, res) => {
    const sizes = String(req.query.sizes || '')
        .split(',').map((s) => Number(s.trim())).filter((n) => n > 0);

    const units = await Unit.find({ sizeSqf: { $gt: 0 } }).select('sizeSqf price discountPct status').lean();

    // A minute of caching is plenty: prices change when somebody edits them in
    // Settings, and the website should not hit the database on every page view.
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
        currency: 'AED',
        period: '4 weeks',
        discountAppliesTo: 'the first 4 weeks; the standard price applies from the next cycle',
        updatedAt: new Date().toISOString(),
        sizes: buildWebsitePricing(units, { sizes }),
    });
});

export default router;
