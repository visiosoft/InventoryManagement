import { Router } from 'express';
import multer from 'multer';
import { MovingLead, MovingJob, MovingInvoice, Customer, nextMovingJobNo } from '../models/index.js';
import { requireCustomer } from './customerAuth.js';
import { uploadPublicImage } from '../services/drive.js';

const router = Router();
router.use(requireCustomer);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const uploadLarge = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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
    console.log('[request-move] files received:', req.files?.length || 0, req.files?.map(f => ({ name: f.originalname, size: f.size, mime: f.mimetype })));
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
    const customerFolder = `${customerObj?.fullName || customerName || req.customer.phone} - ${jobNo}`;
    const images = [];
    for (const file of (req.files || [])) {
      console.log('[request-move] uploading to Drive:', file.originalname, file.size, 'bytes');
      try {
        const result = await uploadPublicImage({
          buffer: file.buffer,
          mimeType: file.mimetype,
          filename: `move-${Date.now()}-${file.originalname}`,
          customerName: customerFolder,
        });
        console.log('[request-move] Drive upload OK:', result.url);
        images.push({
          url: result.url,
          filename: file.originalname.replace(/\s+/g, '_'),
          originalName: file.originalname,
          size: file.size,
          category: 'Customer Upload',
          storage: result.storage,
          driveFileId: result.driveFileId || '',
        });
      } catch (uploadErr) {
        console.error('[request-move] Drive upload FAILED:', uploadErr.message);
      }
    }
    console.log('[request-move] total images saved:', images.length);

    const lead = await MovingLead.create({
      customer: req.customer.customerId,
      prospectName: customerName || req.customer.phone,
      prospectPhone: req.customer.phone,
      prospectEmail: customerEmail || '',
      source: 'mobile_app',
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
    const leadMap = new Map(leads.map(l => [l._id.toString(), l]));
    const linkedLeadIds = new Set();
    const enrichedJobs = jobs.map(j => {
      if (!j.lead) return j;
      const leadId = j.lead.toString();
      linkedLeadIds.add(leadId);
      const lead = leadMap.get(leadId);
      if (!lead) return j;
      if (lead.quotation?.total > 0 && !j.quotation?.total) {
        j.quotation = lead.quotation;
      }
      if (lead.serviceType && !j.serviceType) j.serviceType = lead.serviceType;
      return j;
    });
    const filteredLeads = leads.filter(l => !linkedLeadIds.has(l._id.toString()));
    res.json({ leads: filteredLeads, jobs: enrichedJobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/moves/:id', async (req, res) => {
  try {
    const customerId = req.customer.customerId;
    const { id } = req.params;
    let doc = await MovingJob.findOne({ _id: id, customer: customerId }).lean();
    if (doc) {
      if (doc.lead) {
        const lead = await MovingLead.findById(doc.lead).lean();
        if (lead?.quotation?.total > 0 && !doc.quotation?.total) {
          doc.quotation = lead.quotation;
        }
        if (lead?.serviceType && !doc.serviceType) doc.serviceType = lead.serviceType;
      }
      return res.json({ type: 'job', data: doc });
    }
    doc = await MovingLead.findOne({ _id: id, customer: customerId }).lean();
    if (doc) return res.json({ type: 'lead', data: doc });
    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/moves/:id/accept-quote', async (req, res) => {
  try {
    const customerId = req.customer.customerId;
    const { id } = req.params;
    const job = await MovingJob.findOne({ _id: id, customer: customerId });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.status === 'draft') {
      job.status = 'confirmed';
      job.timeline.push({ text: 'Customer accepted quote via app', at: new Date() });
      await job.save();
    }

    if (job.lead) {
      await MovingLead.findByIdAndUpdate(job.lead, {
        status: 'client_approved',
        $push: { timeline: { text: 'Customer accepted quote via app', at: new Date() } },
      });
    }

    res.json({ ok: true, jobStatus: job.status });
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
    const customerFolder = `${job.customer?.fullName || 'MovingCustomers'} - ${job.jobNo || id}`;
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
    if (job.lead) {
      await MovingLead.findByIdAndUpdate(job.lead, { $push: { images: { $each: images } } });
    }
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

// ── Client Visits ──────────────────────────────────────────────

router.get('/moves/:id/visits', async (req, res) => {
  try {
    const job = await MovingJob.findOne({ _id: req.params.id, customer: req.customer.customerId }).lean();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const visits = (job.clientVisits || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ visits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/moves/:id/visits', uploadLarge.array('files', 20), async (req, res) => {
  try {
    const job = await MovingJob.findOne({ _id: req.params.id, customer: req.customer.customerId }).populate('customer', 'fullName');
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const customerFolder = `${job.customer?.fullName || 'MovingCustomers'} - ${job.jobNo || req.params.id}`;
    const images = [];
    for (const file of (req.files || [])) {
      try {
        const result = await uploadPublicImage({
          buffer: file.buffer,
          mimeType: file.mimetype,
          filename: `visit-${job.jobNo || req.params.id}-${Date.now()}-${file.originalname}`,
          customerName: customerFolder,
        });
        images.push({
          url: result.url,
          filename: file.originalname.replace(/\s+/g, '_'),
          originalName: file.originalname,
          size: file.size,
          category: 'Client Visit',
          storage: result.storage,
          driveFileId: result.driveFileId || '',
        });
      } catch (uploadErr) {
        console.error('[client-visit] Drive upload failed:', uploadErr.message);
      }
    }

    const visit = {
      notes: req.body.notes || '',
      images,
      createdAt: new Date(),
    };
    job.clientVisits.push(visit);
    if (images.length) job.images.push(...images);
    await job.save();

    const created = job.clientVisits[job.clientVisits.length - 1];
    res.status(201).json({ visit: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/moves/:id/visits/:visitId', async (req, res) => {
  try {
    const job = await MovingJob.findOne({ _id: req.params.id, customer: req.customer.customerId });
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const visit = job.clientVisits.id(req.params.visitId);
    if (!visit) return res.status(404).json({ error: 'Visit not found' });

    visit.deleteOne();
    await job.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
