import { Router } from 'express';
import { Site, Unit } from '../models/index.js';

const router = Router();

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
};

// List sites with occupancy stats. Auto-creates the default site on first use.
router.get('/', async (_req, res) => {
  let sites = await Site.find().sort({ createdAt: 1 });
  if (sites.length === 0) {
    const def = await Site.create({ name: 'Al Quoz Facility', code: 'ALQ', address: 'Al Quoz, Dubai', isDefault: true });
    sites = [def];
  }
  const units = await Unit.find().select('site status');
  const defaultId = String((sites.find((s) => s.isDefault) ?? sites[0])._id);
  const stats = {};
  for (const s of sites) stats[String(s._id)] = { total: 0, occupied: 0, reserved: 0, available: 0, maintenance: 0 };
  for (const u of units) {
    const sid = u.site ? String(u.site) : defaultId;
    const st = stats[sid];
    if (!st) continue;
    st.total += 1;
    if (st[u.status] !== undefined) st[u.status] += 1;
  }
  res.json(sites.map((s) => ({ ...s.toObject(), stats: stats[String(s._id)] })));
});

router.post('/', requireAdmin, async (req, res) => {
  const { name, code = '', address = '', hidden = false } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Site name is required' });
  const site = await Site.create({ name: name.trim(), code, address, hidden });
  res.status(201).json(site);
});

router.put('/:id', requireAdmin, async (req, res) => {
  const { name, code, address, hidden } = req.body || {};
  const site = await Site.findByIdAndUpdate(
    req.params.id,
    { ...(name !== undefined && { name }), ...(code !== undefined && { code }), ...(address !== undefined && { address }), ...(hidden !== undefined && { hidden }) },
    { new: true },
  );
  if (!site) return res.status(404).json({ error: 'Site not found' });
  res.json(site);
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const site = await Site.findById(req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  if (site.isDefault) return res.status(409).json({ error: 'The default site cannot be deleted' });
  const hasUnits = await Unit.exists({ site: site._id });
  if (hasUnits) return res.status(409).json({ error: 'Site has units assigned — move or delete them first' });
  await site.deleteOne();
  res.json({ ok: true });
});

export default router;
