import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Contract, Customer, Document } from '../models/index.js';
import { requireCustomer, otpLimiter } from './customerAuth.js';
import { normalizePhone } from '../services/customerOtp.js';
import { UPLOADS_DIR, downloadFile, driveConfigured, uploadFile } from '../services/drive.js';
import { ALLOWED_MIME, ID_SIDES, ID_TYPES, docName, extensionFor, idComplete, latestPerSlot } from '../services/identityDocs.js';
import { customerDocumentFilter, linkIdentityToCustomerContracts } from '../services/customerIdentity.js';

/**
 * A tenant's own files and the people allowed into their unit.
 *
 *  - Identity documents (Emirates ID, passport): uploaded from the phone straight into the PurpleBox Google Drive, kept
 *    private (never "anyone with the link"), listed here together with whatever staff filed for them, and copied onto
 *    each contract they hold so the office finds the ID where it expects it.
 *  - Authorised persons: who may enter the unit, kept on the contract exactly as staff keep it.
 */
const router = Router();
router.use(requireCustomer);

const MAX_MB = 12;
const uploadOne = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } }).single('file');
// multer reports a too-large file through next(err); say so plainly instead of a stack trace.
const upload = {
  single: () => (req, res, next) => uploadOne(req, res, (err) => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ error: tooBig ? `That file is too large (${MAX_MB} MB at most)` : 'Could not read that upload' });
  }),
};
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
};
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

const OTHER_TYPES = ['id_proof', 'visa', 'trade_license'];
const VIEWABLE = [...ID_TYPES, ...OTHER_TYPES, 'contract'];

// ── Identity & documents ────────────────────────────────────────────────────
function docView(d, contractNo) {
  return {
    id: d._id, type: d.type, side: d.side || '', name: d.name, createdAt: d.createdAt, source: d.source === 'customer_app' ? 'you' : 'office',
    mime: d.mime || '', contractNo: contractNo || undefined,
    href: `/customer-portal/storage/identity/${d._id}/file`,
  };
}

router.get('/identity', wrap(async (req, res) => {
  const customerId = req.customer.customerId;
  const filter = await customerDocumentFilter(customerId);
  const docs = await Document.find({ ...filter, type: { $in: VIEWABLE } }).sort({ createdAt: -1 }).lean();
  const contracts = await Contract.find({ customer: customerId }).select('contractNo').lean();
  const noOf = new Map(contracts.map((c) => [String(c._id), c.contractNo]));

  // One current file per ID slot, plus every other document as filed.
  const shown = [...latestPerSlot(docs), ...docs.filter((d) => !ID_TYPES.includes(d.type))];
  res.json({
    complete: idComplete(docs),
    storedIn: driveConfigured() ? 'Google Drive' : 'PurpleBox',
    documents: shown.map((d) => docView(d, d.contract ? noOf.get(String(d.contract)) : undefined)),
  });
}));

router.post('/identity', otpLimiter, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw bad('Choose a photo or PDF to upload');
  const type = String(req.body?.type || '');
  if (!ID_TYPES.includes(type)) throw bad('Choose Emirates ID or passport');
  const side = ID_SIDES[type].includes(req.body?.side) ? req.body.side : ID_SIDES[type][0];
  const mime = req.file.mimetype;
  if (!ALLOWED_MIME.has(mime)) throw bad('Upload a photo (JPG, PNG, HEIC) or a PDF');

  const customer = await Customer.findById(req.customer.customerId).select('fullName');
  if (!customer) throw bad('Customer not found', 404);

  const filename = `${type}-${side}-${Date.now()}.${extensionFor(mime)}`;
  let stored;
  try {
    stored = await uploadFile({ buffer: req.file.buffer, filename, mimeType: mime, customerName: customer.fullName, private: true });
  } catch (err) {
    console.error('[customerFiles] upload failed:', err.message);
    throw bad('We could not save your document right now. Please try again in a moment.', 503);
  }
  const doc = await Document.create({
    customer: customer._id, name: docName(type, side), type, side, source: 'customer_app', mime,
    storage: stored.storage, driveFileId: stored.driveFileId || '', url: stored.url || '',
  });
  const linked = await linkIdentityToCustomerContracts(customer._id).catch((e) => { console.error('[customerFiles] could not link to contracts:', e.message); return { contracts: 0, linked: 0 }; });
  const all = await Document.find({ customer: customer._id, type: { $in: ID_TYPES } }).lean();
  res.status(201).json({ document: docView(doc.toObject()), complete: idComplete(all), attachedToContracts: linked.contracts });
}));

// The file itself, only to its owner: through us, so a Drive link never reaches the phone.
router.get('/identity/:id/file', wrap(async (req, res) => {
  const filter = await customerDocumentFilter(req.customer.customerId);
  const doc = await Document.findOne({ _id: req.params.id, ...filter, type: { $in: VIEWABLE } });
  if (!doc) throw bad('Document not found', 404);

  let buffer;
  if (doc.storage === 'drive' && doc.driveFileId) buffer = await downloadFile({ driveFileId: doc.driveFileId });
  else if (doc.url?.startsWith('/uploads/')) {
    const file = path.join(UPLOADS_DIR, path.basename(doc.url));
    if (!fs.existsSync(file)) throw bad('File not found', 404);
    buffer = fs.readFileSync(file);
  } else throw bad('File not available', 404);

  const ext = path.extname(doc.name || '').toLowerCase();
  const mime = doc.mime || (ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg');
  res.setHeader('Content-Type', buffer.subarray(0, 4).toString() === '%PDF' ? 'application/pdf' : mime);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(buffer);
}));

// ── People who can access a unit ────────────────────────────────────────────
const MAX_PEOPLE = 6;
const ID_KINDS = ['', 'Emirates ID', 'Passport'];

async function liveContract(req) {
  const contract = await Contract.findOne({ _id: req.params.id, customer: req.customer.customerId, status: { $in: ['active', 'pending_signature'] } });
  if (!contract) throw bad('Contract not found', 404);
  return contract;
}
const personView = (p, index) => ({ index, name: p.name, phone: p.phone || '', relation: p.relation || '', idType: p.idType || '', idNumber: p.idNumber ? `•••${String(p.idNumber).slice(-3)}` : '' });

router.get('/contracts/:id/access', wrap(async (req, res) => {
  const contract = await liveContract(req);
  res.json({ contractNo: contract.contractNo, max: MAX_PEOPLE, people: (contract.authorizedPersons || []).map(personView) });
}));

router.post('/contracts/:id/access', otpLimiter, wrap(async (req, res) => {
  const contract = await liveContract(req);
  const name = String(req.body?.name || '').trim();
  const digits = normalizePhone(req.body?.phone);
  const relation = String(req.body?.relation || '').trim().slice(0, 40);
  const idType = ID_KINDS.includes(req.body?.idType) ? req.body.idType : '';
  const idNumber = String(req.body?.idNumber || '').trim().slice(0, 40);
  if (name.length < 2) throw bad('Enter their full name');
  if (digits.length < 10) throw bad('Enter their mobile number with country code');
  if ((contract.authorizedPersons || []).length >= MAX_PEOPLE) throw bad(`You can add up to ${MAX_PEOPLE} people. Remove someone first.`);
  if ((contract.authorizedPersons || []).some((p) => normalizePhone(p.phone) === digits)) throw bad('That number is already on the list', 409);

  contract.authorizedPersons.push({ name, phone: `+${digits}`, relation, idType, idNumber });
  contract.timeline.push({ at: new Date(), text: `Tenant added ${name} (+${digits}) as an authorised person in the app`, author: 'customer app' });
  await contract.save();
  res.status(201).json({ contractNo: contract.contractNo, max: MAX_PEOPLE, people: contract.authorizedPersons.map(personView) });
}));

router.delete('/contracts/:id/access/:index', wrap(async (req, res) => {
  const contract = await liveContract(req);
  const i = Number(req.params.index);
  if (!Number.isInteger(i) || i < 0 || i >= (contract.authorizedPersons?.length || 0)) throw bad('Person not found', 404);
  const [gone] = contract.authorizedPersons.splice(i, 1);
  contract.timeline.push({ at: new Date(), text: `Tenant removed ${gone.name} from authorised persons in the app`, author: 'customer app' });
  await contract.save();
  res.json({ contractNo: contract.contractNo, max: MAX_PEOPLE, people: contract.authorizedPersons.map(personView) });
}));

export default router;
