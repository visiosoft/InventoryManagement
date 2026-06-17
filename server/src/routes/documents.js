import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Document, Customer } from '../models/index.js';
import { uploadFile, driveConfigured, UPLOADS_DIR } from '../services/drive.js';

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
  const customer = req.body.customer
    ? await Customer.findById(req.body.customer).select('fullName')
    : null;
  const stored = await uploadFile({
    buffer: req.file.buffer,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    customerName: customer?.fullName,
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

// Manually sync a locally-stored document to Google Drive
router.post('/:id/sync-to-drive', async (req, res) => {
  if (!driveConfigured()) {
    return res.status(400).json({ error: 'Google Drive is not configured' });
  }
  const doc = await Document.findById(req.params.id).populate('customer', 'fullName');
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (doc.storage === 'drive') return res.status(409).json({ error: 'Already stored in Google Drive' });

  // Derive local filename from the stored URL: /uploads/<filename>
  const filename = path.basename(doc.url);
  const localPath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(localPath)) {
    return res.status(404).json({ error: 'Local file not found on server' });
  }

  const buffer = fs.readFileSync(localPath);
  const mimeType = filename.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
  const stored = await uploadFile({
    buffer,
    filename,
    mimeType,
    customerName: doc.customer?.fullName,
  });

  doc.storage = stored.storage;
  doc.driveFileId = stored.driveFileId;
  doc.url = stored.url;
  await doc.save();

  res.json(doc);
});

router.delete('/:id', async (req, res) => {
  await Document.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
