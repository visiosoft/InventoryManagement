import { Router } from 'express';
import { Lead, User } from '../models/index.js';

const router = Router();

const ALLOWED_STATUS = new Set(['new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost']);
const ALLOWED_SOURCE = new Set(['manual', 'google_contacts', 'whatsapp', 'referral', 'walk_in', 'other']);
const ALLOWED_DURATION_UNIT = new Set(['week', 'month']);

function normalizePhone(input) {
    return String(input || '').replace(/\D/g, '');
}

function escRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function cleanBody(body) {
    return {
        fullName: String(body.fullName || '').trim(),
        email: String(body.email || '').trim(),
        phone: String(body.phone || '').trim(),
        status: String(body.status || 'new').trim(),
        source: String(body.source || 'manual').trim(),
        leadDateTime: body.leadDateTime,
        storageSizeValue: Number(body.storageSizeValue),
        storageSizeUnit: String(body.storageSizeUnit || 'sqft').trim(),
        durationValue: Number(body.durationValue),
        durationUnit: String(body.durationUnit || '').trim(),
        owner: String(body.owner || ''),
        unitsNeeded: Number(body.unitsNeeded),
        notes: String(body.notes || '').trim(),
    };
}

async function validateOwner(ownerId) {
    const owner = await User.findById(ownerId).select('_id');
    return Boolean(owner);
}

router.get('/', async (req, res) => {
    const filter = {};
    if (req.query.status && ALLOWED_STATUS.has(String(req.query.status))) {
        filter.status = String(req.query.status);
    }
    if (req.query.source && ALLOWED_SOURCE.has(String(req.query.source))) {
        filter.source = String(req.query.source);
    }
    if (req.query.owner) filter.owner = String(req.query.owner);

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (from || to) {
        filter.leadDateTime = {};
        if (from) filter.leadDateTime.$gte = from;
        if (to) filter.leadDateTime.$lte = to;
    }

    if (req.query.search) {
        const re = new RegExp(escRegex(String(req.query.search)), 'i');
        filter.$or = [{ fullName: re }, { email: re }, { phone: re }, { notes: re }];
    }

    const leads = await Lead.find(filter).populate('owner', 'name email').sort({ leadDateTime: -1, createdAt: -1 });
    res.json(leads);
});

router.get('/:id', async (req, res) => {
    const lead = await Lead.findById(req.params.id).populate('owner', 'name email');
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json(lead);
});

router.post('/', async (req, res) => {
    const body = cleanBody(req.body || {});
    if (!body.fullName) return res.status(400).json({ error: 'Full name is required' });
    if (!body.phone) return res.status(400).json({ error: 'Phone is required' });
    if (!ALLOWED_STATUS.has(body.status)) return res.status(400).json({ error: 'Invalid lead status' });
    if (!ALLOWED_SOURCE.has(body.source)) return res.status(400).json({ error: 'Invalid lead source' });
    if (!ALLOWED_DURATION_UNIT.has(body.durationUnit)) return res.status(400).json({ error: 'Invalid duration unit' });
    if (!Number.isFinite(body.storageSizeValue) || body.storageSizeValue < 0) return res.status(400).json({ error: 'Invalid storage size' });
    if (!Number.isFinite(body.durationValue) || body.durationValue < 1) return res.status(400).json({ error: 'Invalid duration value' });
    if (!Number.isFinite(body.unitsNeeded) || body.unitsNeeded < 1) return res.status(400).json({ error: 'Invalid units needed' });

    const ownerId = body.owner || req.user.id;
    if (!(await validateOwner(ownerId))) return res.status(400).json({ error: 'Lead owner not found' });

    const phoneNormalized = normalizePhone(body.phone);
    if (!phoneNormalized) return res.status(400).json({ error: 'Phone must contain at least one digit' });

    const leadDateTime = parseDate(body.leadDateTime) || new Date();

    const existing = await Lead.findOne({ phoneNormalized });
    if (existing) return res.status(409).json({ error: 'Lead already exists for this phone number' });

    const lead = await Lead.create({
        ...body,
        owner: ownerId,
        leadDateTime,
        phoneNormalized,
        timeline: [{ type: 'created', text: `Lead created by ${req.user.name || req.user.email || 'user'}` }],
    });

    res.status(201).json(await lead.populate('owner', 'name email'));
});

router.put('/:id', async (req, res) => {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const body = cleanBody({ ...lead.toObject(), ...req.body });
    if (!body.fullName) return res.status(400).json({ error: 'Full name is required' });
    if (!body.phone) return res.status(400).json({ error: 'Phone is required' });
    if (!ALLOWED_STATUS.has(body.status)) return res.status(400).json({ error: 'Invalid lead status' });
    if (!ALLOWED_SOURCE.has(body.source)) return res.status(400).json({ error: 'Invalid lead source' });
    if (!ALLOWED_DURATION_UNIT.has(body.durationUnit)) return res.status(400).json({ error: 'Invalid duration unit' });
    if (!Number.isFinite(body.storageSizeValue) || body.storageSizeValue < 0) return res.status(400).json({ error: 'Invalid storage size' });
    if (!Number.isFinite(body.durationValue) || body.durationValue < 1) return res.status(400).json({ error: 'Invalid duration value' });
    if (!Number.isFinite(body.unitsNeeded) || body.unitsNeeded < 1) return res.status(400).json({ error: 'Invalid units needed' });

    const ownerId = body.owner || req.user.id;
    if (!(await validateOwner(ownerId))) return res.status(400).json({ error: 'Lead owner not found' });

    const phoneNormalized = normalizePhone(body.phone);
    if (!phoneNormalized) return res.status(400).json({ error: 'Phone must contain at least one digit' });

    const duplicate = await Lead.findOne({ phoneNormalized, _id: { $ne: lead._id } }).select('_id');
    if (duplicate) return res.status(409).json({ error: 'Another lead already uses this phone number' });

    lead.fullName = body.fullName;
    lead.email = body.email;
    lead.phone = body.phone;
    lead.phoneNormalized = phoneNormalized;
    lead.status = body.status;
    lead.source = body.source;
    lead.leadDateTime = parseDate(body.leadDateTime) || lead.leadDateTime;
    lead.storageSizeValue = body.storageSizeValue;
    lead.storageSizeUnit = body.storageSizeUnit;
    lead.durationValue = body.durationValue;
    lead.durationUnit = body.durationUnit;
    lead.owner = ownerId;
    lead.unitsNeeded = body.unitsNeeded;
    lead.notes = body.notes;
    lead.timeline.push({ type: 'updated', text: `Lead updated by ${req.user.name || req.user.email || 'user'}` });

    await lead.save();
    res.json(await lead.populate('owner', 'name email'));
});

router.patch('/:id/status', async (req, res) => {
    const status = String(req.body?.status || '');
    if (!ALLOWED_STATUS.has(status)) return res.status(400).json({ error: 'Invalid lead status' });

    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    lead.status = status;
    lead.timeline.push({ type: 'status_changed', text: `Status changed to ${status}` });
    await lead.save();

    res.json(await lead.populate('owner', 'name email'));
});

router.delete('/:id', async (req, res) => {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ ok: true });
});

export function normalizeLeadPhone(input) {
    return normalizePhone(input);
}

export default router;
