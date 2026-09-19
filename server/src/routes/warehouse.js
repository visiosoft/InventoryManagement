import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';
import { drawCompanyLogo } from '../services/pdfLogo.js';
import { User, Customer, Contract, Site } from '../models/index.js';
import { StoredContainer, WarehouseLocation, ScanEvent, ItemPhoto, WarehouseJob, CONTAINER_STATES, WAREHOUSE_JOB_TYPES, WAREHOUSE_JOB_STATES } from '../models/warehouse.js';
import { command, createContainers, createLocation, editLocation, deleteLocation, editContainer, deleteContainer, scan, addPhoto, logLabels, createWarehouseJob, updateWarehouseJob, getOrCreateJobLink, revokeJobLink, operationalPermission, escapeRegex } from '../services/warehouse.js';
import { fail, nextAction, validateMovement } from '../services/warehouseRules.js';

const router = Router();
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// Re-read the account so revoking a permission takes effect without waiting for
// the seven-day login token to expire. Customer/crew tokens do not grant access.
router.use(asyncRoute(async (req, res, next) => {
  if (!req.user?.id || !/^[a-f0-9]{24}$/i.test(req.user.id)) return res.status(401).json({ error: 'Employee authentication required.' });
  const user = await User.findById(req.user.id).select('role permissions isActive name');
  if (!user?.isActive || !operationalPermission(user)) return res.status(403).json({ error: 'Warehouse permission required.' });
  req.warehouseUser = user;
  next();
}));

const scope = req => {
  if (!req.query.site || !/^[a-f0-9]{24}$/i.test(String(req.query.site))) fail('Select a facility.');
  return { site: req.query.site };
};
const pagination = req => ({ page: Math.max(1, Math.min(100000, parseInt(req.query.page, 10) || 1)), limit: Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 30)) });

router.get('/setup', asyncRoute(async (_req, res) => {
  res.json({ sites: await Site.find({ hidden: { $ne: true } }).select('name code isDefault').lean() });
}));
router.get('/customers', asyncRoute(async (req, res) => {
  const search = String(req.query.search || '').trim().slice(0, 100);
  if (search.length < 2) return res.json([]);
  const re = new RegExp(escapeRegex(search), 'i');
  res.json(await Customer.find({ $or: [{ fullName: re }, { phone: re }, { clientId: re }] }).select('fullName clientId phone address').limit(30).lean());
}));
router.get('/customers/:id/bookings', asyncRoute(async (req, res) => {
  if (!/^[a-f0-9]{24}$/i.test(req.params.id)) fail('Invalid customer.');
  res.json(await Contract.find({ customer: req.params.id }).select('contractNo unit units status').populate('unit', 'unitNumber').populate('units', 'unitNumber').sort({ createdAt: -1 }).limit(100).lean());
}));
router.get('/summary', asyncRoute(async (req, res) => {
  const filter = scope(req);
  const result = {};
  for (const status of CONTAINER_STATES) result[status] = await StoredContainer.countDocuments({ ...filter, currentStatus: status });
  result.locations = await WarehouseLocation.countDocuments(filter);
  result.missingLocations = await StoredContainer.countDocuments({ ...filter, currentStatus: 'IN_STORAGE', currentLocation: null });
  res.json(result);
}));
router.get('/locations', asyncRoute(async (req, res) => {
  res.json(await WarehouseLocation.find(scope(req)).sort({ warehouse: 1, name: 1 }).limit(2000).lean());
}));
router.post('/locations', asyncRoute(async (req, res) => res.status(201).json(await command(req.warehouseUser, req.body, 'CREATE_LOCATION', ctx => createLocation(ctx, req.body)))));
router.patch('/locations/:id', asyncRoute(async (req, res) => res.json(await command(req.warehouseUser, req.body, 'EDIT_LOCATION', ctx => editLocation(ctx, req.params.id, req.body)))));
router.delete('/locations/:id', asyncRoute(async (req, res) => res.json(await command(req.warehouseUser, req.body, 'DELETE_LOCATION', ctx => deleteLocation(ctx, req.params.id)))));
router.get('/containers', asyncRoute(async (req, res) => {
  const filter = scope(req);
  const { page, limit } = pagination(req);
  if (req.query.status) {
    if (!CONTAINER_STATES.includes(req.query.status)) fail('Invalid status.');
    filter.currentStatus = req.query.status;
  }
  if (req.query.customer) {
    if (!/^[a-f0-9]{24}$/i.test(String(req.query.customer))) fail('Invalid customer.');
    filter.customer = req.query.customer;
  }
  if (req.query.ids) {
    const ids = String(req.query.ids).split(',').map(s => s.trim()).filter(Boolean).slice(0, 100);
    if (!ids.length) fail('Invalid ids.');
    filter._id = { $in: ids };
  }
  const search = String(req.query.search || '').trim().slice(0, 100);
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    const customers = await Customer.find({ $or: [{ fullName: re }, { phone: re }, { clientId: re }] }).select('_id').limit(200).lean();
    const bookings = await Contract.find({ contractNo: re }).select('_id').limit(200).lean();
    const locations = await WarehouseLocation.find({ ...scope(req), $or: [{ name: re }, { displayCode: re }] }).select('_id').limit(200).lean();
    filter.$or = [{ displayCode: re }, { description: re }, { contents: re }, { customer: { $in: customers.map(c => c._id) } }, { booking: { $in: bookings.map(b => b._id) } }, { currentLocation: { $in: locations.map(l => l._id) } }];
  }
  const total = await StoredContainer.countDocuments(filter);
  const data = await StoredContainer.find(filter).populate('customer', 'fullName clientId').populate('booking', 'contractNo').populate('currentLocation', 'name displayCode').sort({ createdAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean();
  res.json({ data, total, page, pages: Math.ceil(total / limit) });
}));
router.post('/containers', asyncRoute(async (req, res) => res.status(201).json(await command(req.warehouseUser, req.body, 'CREATE_CONTAINERS', ctx => createContainers(ctx, req.body)))));
router.patch('/containers/:id', asyncRoute(async (req, res) => res.json(await command(req.warehouseUser, req.body, 'EDIT_CONTAINER', ctx => editContainer(ctx, req.params.id, req.body)))));
router.delete('/containers/:id', asyncRoute(async (req, res) => res.json(await command(req.warehouseUser, req.body, 'DELETE_CONTAINER', ctx => deleteContainer(ctx, req.params.id, req.body)))));
router.get('/containers/:id', asyncRoute(async (req, res) => {
  const item = await StoredContainer.findById(req.params.id).populate('customer', 'fullName clientId phone').populate('booking', 'contractNo').populate('unit', 'unitNumber').populate('currentLocation', 'name displayCode').lean();
  if (!item) fail('Item not found.', 404);
  const photos = await ItemPhoto.find({ container: item._id }).select('_id createdAt').sort({ createdAt: 1 }).lean();
  res.json({ ...item, photos, nextAction: nextAction(item) });
}));
router.get('/containers/:id/events', asyncRoute(async (req, res) => {
  const { page, limit } = pagination(req);
  const filter = { objectId: req.params.id };
  res.json({ data: await ScanEvent.find(filter).select('-result -requestHash').populate('employee', 'name').sort({ timestamp: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(), total: await ScanEvent.countDocuments(filter) });
}));
router.get('/containers/:id/suggestions', asyncRoute(async (req, res) => {
  const item = await StoredContainer.findById(req.params.id).lean();
  if (!item) fail('Item not found.', 404);
  const locations = await WarehouseLocation.find({ site: item.site, warehouse: item.warehouse, kind: { $in: ['SHELF', 'BIN', 'RACK'] } }).sort({ displayCode: 1 }).lean();
  res.json(locations.filter(location => {
    try { validateMovement({ ...item, photoCount: Math.max(1, item.photoCount) }, location, item.currentStatus === 'IN_STORAGE' ? 'RELOCATE' : 'PUTAWAY', true); return true; } catch { return false; }
  }).slice(0, 5));
}));
router.post('/scans', asyncRoute(async (req, res) => res.json(await command(req.warehouseUser, req.body, 'SCAN', ctx => scan(ctx, req.body)))));

router.get('/jobs', asyncRoute(async (req, res) => {
  const filter = scope(req);
  if (req.query.status) { if (!WAREHOUSE_JOB_STATES.includes(req.query.status)) fail('Invalid status.'); filter.status = req.query.status; }
  if (req.query.type) { if (!WAREHOUSE_JOB_TYPES.includes(req.query.type)) fail('Invalid type.'); filter.type = req.query.type; }
  res.json(await WarehouseJob.find(filter).populate('customer', 'fullName clientId phone').sort({ createdAt: -1 }).limit(200).lean());
}));
router.post('/jobs', asyncRoute(async (req, res) => res.status(201).json(await command(req.warehouseUser, req.body, 'CREATE_JOB', ctx => createWarehouseJob(ctx, req.body)))));
router.patch('/jobs/:id', asyncRoute(async (req, res) => res.json(await command(req.warehouseUser, req.body, 'UPDATE_JOB', ctx => updateWarehouseJob(ctx, req.params.id, req.body)))));
router.post('/jobs/:id/link', asyncRoute(async (req, res) => res.json(await command(req.warehouseUser, req.body, 'CREATE_JOB_LINK', ctx => getOrCreateJobLink(ctx, req.params.id)))));
router.delete('/jobs/:id/link', asyncRoute(async (req, res) => res.json(await command(req.warehouseUser, req.body, 'REVOKE_JOB_LINK', ctx => revokeJobLink(ctx, req.params.id)))));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 3 } });
router.post('/containers/:id/photos', upload.single('photo'), asyncRoute(async (req, res) => {
  if (!req.file) fail('Choose a photo.');
  const input = { ...req.body, containerId: req.params.id, photoHash: createHash('sha256').update(req.file.buffer).digest('hex') };
  res.status(201).json(await command(req.warehouseUser, input, 'ADD_PHOTO', ctx => addPhoto(ctx, req.params.id, req.file.buffer)));
}));
router.get('/photos/:id', asyncRoute(async (req, res) => {
  const photo = await ItemPhoto.findById(req.params.id).select('+data').lean();
  if (!photo) fail('Photo not found.', 404);
  res.set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff').type(photo.mimeType).send(photo.data.buffer ? Buffer.from(photo.data.buffer) : photo.data);
}));

router.post('/labels', asyncRoute(async (req, res) => {
  const result = await command(req.warehouseUser, req.body, 'PRINT_LABELS', ctx => logLabels(ctx, req.body));
  const thermal = req.body.format !== 'A4';
  const doc = new PDFDocument({ size: thermal ? [288, 432] : 'A4', margin: 24, autoFirstPage: false });
  const chunks = [];
  const finished = new Promise((resolve, reject) => { doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  for (const label of result.labels) {
    const barcode = await bwipjs.toBuffer({ bcid: 'code128', text: label.code, scale: 3, height: 15, includetext: false });
    const qr = await bwipjs.toBuffer({ bcid: 'qrcode', text: label.code, scale: 3 });
    doc.addPage();
    drawCompanyLogo(doc, 24, 24, 32);
    doc.font('Helvetica-Bold').fontSize(23).fillColor('#5B2BC9').text('PURPLEBOX', 66, 30);
    doc.fontSize(12).fillColor('#111111').text(label.type.replaceAll('_', ' '), 24, 72);
    doc.fontSize(17).text(label.code, 24, 97, { width: 240 });
    doc.image(barcode, 24, 141, { fit: [240, 70] });
    doc.font('Helvetica').fontSize(11).text(label.code, 24, 222);
    doc.image(qr, 24, 250, { fit: [112, 112] });
    doc.fontSize(9).text('NOTHING MOVES WITHOUT A SCAN.', 24, 389);
  }
  doc.end();
  res.set('Cache-Control', 'private, no-store').set('Content-Disposition', 'inline; filename="purplebox-labels.pdf"').type('application/pdf').send(await finished);
}));

router.use((error, _req, res, _next) => {
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Photo must be under 8 MB.' });
  const status = error.status || (['ValidationError', 'CastError', 'MulterError'].includes(error.name) ? 400 : 500);
  if (status === 500) console.error('[warehouse]', error);
  res.status(status).json({ error: status === 500 ? 'Warehouse operation failed. Retry with the same request ID.' : error.message });
});

export default router;
