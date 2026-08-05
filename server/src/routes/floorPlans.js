import { Router } from 'express';
import { FloorPlan, Contract, Site } from '../models/index.js';

const router = Router();

// One plan per site; the default site keeps the legacy 'default' key
async function planKey(siteId) {
  if (!siteId) return 'default';
  const site = await Site.findById(siteId).select('isDefault').catch(() => null);
  return site?.isDefault ? 'default' : `site:${siteId}`;
}

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

// Get the saved floor plan for a site (?site=<id>, omit for the default site)
router.get('/', async (req, res) => {
  const key = await planKey(req.query.site);
  const plan = await FloorPlan.findOne({ key });
  if (!plan) return res.json({ doc: null, updatedAt: null, updatedBy: '' });
  res.json({ doc: plan.doc, updatedAt: plan.updatedAt, updatedBy: plan.updatedBy });
});

// Save (upsert) the floor plan — admins only
router.put('/', async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can save the floor plan' });
  }
  const { doc, site } = req.body || {};
  if (!doc || !Array.isArray(doc.floors)) {
    return res.status(400).json({ error: 'Invalid floor plan document' });
  }
  const key = await planKey(site);
  const plan = await FloorPlan.findOneAndUpdate(
    { key },
    { doc, updatedBy: req.user?.name || req.user?.email || '' },
    { new: true, upsert: true },
  );
  res.json({ ok: true, updatedAt: plan.updatedAt, updatedBy: plan.updatedBy });
});

export default router;
