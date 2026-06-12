import { Router } from 'express';
import multer from 'multer';
import { Document } from '../models/index.js';
import { uploadFile, driveConfigured } from '../services/drive.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.contract) filter.contract = req.query.contract;
  if (req.query.customer) filter.customer = req.query.customer;
  const docs = await Document.find(filter)
    .populate('customer', 'fullName')
    .populate('contract', 'contractNo')
    .sort({ createdAt: -1 });
  res.json(docs);
});

router.get('/storage-status', (_req, res) => {
  res.json({ driveConfigured: driveConfigured() });
});

// Upload a document (multipart form: file, plus optional contract/customer/type/name)
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  const stored = await uploadFile({
    buffer: req.file.buffer,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
  });
  const doc = await Document.create({
    contract: req.body.contract || undefined,
    customer: req.body.customer || undefined,
    name: req.body.name || req.file.originalname,
    type: req.body.type || 'other',
    ...stored,
  });
  res.status(201).json(doc);
});

router.delete('/:id', async (req, res) => {
  await Document.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
