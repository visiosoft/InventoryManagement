import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Document, Customer } from '../models/index.js';
import { uploadFile, driveConfigured, driveClient, UPLOADS_DIR } from '../services/drive.js';
import { openaiConfigured, openaiModel, visionJson } from '../services/openai.js';
import { parseIdFields, diffAgainstCustomer } from '../services/documentExtract.js';

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

/* ── Read an ID document ──────────────────────────────────────────────────
   Returns a *proposal*. It never writes to the customer: the model is allowed
   to be wrong, so a person confirms each field on the client and the existing
   customer update endpoint does the saving. */

// Trade licence is deliberately absent: none of the fields above map to one,
// and its company name would be proposed into a person's fullName.
const READABLE_TYPES = new Set(['emirates_id', 'passport', 'visa', 'id_proof']);
const READABLE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const EXTRACT_SYSTEM = [
    'You read a photographed or scanned identity document and report what is printed on it.',
    'Reply with JSON only, no prose.',
    'Shape: {"fullName":string|null,"emiratesId":string|null,"eidExpiry":"YYYY-MM-DD"|null,"passportNumber":string|null,"passportExpiry":"YYYY-MM-DD"|null,"nationality":string|null}',
    'Use null for anything not printed on this document, or that you cannot read with confidence.',
    'Never infer, complete or correct a value. A partially visible number is null.',
    'Do not confuse a date of birth or an issue date with an expiry date.',
    'Dates must be YYYY-MM-DD. Convert from whatever format is printed.',
].join('\n');

/** The file's bytes, wherever it is stored. */
async function readDocumentBytes(doc) {
    if (doc.storage === 'drive') {
        if (!driveConfigured()) throw new Error('Google Drive is not configured');
        const { data } = await driveClient().files.get(
            { fileId: doc.driveFileId, alt: 'media' },
            { responseType: 'arraybuffer' },
        );
        return Buffer.from(data);
    }
    const localPath = path.join(UPLOADS_DIR, path.basename(doc.url));
    if (!fs.existsSync(localPath)) throw new Error('File not found on the server');
    return fs.readFileSync(localPath);
}

router.post('/:id/extract', async (req, res) => {
    try {
        if (!openaiConfigured()) {
            return res.status(400).json({ error: 'OpenAI is not configured. Add a key in Settings → Integrations.' });
        }
        const doc = await Document.findById(req.params.id);
        if (!doc) return res.status(404).json({ error: 'Document not found' });
        if (!READABLE_TYPES.has(doc.type)) {
            return res.status(400).json({ error: `Only ID documents can be read; this one is "${doc.type}"` });
        }

        const ext = path.extname(doc.url || doc.name).toLowerCase();
        const mimeType = READABLE_MIME[ext];
        if (!mimeType) {
            // PDFs would need rasterising first, which is a separate job.
            return res.status(400).json({ error: 'Only PNG, JPG and WEBP images can be read. Upload a photo of the document.' });
        }

        const bytes = await readDocumentBytes(doc);
        const { parsed, usage } = await visionJson({
            system: EXTRACT_SYSTEM,
            imageBase64: bytes.toString('base64'),
            mimeType,
            prompt: 'Report what is printed on this document.',
        });

        const { ok, fields, rejected } = parseIdFields(parsed);
        const customer = doc.customer ? await Customer.findById(doc.customer).lean() : null;

        // Measured, not estimated — so the per-document cost is known before
        // anyone points this at the whole backlog.
        console.log(`[DocExtract] ${doc._id} model=${openaiModel()} tokens=${usage?.total_tokens ?? '?'} accepted=${Object.keys(fields).length} rejected=${rejected.length}`);

        res.json({
            ok,
            model: openaiModel(),
            fields,
            rejected,
            rows: diffAgainstCustomer(fields, customer || {}),
            customer: customer ? { _id: customer._id, fullName: customer.fullName } : null,
            usage: usage ? { totalTokens: usage.total_tokens } : null,
        });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Could not read the document' });
    }
});

router.delete('/:id', async (req, res) => {
  await Document.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
