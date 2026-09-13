import { Router } from 'express';
import { WhatsAppFlowTemplate } from '../models/index.js';
import { ensureDefaultFlowTemplate } from '../services/whatsappFlowTemplates.js';

const router = Router();

const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    next();
};

// GET /api/whatsapp-flow-templates
router.get('/', async (_req, res) => {
    try {
        await ensureDefaultFlowTemplate();
        const templates = await WhatsAppFlowTemplate.find().sort({ order: 1, createdAt: 1 });
        res.json(templates);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/whatsapp-flow-templates/:id
router.get('/:id', async (req, res) => {
    try {
        const template = await WhatsAppFlowTemplate.findById(req.params.id);
        if (!template) return res.status(404).json({ error: 'Template not found' });
        res.json(template);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/whatsapp-flow-templates — blank, or a copy of an existing
// template's steps/wording via cloneFrom, so "create new" never means
// starting from nothing.
router.post('/', requireAdmin, async (req, res) => {
    try {
        const name = String(req.body?.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Name is required' });

        let base = {};
        if (req.body?.cloneFrom) {
            const source = await WhatsAppFlowTemplate.findById(req.body.cloneFrom).lean();
            if (!source) return res.status(404).json({ error: 'Template to clone from was not found' });
            base = { steps: source.steps, handoffText: source.handoffText, completionText: source.completionText };
        }

        const maxOrder = await WhatsAppFlowTemplate.findOne().sort({ order: -1 }).select('order').lean();
        const template = await WhatsAppFlowTemplate.create({
            ...base,
            name,
            active: false, // never inherit "active" from a clone — two templates answering at once is exactly what this guards against
            custom: true,
            order: (maxOrder?.order ?? 0) + 1,
        });
        res.status(201).json(template);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/whatsapp-flow-templates/:id — whole-document field writes, same
// shape as AutomationRule's own PUT: the client sends the full mutated
// `steps` array on every step edit, there is no per-step endpoint.
router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const template = await WhatsAppFlowTemplate.findById(req.params.id);
        if (!template) return res.status(404).json({ error: 'Template not found' });

        const b = req.body || {};
        if (b.name !== undefined) {
            const name = String(b.name).trim();
            if (!name) return res.status(400).json({ error: 'Name is required' });
            template.name = name;
        }
        if (b.steps !== undefined) template.steps = b.steps;
        if (b.handoffText !== undefined) template.handoffText = String(b.handoffText);
        if (b.completionText !== undefined) template.completionText = String(b.completionText);

        await template.save();
        res.json(template);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/whatsapp-flow-templates/:id/activate — at most one template is
// ever active; activating this one deactivates every other.
router.post('/:id/activate', requireAdmin, async (req, res) => {
    try {
        const template = await WhatsAppFlowTemplate.findById(req.params.id);
        if (!template) return res.status(404).json({ error: 'Template not found' });
        await WhatsAppFlowTemplate.updateMany({ _id: { $ne: template._id } }, { $set: { active: false } });
        template.active = true;
        await template.save();
        res.json(template);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/whatsapp-flow-templates/:id/deactivate — turns the feature off
// without picking a different template to replace it.
router.post('/:id/deactivate', requireAdmin, async (req, res) => {
    try {
        const template = await WhatsAppFlowTemplate.findById(req.params.id);
        if (!template) return res.status(404).json({ error: 'Template not found' });
        template.active = false;
        await template.save();
        res.json(template);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/whatsapp-flow-templates/:id
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const template = await WhatsAppFlowTemplate.findById(req.params.id);
        if (!template) return res.status(404).json({ error: 'Template not found' });
        // A conversation already using this one keeps working (the thread
        // holds its own templateId), but starting a new one on it while
        // it's still active would be deleting the feature out from under
        // itself — same guard AutomationRule uses for its enabled rules.
        if (template.active) {
            return res.status(400).json({ error: 'Deactivate this template before deleting it' });
        }
        if ((await WhatsAppFlowTemplate.countDocuments()) <= 1) {
            return res.status(400).json({ error: 'This is the last template; deleting it would restore the built-in one on the next restart' });
        }
        await template.deleteOne();
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
