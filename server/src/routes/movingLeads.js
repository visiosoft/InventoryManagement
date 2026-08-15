import { Router } from 'express';
import { MovingLead, MovingJob, Customer, nextMovingJobNo } from '../models/index.js';

const router = Router();

// Sales reps only ever see/touch leads assigned to them — enforced server-side.
function isSalesRep(req) {
  return req.user?.role === 'sales_rep';
}
function ownsLead(req, lead) {
  return String(lead.owner?._id || lead.owner || '') === String(req.user.id);
}

// ── Public endpoint for WordPress landing pages (no auth) ────────────────────
export const publicLeadRouter = Router();

publicLeadRouter.post('/', async (req, res) => {
  try {
    const b = req.body;
    const isMoving = /moving/i.test(b.storing_for || '') || /moving/i.test(b.unit_label || '');
    const serviceType = isMoving ? 'moving' : 'storage';

    const notes = [
      b.summary_text,
      b.unit_size ? `Unit size: ${b.unit_size}` : '',
      b.unit_label ? `Label: ${b.unit_label}` : '',
      b.emirate ? `Emirate: ${b.emirate}` : '',
      b.promo_code ? `Promo: ${b.promo_code}` : '',
      b.monthly_rent && Number(b.monthly_rent) ? `Monthly rent: AED ${b.monthly_rent}` : '',
      b.supplies_text && b.supplies_text !== 'No supplies selected' ? `Supplies: ${b.supplies_text}` : '',
      b.due_today && Number(b.due_today) ? `Due today: AED ${b.due_today}` : '',
    ].filter(Boolean).join('\n');

    const lead = await MovingLead.create({
      prospectName: b.full_name || '',
      prospectPhone: b.mobile || '',
      prospectEmail: b.email || '',
      source: 'web_form',
      status: 'new',
      serviceType: b.storing_for || serviceType,
      moveDate: b.move_in_date ? new Date(b.move_in_date) : undefined,
      notes,
      timeline: [{
        text: `Lead from ${b.source_page_name || 'Landing page'}`,
        author: 'Website',
        at: new Date(),
      }],
    });

    res.status(201).json({ ok: true, id: lead._id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

// List leads
router.get('/', async (req, res) => {
  try {
    const { status, q, owner } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (owner) filter.owner = owner;
    if (isSalesRep(req)) filter.owner = req.user.id;
    if (q) {
      filter.$or = [
        { prospectName: { $regex: q, $options: 'i' } },
        { prospectPhone: { $regex: q, $options: 'i' } },
      ];
    }
    const leads = await MovingLead.find(filter)
      .populate('customer', 'fullName phone email')
      .populate('owner', 'name email')
      .sort({ createdAt: -1 });
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create lead
router.post('/', async (req, res) => {
  try {
    const body = isSalesRep(req) ? { ...req.body, owner: req.user.id } : req.body;
    const lead = await MovingLead.create(body);
    res.status(201).json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get lead
router.get('/:id', async (req, res) => {
  try {
    const lead = await MovingLead.findById(req.params.id).populate('customer', 'fullName phone email address').populate('owner', 'name email');
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (isSalesRep(req) && !ownsLead(req, lead)) return res.status(403).json({ error: 'Not your lead' });
    const obj = lead.toObject();
    const job = await MovingJob.findOne({ lead: lead._id }).select('images _id jobNo').lean();
    if (job?.images?.length && !obj.images?.length) {
      obj.images = job.images;
    } else if (job?.images?.length && obj.images?.length) {
      const existingUrls = new Set(obj.images.map(i => i.url));
      for (const img of job.images) {
        if (!existingUrls.has(img.url)) obj.images.push(img);
      }
    }
    if (job) obj.linkedJob = { _id: job._id, jobNo: job.jobNo };
    res.json(obj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update lead
router.put('/:id', async (req, res) => {
  try {
    if (isSalesRep(req)) {
      const existing = await MovingLead.findById(req.params.id).select('owner');
      if (!existing) return res.status(404).json({ error: 'Lead not found' });
      if (!ownsLead(req, existing)) return res.status(403).json({ error: 'Not your lead' });
    }
    const body = isSalesRep(req) ? { ...req.body, owner: req.user.id } : req.body;
    const lead = await MovingLead.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true })
      .populate('customer', 'fullName phone email')
      .populate('owner', 'name email');
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Patch status
router.patch('/:id/status', async (req, res) => {
  try {
    if (isSalesRep(req)) {
      const existing = await MovingLead.findById(req.params.id).select('owner');
      if (!existing) return res.status(404).json({ error: 'Lead not found' });
      if (!ownsLead(req, existing)) return res.status(403).json({ error: 'Not your lead' });
    }
    const { status } = req.body;
    const lead = await MovingLead.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Add timeline note
router.post('/:id/notes', async (req, res) => {
  try {
    if (isSalesRep(req)) {
      const existing = await MovingLead.findById(req.params.id).select('owner');
      if (!existing) return res.status(404).json({ error: 'Lead not found' });
      if (!ownsLead(req, existing)) return res.status(403).json({ error: 'Not your lead' });
    }
    const { text, author } = req.body;
    const lead = await MovingLead.findByIdAndUpdate(
      req.params.id,
      { $push: { timeline: { text, author, at: new Date() } } },
      { new: true }
    );
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead.timeline);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete timeline note by index
router.delete('/:id/notes/:idx', async (req, res) => {
  try {
    const lead = await MovingLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (isSalesRep(req) && !ownsLead(req, lead)) return res.status(403).json({ error: 'Not your lead' });
    const idx = Number(req.params.idx);
    if (idx < 0 || idx >= lead.timeline.length) return res.status(400).json({ error: 'Invalid index' });
    lead.timeline.splice(idx, 1);
    await lead.save();
    res.json(lead.timeline);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send quote to lead
router.patch('/:id/quote', async (req, res) => {
  try {
    if (isSalesRep(req)) {
      const existing = await MovingLead.findById(req.params.id).select('owner');
      if (!existing) return res.status(404).json({ error: 'Lead not found' });
      if (!ownsLead(req, existing)) return res.status(403).json({ error: 'Not your lead' });
    }
    const { items, discount, notes, quotedBy } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'At least one quote item is required' });
    const subTotal = items.reduce((sum, it) => sum + (it.amount || it.qty * it.rate), 0);
    const total = Math.max(0, subTotal - (discount || 0));
    const quotation = {
      items: items.map(it => ({ description: it.description, qty: it.qty || 1, rate: it.rate || 0, amount: it.amount || it.qty * it.rate })),
      subTotal,
      discount: discount || 0,
      total,
      notes: notes || '',
      quotedAt: new Date(),
      quotedBy: quotedBy || '',
    };
    const lead = await MovingLead.findByIdAndUpdate(
      req.params.id,
      {
        quotation,
        status: 'quoted',
        $push: { timeline: { text: `Quote sent — AED ${total.toLocaleString()}`, author: quotedBy || 'System', at: new Date() } },
      },
      { new: true }
    ).populate('customer', 'fullName phone email');
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Convert lead to job
router.post('/:id/convert', async (req, res) => {
  try {
    const lead = await MovingLead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (isSalesRep(req) && !ownsLead(req, lead)) return res.status(403).json({ error: 'Not your lead' });

    const jobNo = await nextMovingJobNo();
    const job = await MovingJob.create({
      jobNo,
      customer: lead.customer || req.body.customer,
      lead: lead._id,
      pickupAddress: lead.pickupAddress,
      deliveryAddress: lead.deliveryAddress,
      scheduledDate: lead.moveDate,
      status: 'draft',
      notes: lead.notes,
    });

    await MovingLead.findByIdAndUpdate(lead._id, { status: 'won' });

    res.status(201).json(job);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete lead
router.delete('/:id', async (req, res) => {
  try {
    if (isSalesRep(req)) return res.status(403).json({ error: 'Sales reps cannot delete leads' });
    await MovingLead.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
