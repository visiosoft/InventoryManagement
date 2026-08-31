import { Router } from 'express';
import multer from 'multer';
import { Site, Unit } from '../models/index.js';
import { clearCompanyCache } from '../services/companyIdentity.js';

const router = Router();

/* The fields a facility prints on a customer's paperwork. Whitelisted rather
   than spread, so a stray key in the body can never reach the document. */
const BRANDING = ['legalName', 'tagline', 'addr1', 'addr2', 'country', 'phone', 'email', 'trn', 'bankInformation'];

const pickBranding = (body) => Object.fromEntries(
  BRANDING.filter((k) => body?.[k] !== undefined).map((k) => [k, String(body[k] ?? '').trim()]),
);

// A logo is a letterhead mark, not a photo library.
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

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
  if (!name?.trim()) return res.status(400).json({ error: 'Facility name is required' });
  const site = await Site.create({ name: name.trim(), code, address, hidden, ...pickBranding(req.body) });
  clearCompanyCache();
  res.status(201).json(site);
});

router.put('/:id', requireAdmin, async (req, res) => {
  const { name, code, address, hidden } = req.body || {};
  const site = await Site.findByIdAndUpdate(
    req.params.id,
    {
      ...(name !== undefined && { name }), ...(code !== undefined && { code }),
      ...(address !== undefined && { address }), ...(hidden !== undefined && { hidden }),
      ...pickBranding(req.body),
    },
    { new: true },
  );
  if (!site) return res.status(404).json({ error: 'Facility not found' });
  clearCompanyCache(site._id);
  res.json(site);
});

/**
 * Make this the default facility.
 *
 * Exactly one, always: the switcher opens on it, and a document with no unit
 * behind it (a moving job, an imported invoice) takes its letterhead. Nothing
 * could set this before -- it was written once by the auto-seed and then
 * unreachable, which is why no facility was marked and 151 units belonged to
 * none of them.
 */
router.put('/:id/default', requireAdmin, async (req, res) => {
  const site = await Site.findById(req.params.id);
  if (!site) return res.status(404).json({ error: 'Facility not found' });
  await Site.updateMany({ _id: { $ne: site._id } }, { $set: { isDefault: false } });
  site.isDefault = true;
  await site.save();
  clearCompanyCache();
  res.json(site);
});

/** The letterhead mark. Stored as bytes -- see the note on siteSchema. */
router.post('/:id/logo', requireAdmin, logoUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'A logo file is required' });
  if (!/^image\/(png|jpe?g|gif|webp)$/i.test(req.file.mimetype)) {
    return res.status(400).json({ error: 'The logo must be a PNG, JPG, GIF or WebP image' });
  }
  const site = await Site.findById(req.params.id);
  if (!site) return res.status(404).json({ error: 'Facility not found' });
  site.logo = { data: req.file.buffer, mimeType: req.file.mimetype, updatedAt: new Date() };
  await site.save();
  clearCompanyCache(site._id);
  res.json({ ok: true, size: req.file.size });
});

router.delete('/:id/logo', requireAdmin, async (req, res) => {
  const site = await Site.findById(req.params.id);
  if (!site) return res.status(404).json({ error: 'Facility not found' });
  site.logo = { data: undefined, mimeType: '', updatedAt: null };
  await site.save();
  clearCompanyCache(site._id);
  res.json({ ok: true });
});

/** Serve a facility's logo so the Sites page can show what will be printed. */
router.get('/:id/logo', async (req, res) => {
  const site = await Site.findById(req.params.id).select('+logo.data').lean().catch(() => null);
  if (!site?.logo?.data) return res.status(404).json({ error: 'No logo set for this facility' });
  res.setHeader('Content-Type', site.logo.mimeType || 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(site.logo.data);
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const site = await Site.findById(req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  if (site.isDefault) return res.status(409).json({ error: 'The default site cannot be deleted' });
  const hasUnits = await Unit.exists({ site: site._id });
  if (hasUnits) return res.status(409).json({ error: 'This facility has units — move or delete them first' });
  await site.deleteOne();
  clearCompanyCache(site._id);
  res.json({ ok: true });
});

export default router;
