import { Router } from 'express';
import { Unit, Contract } from '../models/index.js';

const router = Router();

router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.floor) filter.floor = req.query.floor;
  if (req.query.minSize) filter.sizeSqf = { ...filter.sizeSqf, $gte: Number(req.query.minSize) };
  if (req.query.maxSize) filter.sizeSqf = { ...filter.sizeSqf, $lte: Number(req.query.maxSize) };
  const units = await Unit.find(filter).sort({ floor: 1, unitNumber: 1 });
  res.json(units);
});

router.get('/:id', async (req, res) => {
  const unit = await Unit.findById(req.params.id);
  if (!unit) return res.status(404).json({ error: 'Unit not found' });
  const contracts = await Contract.find({ unit: unit._id })
    .populate('customer')
    .sort({ createdAt: -1 })
    .limit(10);
  res.json({ unit, contracts });
});

router.post('/', async (req, res) => {
  const { unitNumber, floor, sizeSqf, price, lengthFt, widthFt, status, discountPct, notes } = req.body;
  const exists = await Unit.exists({ unitNumber });
  if (exists) return res.status(409).json({ error: `Unit ${unitNumber} already exists` });
  const unit = await Unit.create({ unitNumber, floor, sizeSqf, price, lengthFt, widthFt, status, discountPct, notes });
  res.status(201).json(unit);
});

router.put('/:id', async (req, res) => {
  const unit = await Unit.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!unit) return res.status(404).json({ error: 'Unit not found' });
  res.json(unit);
});

router.delete('/:id', async (req, res) => {
  const hasContracts = await Contract.exists({ unit: req.params.id, status: { $in: ['active', 'pending_signature', 'draft'] } });
  if (hasContracts) return res.status(409).json({ error: 'Unit has open contracts' });
  await Unit.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
