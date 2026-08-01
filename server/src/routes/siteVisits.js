import { Router } from 'express';
import multer from 'multer';
import { SiteVisit, nextSiteVisitNo, MovingJob, nextMovingJobNo, Customer } from '../models/index.js';
import { uploadPublicImage, driveClient, driveConfigured } from '../services/drive.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const router = Router();

// List all site visits (newest first, paginated, searchable)
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const filter = {};
    if (search) {
      filter.$or = [
        { visitNo: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [visits, total] = await Promise.all([
      SiteVisit.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      SiteVisit.countDocuments(filter),
    ]);
    res.json({ visits, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new site visit
router.post('/', upload.array('files', 20), async (req, res) => {
  try {
    const visitNo = await nextSiteVisitNo();
    const { visitDate, customerName, customerPhone, address, notes, items } = req.body;

    const images = [];
    for (const file of (req.files || [])) {
      try {
        const result = await uploadPublicImage({
          buffer: file.buffer,
          mimeType: file.mimetype,
          filename: `site-visit-${visitNo}-${Date.now()}-${file.originalname}`,
          customerName: customerName || 'SiteVisits',
        });
        images.push({
          url: result.url,
          filename: file.originalname.replace(/\s+/g, '_'),
          originalName: file.originalname,
          size: file.size,
          category: 'Site Visit',
          storage: result.storage,
          driveFileId: result.driveFileId || '',
          uploadedAt: new Date(),
        });
      } catch (uploadErr) {
        console.error('[site-visit] Drive upload failed:', uploadErr.message);
      }
    }

    const visit = await SiteVisit.create({
      visitNo,
      visitDate: visitDate ? new Date(visitDate) : new Date(),
      customerName: customerName || '',
      customerPhone: customerPhone || '',
      address: address || '',
      notes: notes || '',
      items: items ? JSON.parse(items) : [],
      images,
      createdBy: req.user?.id || null,
      createdByName: req.user?.name || '',
    });

    res.status(201).json(visit);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// In-memory cache for Drive files to avoid re-downloading on every range request
const driveCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

// Stream a Drive file (video/image) through the server — must be before /:id
router.get('/drive-stream/:fileId', async (req, res) => {
  try {
    if (!driveConfigured()) return res.status(501).json({ error: 'Drive not configured' });
    const fileId = req.params.fileId;
    const drive = driveClient();

    let cached = driveCache.get(fileId);
    if (!cached || Date.now() - cached.ts > CACHE_TTL) {
      console.log('[drive-stream] downloading', fileId);
      const meta = await drive.files.get({ fileId, fields: 'mimeType,size,name' });
      const mimeType = meta.data.mimeType || 'application/octet-stream';

      const { data } = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer', timeout: 120000 }
      );
      const buffer = Buffer.from(data);
      cached = { buffer, mimeType, ts: Date.now() };
      driveCache.set(fileId, cached);
      // evict old entries
      if (driveCache.size > 20) {
        const oldest = [...driveCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        if (oldest) driveCache.delete(oldest[0]);
      }
    }

    const { buffer, mimeType } = cached;
    const total = buffer.length;

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': mimeType,
      });
      res.end(buffer.subarray(start, end + 1));
    } else {
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': total,
        'Accept-Ranges': 'bytes',
      });
      res.end(buffer);
    }
  } catch (err) {
    console.error('[drive-stream]', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to stream file' });
  }
});

// Get single visit
router.get('/:id', async (req, res) => {
  try {
    const visit = await SiteVisit.findById(req.params.id);
    if (!visit) return res.status(404).json({ error: 'Site visit not found' });
    res.json(visit);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update visit fields (no file handling)
router.put('/:id', async (req, res) => {
  try {
    const { visitDate, customerName, customerPhone, address, notes, items } = req.body;
    const update = {};
    if (visitDate !== undefined) update.visitDate = new Date(visitDate);
    if (customerName !== undefined) update.customerName = customerName;
    if (customerPhone !== undefined) update.customerPhone = customerPhone;
    if (address !== undefined) update.address = address;
    if (notes !== undefined) update.notes = notes;
    if (items !== undefined) update.items = typeof items === 'string' ? JSON.parse(items) : items;

    const visit = await SiteVisit.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!visit) return res.status(404).json({ error: 'Site visit not found' });
    res.json(visit);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Add more images to a visit
router.post('/:id/images', upload.array('files', 20), async (req, res) => {
  req.setTimeout(300000);
  try {
    const visit = await SiteVisit.findById(req.params.id);
    if (!visit) return res.status(404).json({ error: 'Site visit not found' });

    const newImages = [];
    const errors = [];
    for (const file of (req.files || [])) {
      try {
        console.log(`[site-visit] Uploading ${file.originalname} (${(file.size / 1024 / 1024).toFixed(1)}MB, ${file.mimetype})`);
        const result = await uploadPublicImage({
          buffer: file.buffer,
          mimeType: file.mimetype,
          filename: `site-visit-${visit.visitNo}-${Date.now()}-${file.originalname}`,
          customerName: visit.customerName || 'SiteVisits',
        });
        newImages.push({
          url: result.url,
          filename: file.originalname.replace(/\s+/g, '_'),
          originalName: file.originalname,
          size: file.size,
          category: 'Site Visit',
          storage: result.storage,
          driveFileId: result.driveFileId || '',
          uploadedAt: new Date(),
        });
      } catch (uploadErr) {
        console.error('[site-visit] Drive upload failed for', file.originalname, ':', uploadErr.message);
        errors.push(`${file.originalname}: ${uploadErr.message}`);
      }
    }

    visit.images.push(...newImages);
    await visit.save();
    if (errors.length > 0 && newImages.length === 0) {
      return res.status(500).json({ error: `Upload failed: ${errors.join('; ')}` });
    }
    res.json(visit.images);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove an image by index
router.delete('/:id/images/:idx', async (req, res) => {
  try {
    const visit = await SiteVisit.findById(req.params.id);
    if (!visit) return res.status(404).json({ error: 'Site visit not found' });

    const idx = Number(req.params.idx);
    if (idx < 0 || idx >= visit.images.length) return res.status(400).json({ error: 'Invalid index' });

    visit.images.splice(idx, 1);
    await visit.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Convert visit to a moving job
router.post('/:id/convert-to-job', async (req, res) => {
  try {
    const visit = await SiteVisit.findById(req.params.id);
    if (!visit) return res.status(404).json({ error: 'Site visit not found' });
    if (visit.linkedJob) return res.status(400).json({ error: 'Visit is already linked to a job' });

    const { customerId } = req.body;
    if (!customerId) return res.status(400).json({ error: 'Customer ID is required' });

    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const jobNo = await nextMovingJobNo();
    const job = await MovingJob.create({
      jobNo,
      customer: customerId,
      status: 'draft',
      jobType: 'local',
      pickupAddress: visit.address || '',
      notes: `From site visit ${visit.visitNo}:\n${visit.notes}${visit.items?.length ? '\n\nItems: ' + visit.items.map(i => `${i.name}${i.qty > 1 ? ' x' + i.qty : ''}`).join(', ') : ''}`,
      images: visit.images.map(img => ({
        url: img.url,
        filename: img.filename,
        originalName: img.originalName,
        size: img.size,
        category: 'Site Visit',
        storage: img.storage,
        driveFileId: img.driveFileId || '',
      })),
      timeline: [{ text: `Job created from site visit ${visit.visitNo}`, at: new Date() }],
    });

    visit.linkedJob = job._id;
    await visit.save();

    res.status(201).json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a visit
router.delete('/:id', async (req, res) => {
  try {
    const visit = await SiteVisit.findById(req.params.id);
    if (!visit) return res.status(404).json({ error: 'Site visit not found' });
    await visit.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
