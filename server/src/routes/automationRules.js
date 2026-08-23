import { Router } from 'express';
import { AutomationRule, AutomationLog } from '../models/index.js';
import { runAutomationRules, getAutoSend, setAutoSend } from '../services/automationEngine.js';
import { whatsappSendConfigured } from '../services/whatsapp.js';
import { mailConfigured } from '../services/mail.js';

const router = Router();

const DEFAULT_RULES = [
    {
        name: 'Payment Due Reminder',
        icon: 'credit-card',
        triggerEvent: 'payment_due',
        triggerLabel: 'Triggered before / after a payment due date',
        relativeLabel: 'due date',
        enabled: false,
        emailEnabled: false,
        whatsappEnabled: true,
        steps: [
            { value: 7, direction: 'before', template: 'Friendly Reminder' },
            { value: 3, direction: 'before', template: 'Payment Reminder' },
        ],
        recurring: { enabled: true, everyDays: 3 },
        custom: false,
        order: 0,
    },
    {
        name: 'Contract Expiry',
        icon: 'calendar-clock',
        triggerEvent: 'contract_expiry',
        triggerLabel: 'Triggered before a contract end date',
        relativeLabel: 'expiry date',
        enabled: false,
        emailEnabled: false,
        whatsappEnabled: true,
        steps: [
            { value: 30, direction: 'before', template: 'Renewal Reminder' },
            { value: 7, direction: 'before', template: 'Expiry Warning' },
        ],
        recurring: { enabled: false, everyDays: 7 },
        custom: false,
        order: 1,
    },
    {
        name: 'Overdue Payment',
        icon: 'alert-triangle',
        triggerEvent: 'payment_overdue',
        triggerLabel: 'Triggered after a payment becomes overdue',
        relativeLabel: 'due date',
        enabled: false,
        emailEnabled: false,
        whatsappEnabled: true,
        steps: [
            { value: 0, direction: 'after', template: 'Overdue Notice', immediate: true },
            { value: 3, direction: 'after', template: 'Urgent Reminder' },
            { value: 7, direction: 'after', template: 'Final Notice' },
        ],
        recurring: { enabled: true, everyDays: 5 },
        custom: false,
        order: 2,
    },
];

async function ensureDefaults() {
    const count = await AutomationRule.countDocuments();
    if (count === 0) await AutomationRule.insertMany(DEFAULT_RULES);
}

// GET /api/automation-rules
router.get('/', async (_req, res) => {
    try {
        await ensureDefaults();
        const rules = await AutomationRule.find().sort({ order: 1, createdAt: 1 }).lean();
        res.json(rules);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/automation-rules/:id
router.put('/:id', async (req, res) => {
    try {
        const rule = await AutomationRule.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!rule) return res.status(404).json({ error: 'Rule not found' });
        res.json(rule);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/automation-rules
router.post('/', async (req, res) => {
    try {
        const maxOrder = await AutomationRule.findOne().sort({ order: -1 }).select('order').lean();
        const rule = await AutomationRule.create({
            ...req.body,
            custom: true,
            order: (maxOrder?.order ?? 0) + 1,
        });
        res.status(201).json(rule);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/automation-rules/:id
router.delete('/:id', async (req, res) => {
    try {
        const rule = await AutomationRule.findById(req.params.id);
        if (!rule) return res.status(404).json({ error: 'Rule not found' });
        if (!rule.custom) return res.status(400).json({ error: 'Cannot delete built-in rules' });
        await rule.deleteOne();
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/automation-rules/logs
router.get('/logs', async (req, res) => {
    try {
        const { search, limit = 50, skip = 0 } = req.query;
        const filter = {};
        const logs = await AutomationLog.find(filter)
            .sort({ sentAt: -1 })
            .skip(Number(skip))
            .limit(Number(limit))
            .populate('customer', 'fullName')
            .lean();

        const filtered = search
            ? logs.filter(l => {
                const s = String(search).toLowerCase();
                const name = typeof l.customer === 'object' ? l.customer?.fullName : '';
                return (name || '').toLowerCase().includes(s)
                    || (l.unit || '').toLowerCase().includes(s)
                    || (l.event || '').toLowerCase().includes(s);
            })
            : logs;

        res.json({ logs: filtered, total: filtered.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/automation-rules/channels — delivery channels + auto-send state
router.get('/channels', async (_req, res) => {
    try {
        res.json({ whatsapp: whatsappSendConfigured(), email: mailConfigured(), autoSend: await getAutoSend() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/automation-rules/auto-send — master switch for the 6-hour scheduler
router.put('/auto-send', async (req, res) => {
    try {
        const value = await setAutoSend(!!req.body?.enabled);
        res.json({ ok: true, autoSend: value });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/automation-rules/run — run the engine now; ?dry=1 previews without sending.
//
// A real run messages every tenant its rules match — 127 active contracts at the
// time of writing — so the preview flag is read generously. It used to accept
// only `dry`, which meant a caller asking for `dryRun` got a live send instead,
// silently. The aliases below cost nothing and remove that trap.
const PREVIEW_KEYS = ['dry', 'dryRun', 'dry_run', 'preview'];

router.post('/run', async (req, res) => {
    try {
        const asked = (v) => v === true || v === '1' || v === 'true';
        const dryRun = PREVIEW_KEYS.some((k) => asked(req.query?.[k]) || asked(req.body?.[k]));
        const result = await runAutomationRules({ dryRun });
        res.json({
            ok: true,
            dryRun,
            // Stated outright, because "did that actually send?" is the first
            // thing anyone asks when they see the numbers.
            note: dryRun ? 'Preview only — nothing was sent' : 'Live run — messages were sent',
            ...result,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
