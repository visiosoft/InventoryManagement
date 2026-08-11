import { Router } from 'express';
import crypto from 'crypto';
import { isValidObjectId } from 'mongoose';
import { AgreementTemplate } from '../models/index.js';
import {
  mergeAgreementText, looksLikeHtml, samplePlaceholderContract,
  renderAgreementHtmlPdf, renderAgreementTextPdf,
} from '../services/agreementText.js';

const router = Router();

// Express 4 drops async route errors on the floor (the request hangs) — wrap
const aw = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error('[AgreementTemplate]', e.message);
  if (!res.headersSent) res.status(500).json({ error: e.message });
});

const PLACEHOLDERS = [
  'customerName', 'companyName', 'customerEmail', 'customerPhone', 'whatsapp',
  'emergencyContact', 'emergencyNumber', 'customerAddress',
  'emiratesId', 'passportNumber',
  'contractNo', 'startDate', 'endDate', 'todayDate', 'weeks',
  'unitNumbers', 'unitSizes', 'accessType',
  'rate', 'leasedPrice', 'deposit', 'totalQuotation',
  'customerSignature',
];

const requireAdmin = (req, res) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Only admins can manage templates' });
    return false;
  }
  return true;
};

// Older builds stored one template under key 'default'; give it a name once
async function migrateLegacy() {
  await AgreementTemplate.updateMany(
    { key: 'default', $or: [{ name: { $exists: false } }, { name: '' }, { name: null }] },
    { $set: { name: 'Agreement', isDefault: true } },
  );
}

// List all templates (names + which one is the contract default)
router.get('/', aw(async (_req, res) => {
  await migrateLegacy();
  const templates = await AgreementTemplate.find({})
    .select('name isDefault updatedAt updatedBy')
    .sort({ isDefault: -1, name: 1 })
    .lean();
  res.json({ templates, placeholders: PLACEHOLDERS });
}));

router.post('/', aw(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Template name is required' });
  const count = await AgreementTemplate.countDocuments();
  const tpl = await AgreementTemplate.create({
    name,
    key: `tpl-${crypto.randomUUID()}`, // legacy unique index on key tolerates this
    body: String(req.body?.body || ''),
    isDefault: count === 0, // first template becomes the agreement default
    updatedBy: req.user?.name || req.user?.email || '',
  });
  res.status(201).json(tpl);
}));

router.get('/:id', aw(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid template id' });
  const tpl = await AgreementTemplate.findById(req.params.id).lean();
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  res.json(tpl);
}));

router.put('/:id', aw(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid template id' });
  const tpl = await AgreementTemplate.findById(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });

  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Template name is required' });
    tpl.name = name;
  }
  if (req.body.body !== undefined) tpl.body = String(req.body.body);
  if (req.body.isDefault === true) {
    await AgreementTemplate.updateMany({ _id: { $ne: tpl._id } }, { $set: { isDefault: false } });
    tpl.isDefault = true;
  }
  tpl.updatedBy = req.user?.name || req.user?.email || '';
  await tpl.save();
  res.json(tpl);
}));

router.delete('/:id', aw(async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid template id' });
  const tpl = await AgreementTemplate.findByIdAndDelete(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  res.json({ ok: true });
}));

// PDF preview with sample values — see exactly what the document will print
router.get('/:id/preview-pdf', aw(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid template id' });
  const tpl = await AgreementTemplate.findById(req.params.id).lean();
  if (!tpl) return res.status(404).json({ error: 'Template not found' });

  const sample = samplePlaceholderContract();
  const merged = mergeAgreementText(tpl.body, sample);
  const title = tpl.isDefault ? 'STORAGE AGREEMENT' : tpl.name.toUpperCase();
  const pdf = looksLikeHtml(merged)
    ? await renderAgreementHtmlPdf({ html: merged, contract: sample, title, header: tpl.isDefault, signature: tpl.isDefault })
    : await renderAgreementTextPdf({ text: merged, contract: sample, header: tpl.isDefault, signature: tpl.isDefault });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${tpl.name}.pdf"`);
  res.send(pdf);
}));

export default router;
