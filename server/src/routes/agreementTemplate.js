import { Router } from 'express';
import { AgreementTemplate } from '../models/index.js';

const router = Router();

const PLACEHOLDERS = [
  'customerName', 'customerEmail', 'customerPhone', 'customerAddress',
  'emiratesId', 'passportNumber',
  'contractNo', 'startDate', 'endDate', 'todayDate', 'weeks',
  'unitNumbers', 'unitSizes',
  'rate', 'leasedPrice', 'deposit', 'totalQuotation',
];

// The saved agreement wording (anyone signed in may read it)
router.get('/', async (_req, res) => {
  const tpl = await AgreementTemplate.findOne({ key: 'default' }).lean();
  res.json({
    body: tpl?.body || '',
    updatedAt: tpl?.updatedAt || null,
    updatedBy: tpl?.updatedBy || '',
    placeholders: PLACEHOLDERS,
  });
});

// Save the wording — admins only
router.put('/', async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can edit the agreement template' });
  }
  const body = String(req.body?.body ?? '');
  const tpl = await AgreementTemplate.findOneAndUpdate(
    { key: 'default' },
    { body, updatedBy: req.user?.name || req.user?.email || '' },
    { new: true, upsert: true },
  );
  res.json({ ok: true, updatedAt: tpl.updatedAt, updatedBy: tpl.updatedBy });
});

export default router;
