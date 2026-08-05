import { Router } from 'express';
import { FloorPlan, Contract } from '../models/index.js';

const router = Router();

// Who occupies each unit: map of unitNumber -> active contract summary
router.get('/occupancy', async (_req, res) => {
  const contracts = await Contract.find({ status: { $in: ['active', 'pending_signature'] }, archived: { $ne: true } })
    .populate('customer', 'fullName')
    .populate('unit', 'unitNumber')
    .populate('units', 'unitNumber')
    .select('contractNo customer unit units startDate endDate status');
  const map = {};
  for (const c of contracts) {
    const unitDocs = [...(c.units?.length ? c.units : []), ...(c.unit ? [c.unit] : [])];
    for (const u of unitDocs) {
      if (!u?.unitNumber) continue;
      map[u.unitNumber] = {
        contractId: c._id,
        contractNo: c.contractNo,
        customerName: c.customer?.fullName || '',
        startDate: c.startDate,
        endDate: c.endDate,
        status: c.status,
      };
    }
  }
  res.json(map);
});

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
