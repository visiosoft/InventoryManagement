import { Router } from 'express';
import multer from 'multer';
import { requireCampaignAccess } from '../middleware/auth.js';
import { CampaignTemplate, TemplateImage } from '../models/index.js';
import { softDelete } from '../utils/softDelete.js';
import { validateTemplate, submitTemplate, refreshTemplateStatuses, newImageKey } from '../services/templateManager.js';

const router = Router();
router.use(requireCampaignAccess);

// Meta accepts JPG/PNG up to 5 MB for a template's sample header image.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png'].includes(file.mimetype)),
});

function fieldsFrom(body) {
  const parse = (v, d) => { try { return typeof v === 'string' ? JSON.parse(v) : (v ?? d); } catch { return d; } };
  return {
    name: String(body.name || '').trim().toLowerCase(),
    language: String(body.language || 'en').trim() || 'en',
    category: body.category === 'UTILITY' ? 'UTILITY' : 'MARKETING',
    headerType: body.headerType === 'image' ? 'image' : 'none',
    bodyText: String(body.bodyText || '').trim(),
    bodyExamples: parse(body.bodyExamples, []).map(String),
    footerText: String(body.footerText || '').trim(),
    buttons: parse(body.buttons, []).filter((b) => b && b.text).map((b) => ({ type: b.type === 'URL' ? 'URL' : 'QUICK_REPLY', text: String(b.text), url: String(b.url || '') })),
  };
}

const present = (t) => ({
  ...t,
  imageUrl: t.imageKey ? `/api/public/template-media/${t.imageKey}` : '',
  problems: t.status === 'draft' || t.status === 'REJECTED' ? validateTemplate(t) : [],
});

router.get('/', async (_req, res) => {
  const rows = await CampaignTemplate.find().sort({ createdAt: -1 }).lean();
  res.json(rows.map(present));
});

router.post('/refresh', async (_req, res) => {
  try { res.json(await refreshTemplateStatuses()); } catch (e) { res.status(502).json({ error: e.message }); }
});

router.post('/', upload.single('image'), async (req, res) => {
  const f = fieldsFrom(req.body);
  if (await CampaignTemplate.findOne({ name: f.name, language: f.language })) return res.status(409).json({ error: 'You already have a template with this name and language' });
  const doc = new CampaignTemplate({ ...f, createdBy: req.user.id, createdByName: req.user.name || req.user.email || '' });
  if (req.file) {
    doc.imageKey = newImageKey();
    await TemplateImage.create({ key: doc.imageKey, data: req.file.buffer, contentType: req.file.mimetype, fileName: req.file.originalname, size: req.file.size });
    doc.headerType = 'image';
  }
  await doc.save();
  res.status(201).json(present(doc.toObject()));
});

router.put('/:id', upload.single('image'), async (req, res) => {
  const doc = await CampaignTemplate.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  // Meta does not let an approved or waiting template be edited here.
  if (!['draft', 'REJECTED'].includes(doc.status)) return res.status(400).json({ error: 'Only a draft or rejected template can be edited' });
  Object.assign(doc, fieldsFrom(req.body));
  if (req.file) {
    doc.imageKey = newImageKey();
    await TemplateImage.create({ key: doc.imageKey, data: req.file.buffer, contentType: req.file.mimetype, fileName: req.file.originalname, size: req.file.size });
    doc.headerType = 'image';
  }
  if (doc.headerType === 'none') doc.imageKey = '';
  await doc.save();
  res.json(present(doc.toObject()));
});

/* ---------- the unit-sizes carousel ---------- */

/** Which cards have a photo, and where the template stands with Meta. */
router.get('/carousel', async (_req, res) => {
  try {
    const { CAROUSEL_CARDS, CAROUSEL_NAME, CAROUSEL_BODY, cardBody, cardHasImage, ensureCardImages, loadCardPricing, cardLinkUrl, missingUnitPages } = await import('../services/carousel.js');
    const pricing = await loadCardPricing();
    // The website pages behind each card's "Book now" (purplebox.ae/units/…).
    const pagesMissing = await missingUnitPages(CAROUSEL_CARDS).catch(() => []);
    // Photos that live on the website are fetched the first time they are needed.
    const fetched = await ensureCardImages();
    const { listWhatsAppTemplates } = await import('../services/whatsapp.js');
    const list = await listWhatsAppTemplates().catch(() => ({ templates: [] }));
    const meta = (list.templates || []).find((t) => t.name === CAROUSEL_NAME);
    res.json({
      name: CAROUSEL_NAME,
      body: CAROUSEL_BODY,
      pagesMissing,
      status: meta ? String(meta.status).toUpperCase() : 'NOT_SUBMITTED',
      rejectedReason: meta?.rejected_reason || '',
      photoProblems: fetched.failed,
      cards: CAROUSEL_CARDS.map((c) => ({ code: c.code, label: c.label, text: cardBody(c, pricing), bookUrl: cardLinkUrl(c), hasImage: cardHasImage(c.code), imageUrl: cardHasImage(c.code) ? `/api/public/carousel/${c.code}.jpg` : '' })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Send the carousel to Meta for review (admin). */
router.post('/carousel/submit', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  try {
    const { submitUnitSizesCarousel } = await import('../services/templateManager.js');
    res.json(await submitUnitSizesCarousel());
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/:id/submit', async (req, res) => {
  try { res.json(present((await submitTemplate(req.params.id)).toObject())); } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  const doc = await CampaignTemplate.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  await softDelete(doc, req.user?.id);
  res.json({ ok: true });
});

export const publicMediaRouter = Router();
// Meta fetches nothing from here for review (we upload the bytes), but the
// editor shows the picture back to the admin without a token on <img>.
publicMediaRouter.get('/:key', async (req, res) => {
  const img = await TemplateImage.findOne({ key: String(req.params.key) }).lean();
  if (!img) return res.status(404).end();
  res.set('Content-Type', img.contentType).set('Cache-Control', 'public, max-age=86400').send(Buffer.from(img.data.buffer ?? img.data));
});

export default router;
