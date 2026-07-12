import { Router } from 'express';
import multer from 'multer';
import { MovingLead, MovingJob, MovingInvoice, Customer, nextMovingJobNo } from '../models/index.js';
import { requireCustomer } from './customerAuth.js';
import { uploadPublicImage } from '../services/drive.js';

const router = Router();
router.use(requireCustomer);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const SERVICE_TO_JOB_TYPE = {
  'Home / Apartment Shifting': 'local',
  'Villa Moving': 'local',
  'Office Relocation': 'office',
  'Packing & Unpacking': 'other',
  'Single Item Move': 'local',
  'Furniture Delivery': 'other',
  'Home Shifting': 'local',
  'Office Moving': 'office',
  'Packing Only': 'other',
  'Single Items': 'local',
  'Storage': 'storage_to_home',
  'Furniture Delivery': 'other',
};

router.post('/request-move', upload.array('images', 20), async (req, res) => {
  try {
    const { serviceType, propertyType, pickupAddress, pickupFloor, pickupElevator, deliveryAddress, deliveryFloor, deliveryElevator, moveDate, timeSlot, notes, instructions, customerName, customerEmail } = req.body;

    if (customerName || customerEmail) {
      const update = {};
      if (customerName) update.fullName = customerName;
      if (customerEmail) update.email = customerEmail;
      await Customer.findByIdAndUpdate(req.customer.customerId, update);
    }

    const jobNo = await nextMovingJobNo();
    const notesText = [
      serviceType ? `Service: ${serviceType}` : '',
      propertyType ? `Property: ${propertyType}` : '',
      pickupFloor ? `Pickup floor: ${pickupFloor}${pickupElevator === 'true' || pickupElevator === true ? ' (elevator)' : ''}` : '',
      deliveryFloor ? `Delivery floor: ${deliveryFloor}${deliveryElevator === 'true' || deliveryElevator === true ? ' (elevator)' : ''}` : '',
      instructions || '',
      notes || '',
    ].filter(Boolean).join('\n');

    const customerObj = await Customer.findById(req.customer.customerId).lean();
    const customerFolder = customerObj?.fullName || customerName || req.customer.phone;
    const images = [];
    for (const file of (req.files || [])) {
      const result = await uploadPublicImage({
        buffer: file.buffer,
        mimeType: file.mimetype,
        filename: `move-${Date.now()}-${file.originalname}`,
        customerName: customerFolder,
      });
      images.push({
        url: result.url,
        filename: file.originalname.replace(/\s+/g, '_'),
        originalName: file.originalname,
        size: file.size,
        category: 'Customer Upload',
        storage: result.storage,
        driveFileId: result.driveFileId || '',
      });
    }

    const lead = await MovingLead.create({
      customer: req.customer.customerId,
      prospectName: customerName || req.customer.phone,
      prospectPhone: req.customer.phone,
      prospectEmail: customerEmail || '',
      source: 'web_form',
      status: 'new',
      serviceType: serviceType || '',
      propertyType: propertyType || '',
      moveDate: moveDate || undefined,
      pickupAddress: pickupAddress || '',
      deliveryAddress: deliveryAddress || '',
      notes: notesText,
      images,
      timeline: [{ text: 'Customer submitted move request via app', at: new Date() }],
    });

    const job = await MovingJob.create({
      jobNo,
      customer: req.customer.customerId,
      lead: lead._id,
      status: 'draft',
      jobType: SERVICE_TO_JOB_TYPE[serviceType] || 'local',
      pickupAddress: pickupAddress || '',
      pickupFloor: pickupFloor || '',
      pickupHasElevator: pickupElevator === 'true' || pickupElevator === true,
      deliveryAddress: deliveryAddress || '',
      deliveryFloor: deliveryFloor || '',
      deliveryHasElevator: deliveryElevator === 'true' || deliveryElevator === true,
      scheduledDate: moveDate || undefined,
      scheduledTimeSlot: timeSlot || '',
      notes: notesText,
      clientPackage: {
        packageType: propertyType ? propertyType.toLowerCase().replace(/\s+/g, '_') : '',
        label: propertyType || serviceType || '',
      },
      images,
      timeline: [{ text: 'Customer submitted move request via app', at: new Date() }],
    });
    res.status(201).json({ job, lead });
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
    const job = await MovingJob.findOne({ _id: id, customer: customerId }).populate('customer', 'fullName');
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const customerFolder = job.customer?.fullName || 'MovingCustomers';
    const images = [];
    for (const file of (req.files || [])) {
      const result = await uploadPublicImage({
        buffer: file.buffer,
        mimeType: file.mimetype,
        filename: `job-${job.jobNo || id}-${Date.now()}-${file.originalname}`,
        customerName: customerFolder,
      });
      images.push({
        url: result.url,
        filename: file.originalname.replace(/\s+/g, '_'),
        originalName: file.originalname,
        size: file.size,
        category,
        storage: result.storage,
        driveFileId: result.driveFileId || '',
      });
    }
    job.images.push(...images);
    await job.save();
    res.json({ images });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/invoices', async (req, res) => {
  try {
    const invoices = await MovingInvoice.find({ customer: req.customer.customerId }).sort({ createdAt: -1 }).lean();
    res.json({ invoices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/invoices/:id', async (req, res) => {
  try {
    const invoice = await MovingInvoice.findOne({ _id: req.params.id, customer: req.customer.customerId }).lean();
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ invoice });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
