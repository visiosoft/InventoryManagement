import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { MovingLead, MovingJob, MovingInvoice } from '../models/index.js';
import { requireCustomer } from './customerAuth.js';

const router = Router();

router.use(requireCustomer);

const storage = multer.diskStorage({
  destination: (req, _file, cb) => cb(null, path.join(process.cwd(), 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `customer-${Date.now()}-${Math.round(Math.random() * 1e4)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

router.post('/request-move', async (req, res) => {
  try {
    const {
      propertyType, propertySize, moveDate, notes,
      pickupAddress, deliveryAddress, instructions,
    } = req.body;

    const lead = await MovingLead.create({
      customer: req.customer.customerId,
      prospectPhone: req.customer.phone,
      source: 'web_form',
      status: 'new',
      moveDate: moveDate || undefined,
      pickupAddress: pickupAddress || '',
      deliveryAddress: deliveryAddress || '',
      notes: [
        propertyType ? `Property: ${propertyType}` : '',
        propertySize ? `Size: ${propertySize}` : '',
        instructions || '',
        notes || '',
      ].filter(Boolean).join('\n'),
      timeline: [{ action: 'Customer submitted move request', date: new Date() }],
    });

    res.status(201).json({ lead });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/moves', async (req, res) => {
  try {
    const customerId = req.customer.customerId;
    const [leads, jobs] = await Promise.all([
      MovingLead.find({ customer: customerId }).sort({ createdAt: -1 }).lean(),
      MovingJob.find({ customer: customerId }).sort({ scheduledDate: -1 }).lean(),
    ]);
    res.json({ leads, jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/moves/:id', async (req, res) => {
  try {
    const customerId = req.customer.customerId;
    const { id } = req.params;

    let doc = await MovingJob.findOne({ _id: id, customer: customerId }).lean();
    if (doc) return res.json({ type: 'job', data: doc });

    doc = await MovingLead.findOne({ _id: id, customer: customerId }).lean();
    if (doc) return res.json({ type: 'lead', data: doc });

    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/moves/:id/photos', upload.array('images', 20), async (req, res) => {
  try {
    const customerId = req.customer.customerId;
    const { id } = req.params;
    const category = req.body.category || 'Customer Upload';

    const job = await MovingJob.findOne({ _id: id, customer: customerId });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const images = (req.files || []).map((f) => ({
      url: `/uploads/${f.filename}`,
      filename: f.filename,
      originalName: f.originalname,
      size: f.size,
      category,
    }));

    job.images.push(...images);
    await job.save();
    res.json({ images });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/invoices', async (req, res) => {
  try {
    const invoices = await MovingInvoice.find({ customer: req.customer.customerId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ invoices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/invoices/:id', async (req, res) => {
  try {
    const invoice = await MovingInvoice.findOne({
      _id: req.params.id,
      customer: req.customer.customerId,
    }).lean();
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ invoice });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
