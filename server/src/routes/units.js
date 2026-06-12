import { Router } from 'express';
import { Unit, Contract } from '../models/index.js';

const router = Router();

router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.unitType) filter.unitType = req.query.unitType;
  const units = await Unit.find(filter).populate('unitType').sort({ unitNumber: 1 });
  res.json(units);
});

router.get('/:id', async (req, res) => {
  const unit = await Unit.findById(req.params.id).populate('unitType');
  if (!unit) return res.status(404).json({ error: 'Unit not found' });
  const contracts = await Contract.find({ unit: unit._id })
    .populate('customer')
    .sort({ createdAt: -1 })
    .limit(10);
  res.json({ unit, contracts });
});

router.post('/', async (req, res) => {
  const { unitNumber, unitType, status, notes } = req.body;
  const exists = await Unit.exists({ unitNumber });
  if (exists) return res.status(409).json({ error: `Unit ${unitNumber} already exists` });
  const unit = await Unit.create({ unitNumber, unitType, status, notes });
  res.status(201).json(await unit.populate('unitType'));
});

router.put('/:id', async (req, res) => {
  const unit = await Unit.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate('unitType');
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
