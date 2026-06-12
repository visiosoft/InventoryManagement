import { Router } from 'express';
import { UnitType, Unit } from '../models/index.js';

const router = Router();

router.get('/', async (_req, res) => {
  const types = await UnitType.find().sort({ sizeSqf: 1 });
  res.json(types);
});

router.post('/', async (req, res) => {
  const { sizeSqf, label, weeklyRate, monthlyRate } = req.body;
  const type = await UnitType.create({ sizeSqf, label, weeklyRate, monthlyRate });
  res.status(201).json(type);
});

router.put('/:id', async (req, res) => {
  const type = await UnitType.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!type) return res.status(404).json({ error: 'Unit type not found' });
  res.json(type);
});

router.delete('/:id', async (req, res) => {
  const inUse = await Unit.exists({ unitType: req.params.id });
  if (inUse) return res.status(409).json({ error: 'Unit type is in use by existing units' });
  await UnitType.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
