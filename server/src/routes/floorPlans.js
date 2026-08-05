import { Router } from 'express';
import { FloorPlan } from '../models/index.js';

const router = Router();

// Get the saved floor plan (single shared document)
router.get('/', async (_req, res) => {
  const plan = await FloorPlan.findOne({ key: 'default' });
  if (!plan) return res.json({ doc: null, updatedAt: null, updatedBy: '' });
  res.json({ doc: plan.doc, updatedAt: plan.updatedAt, updatedBy: plan.updatedBy });
});

// Save (upsert) the floor plan
router.put('/', async (req, res) => {
  const { doc } = req.body || {};
  if (!doc || !Array.isArray(doc.floors)) {
    return res.status(400).json({ error: 'Invalid floor plan document' });
  }
  const plan = await FloorPlan.findOneAndUpdate(
    { key: 'default' },
    { doc, updatedBy: req.user?.name || req.user?.email || '' },
    { new: true, upsert: true },
  );
  res.json({ ok: true, updatedAt: plan.updatedAt, updatedBy: plan.updatedBy });
});

export default router;
