import { Router } from 'express';
import multer from 'multer';
import { SiteVisit, nextSiteVisitNo, MovingJob, nextMovingJobNo, Customer } from '../models/index.js';
import { uploadPublicImage } from '../services/drive.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
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
    const { visitDate, customerName, customerPhone, address, notes } = req.body;

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
      images,
      createdBy: req.user?.id || null,
      createdByName: req.user?.name || '',
    });

    res.status(201).json(visit);
  } catch (err) {
    res.status(400).json({ error: err.message });
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
    const { visitDate, customerName, customerPhone, address, notes } = req.body;
    const update = {};
    if (visitDate !== undefined) update.visitDate = new Date(visitDate);
    if (customerName !== undefined) update.customerName = customerName;
    if (customerPhone !== undefined) update.customerPhone = customerPhone;
    if (address !== undefined) update.address = address;
    if (notes !== undefined) update.notes = notes;

    const visit = await SiteVisit.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!visit) return res.status(404).json({ error: 'Site visit not found' });
    res.json(visit);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Add more images to a visit
router.post('/:id/images', upload.array('files', 20), async (req, res) => {
  try {
    const visit = await SiteVisit.findById(req.params.id);
    if (!visit) return res.status(404).json({ error: 'Site visit not found' });

    const newImages = [];
    for (const file of (req.files || [])) {
      try {
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
        console.error('[site-visit] Drive upload failed:', uploadErr.message);
      }
    }

    visit.images.push(...newImages);
    await visit.save();
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
      notes: `From site visit ${visit.visitNo}:\n${visit.notes}`,
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
