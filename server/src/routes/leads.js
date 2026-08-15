import { Router } from 'express';
import { Customer, Lead, User, WhatsAppMessage } from '../models/index.js';
import { mailConfigured, sendMail } from '../services/mail.js';

const router = Router();

const ALLOWED_STATUS = new Set(['new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost']);
const ALLOWED_SOURCE = new Set(['manual', 'whatsapp', 'referral', 'walk_in', 'other']);
const ALLOWED_DURATION_UNIT = new Set(['week', 'month']);

function normalizePhone(input) {
    let d = String(input || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    return d;
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
    const firstName = String(body.firstName || '').trim();
    const lastName = String(body.lastName || '').trim();
    const fullName = body.fullName
        ? String(body.fullName).trim()
        : [firstName, lastName].filter(Boolean).join(' ');
    return {
        firstName,
        lastName,
        fullName,
        email: String(body.email || '').trim(),
        phone: String(body.phone || '').trim(),
        whatsappNo: String(body.whatsappNo || '').trim(),
        preferredContact: String(body.preferredContact || 'whatsapp').trim(),
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

// Sales reps only ever see/touch leads assigned to them — enforced server-side
// so a rep can't widen their view via query params or a crafted request body.
function isSalesRep(req) {
    return req.user?.role === 'sales_rep';
}
function ownsLead(req, lead) {
    return String(lead.owner?._id || lead.owner) === String(req.user.id);
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
    if (isSalesRep(req)) filter.owner = req.user.id;

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (from || to) {
        filter.leadDateTime = {};
        if (from) filter.leadDateTime.$gte = from;
        if (to) filter.leadDateTime.$lte = to;
    }

    if (req.query.search) {
        const re = new RegExp(escRegex(String(req.query.search)), 'i');
        filter.$or = [{ fullName: re }, { firstName: re }, { lastName: re }, { email: re }, { phone: re }, { whatsappNo: re }, { notes: re }];
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 25), 500);
    const skip = (page - 1) * limit;

    // Exclude heavy subdocuments (timeline, comments) — the detail endpoint loads them.
    const [leads, total] = await Promise.all([
        Lead.find(filter)
            .select('-timeline -comments')
            .populate('owner', 'name email')
            .sort({ leadDateTime: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean()
            .allowDiskUse(true),
        Lead.countDocuments(filter),
    ]);
    res.json({ data: leads, total, page, pages: Math.ceil(total / limit), limit });
});

router.get('/:id', async (req, res) => {
    const lead = await Lead.findById(req.params.id)
        .populate('owner', 'name email')
        .populate('comments.user', 'name email');
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (isSalesRep(req) && !ownsLead(req, lead)) return res.status(403).json({ error: 'Not your lead' });
    res.json(lead);
});

router.post('/', async (req, res) => {
    const body = cleanBody(req.body || {});
    if (!body.firstName && !body.fullName) return res.status(400).json({ error: 'First name is required' });
    if (!body.phone) return res.status(400).json({ error: 'Phone is required' });
    if (!ALLOWED_STATUS.has(body.status)) return res.status(400).json({ error: 'Invalid lead status' });
    if (!ALLOWED_SOURCE.has(body.source)) return res.status(400).json({ error: 'Invalid lead source' });
    if (!ALLOWED_DURATION_UNIT.has(body.durationUnit)) return res.status(400).json({ error: 'Invalid duration unit' });
    if (!Number.isFinite(body.storageSizeValue) || body.storageSizeValue < 0) return res.status(400).json({ error: 'Invalid storage size' });
    if (!Number.isFinite(body.durationValue) || body.durationValue < 1) return res.status(400).json({ error: 'Invalid duration value' });
    if (!Number.isFinite(body.unitsNeeded) || body.unitsNeeded < 1) return res.status(400).json({ error: 'Invalid units needed' });

    const ownerId = isSalesRep(req) ? req.user.id : (body.owner || req.user.id);
    if (!(await validateOwner(ownerId))) return res.status(400).json({ error: 'Lead owner not found' });

    const phoneNormalized = normalizePhone(body.phone);
    if (!phoneNormalized) return res.status(400).json({ error: 'Phone must contain at least one digit' });

    const leadDateTime = parseDate(body.leadDateTime) || new Date();

    const existing = await Lead.findOne({ phoneNormalized });
    if (existing) return res.status(409).json({ error: 'Lead already exists for this phone number' });

    const userName = req.user.name || req.user.email || 'user';
    const lead = await Lead.create({
        ...body,
        owner: ownerId,
        leadDateTime,
        phoneNormalized,
        timeline: [{ type: 'created', text: `Lead created by ${userName}`, user: req.user.id }],
    });

    res.status(201).json(await lead.populate('owner', 'name email'));
});

router.put('/:id', async (req, res) => {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (isSalesRep(req) && !ownsLead(req, lead)) return res.status(403).json({ error: 'Not your lead' });

    const body = cleanBody({ ...lead.toObject(), ...req.body });
    if (!body.firstName && !body.fullName) return res.status(400).json({ error: 'First name is required' });
    if (!body.phone) return res.status(400).json({ error: 'Phone is required' });
    if (!ALLOWED_STATUS.has(body.status)) return res.status(400).json({ error: 'Invalid lead status' });
    if (!ALLOWED_SOURCE.has(body.source)) return res.status(400).json({ error: 'Invalid lead source' });
    if (!ALLOWED_DURATION_UNIT.has(body.durationUnit)) return res.status(400).json({ error: 'Invalid duration unit' });
    if (!Number.isFinite(body.storageSizeValue) || body.storageSizeValue < 0) return res.status(400).json({ error: 'Invalid storage size' });
    if (!Number.isFinite(body.durationValue) || body.durationValue < 1) return res.status(400).json({ error: 'Invalid duration value' });
    if (!Number.isFinite(body.unitsNeeded) || body.unitsNeeded < 1) return res.status(400).json({ error: 'Invalid units needed' });

    const ownerId = isSalesRep(req) ? req.user.id : (body.owner || req.user.id);
    if (!(await validateOwner(ownerId))) return res.status(400).json({ error: 'Lead owner not found' });

    const phoneNormalized = normalizePhone(body.phone);
    if (!phoneNormalized) return res.status(400).json({ error: 'Phone must contain at least one digit' });

    const duplicate = await Lead.findOne({ phoneNormalized, _id: { $ne: lead._id } }).select('_id');
    if (duplicate) return res.status(409).json({ error: 'Another lead already uses this phone number' });

    lead.firstName = body.firstName;
    lead.lastName = body.lastName;
    lead.fullName = body.fullName;
    lead.email = body.email;
    lead.phone = body.phone;
    lead.whatsappNo = body.whatsappNo;
    lead.phoneNormalized = phoneNormalized;
    lead.preferredContact = body.preferredContact;
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
    const userName = req.user.name || req.user.email || 'user';
    lead.timeline.push({ type: 'updated', text: `Lead updated by ${userName}`, user: req.user.id });

    await lead.save();
    res.json(await lead.populate('owner', 'name email'));
});

router.patch('/:id/status', async (req, res) => {
    const status = String(req.body?.status || '');
    if (!ALLOWED_STATUS.has(status)) return res.status(400).json({ error: 'Invalid lead status' });

    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (isSalesRep(req) && !ownsLead(req, lead)) return res.status(403).json({ error: 'Not your lead' });

    lead.status = status;
    lead.timeline.push({ type: 'status_changed', text: `Status changed to ${status}`, user: req.user.id });

    const comment = String(req.body?.comment || '').trim();
    if (comment) lead.timeline.push({ type: 'comment', text: comment, user: req.user.id });

    await lead.save();

    res.json(await lead.populate('owner', 'name email'));
});

router.post('/:id/convert', async (req, res) => {
    const lead = await Lead.findById(req.params.id).populate('owner', 'name email');
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (isSalesRep(req) && !ownsLead(req, lead)) return res.status(403).json({ error: 'Not your lead' });

    const normalizedLeadPhone = normalizePhone(lead.phone);
    const email = String(lead.email || '').trim().toLowerCase();

    const phoneCandidates = [
        String(lead.phone || '').trim(),
        normalizedLeadPhone,
        normalizedLeadPhone ? `+${normalizedLeadPhone}` : '',
    ].filter(Boolean);

    const existingCustomer = await Customer.findOne({
        $or: [
            ...(email ? [{ email }] : []),
            ...phoneCandidates.flatMap((p) => [{ phone: p }, { phones: p }]),
        ],
    });

    if (existingCustomer) {
        lead.status = 'won';
        lead.timeline.push({ type: 'converted', text: 'Lead converted to existing customer.', user: req.user.id });
        await lead.save();
        return res.json({
            ok: true,
            created: false,
            customer: existingCustomer,
        });
    }

    const customerPhones = Array.from(new Set(phoneCandidates));

    const customer = await Customer.create({
        fullName: lead.fullName,
        email,
        phone: String(lead.phone || '').trim(),
        phones: customerPhones,
        notes: lead.notes || '',
        company: '',
        address: '',
        emergencyNumber: '',
        tenantType: 'individual',
    });

    lead.status = 'won';
    lead.timeline.push({ type: 'converted', text: 'Lead converted to new customer.', user: req.user.id });
    await lead.save();

    res.json({
        ok: true,
        created: true,
        customer,
    });
});

router.post('/:id/send-email', async (req, res) => {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (isSalesRep(req) && !ownsLead(req, lead)) return res.status(403).json({ error: 'Not your lead' });
    if (!mailConfigured()) return res.status(400).json({ error: 'SMTP not configured — set SMTP_PASS in server/.env' });

    const to = String(req.body?.to || lead.email || '').trim();
    if (!to) return res.status(400).json({ error: 'Lead has no email address' });
    const subject = String(req.body?.subject || '').trim() || `Following up — PurpleBox`;
    const bodyText = String(req.body?.body || '').trim();
    if (!bodyText) return res.status(400).json({ error: 'Email body is required' });

    try {
        await sendMail({ to, subject, text: bodyText, html: bodyText.replace(/\n/g, '<br/>') });
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to send email' });
    }

    const userName = req.user.name || req.user.email || 'user';
    lead.timeline.push({ type: 'email', text: `Emailed: "${subject}" by ${userName}`, user: req.user.id });
    await lead.save();

    res.json({ ok: true });
});

router.post('/:id/comments', async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Comment text is required' });

    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (isSalesRep(req) && !ownsLead(req, lead)) return res.status(403).json({ error: 'Not your lead' });

    const userName = req.user.name || req.user.email || 'user';
    lead.comments.push({ user: req.user.id, userName, text });
    lead.timeline.push({ type: 'comment', text, user: req.user.id });
    await lead.save();

    const populated = await Lead.findById(lead._id)
        .populate('owner', 'name email')
        .populate('comments.user', 'name email');
    res.json(populated);
});

router.get('/:id/messages', async (req, res) => {
    const lead = await Lead.findById(req.params.id).select('phoneNormalized owner');
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (isSalesRep(req) && !ownsLead(req, lead)) return res.status(403).json({ error: 'Not your lead' });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const messages = await WhatsAppMessage.find({ phoneNormalized: lead.phoneNormalized })
        .sort({ occurredAt: 1 })
        .limit(limit)
        .lean();
    res.json({ ok: true, messages });
});

router.delete('/:id', async (req, res) => {
    if (isSalesRep(req)) return res.status(403).json({ error: 'Sales reps cannot delete leads' });
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ ok: true });
});

router.post('/import/bulk', async (req, res) => {
    const contacts = req.body?.contacts;
    if (!Array.isArray(contacts) || contacts.length === 0) {
        return res.status(400).json({ error: 'contacts array is required' });
    }

    const ownerId = req.user.id || req.user._id;
    const owner = await User.findById(ownerId).select('_id');
    if (!owner) return res.status(400).json({ error: 'Owner not found' });

    // Normalize and clean all contacts, skipping invalid phones
    const valid = [];
    let parseErrors = 0;

    for (const c of contacts) {
        const phone = String(c.phone || '').trim();
        const phoneNormalized = normalizePhone(phone);
        if (!phoneNormalized || phoneNormalized.length < 7) { parseErrors++; continue; }

        let fullName = [String(c.firstName || ''), String(c.lastName || '')].join(' ').trim();
        // Fall back to "Contact XXXX" if name has no real alphanumeric chars
        if (!fullName || fullName.replace(/[^a-zA-Z0-9؀-ۿ]/g, '').length < 2) {
            fullName = `Contact ${phoneNormalized.slice(-4)}`;
        }

        valid.push({
            phoneNormalized,
            fullName,
            phone,
            email: String(c.email || '').trim(),
            notes: c.organization ? `Organization: ${c.organization}` : '',
        });
    }

    // Upsert by phoneNormalized — merge if exists, create if new
    const allNormalized = [...new Set(valid.map(c => c.phoneNormalized))];
    const existingLeads = await Lead.find({ phoneNormalized: { $in: allNormalized } }).select('phoneNormalized fullName email');
    const existingMap = new Map(existingLeads.map(l => [l.phoneNormalized, l]));

    let created = 0;
    let updated = 0;
    let insertErrors = 0;

    for (const c of valid) {
        try {
            const existing = existingMap.get(c.phoneNormalized);
            if (existing) {
                // Merge: fill in missing name/email without overwriting existing data
                const set = {};
                if (!existing.fullName || existing.fullName.startsWith('Contact ')) set.fullName = c.fullName;
                if (!existing.email && c.email) set.email = c.email;
                if (Object.keys(set).length > 0) {
                    await Lead.findByIdAndUpdate(existing._id, {
                        $set: set,
                        $push: { timeline: { type: 'csv_merge', text: 'Contact updated from CSV import.' } },
                    });
                }
                updated++;
            } else {
                await Lead.create({
                    fullName: c.fullName,
                    email: c.email,
                    phone: c.phone,
                    phoneNormalized: c.phoneNormalized,
                    owner: owner._id,
                    status: 'new',
                    source: 'other',
                    leadDateTime: new Date(),
                    storageSizeValue: 0,
                    storageSizeUnit: 'sqft',
                    durationValue: 1,
                    durationUnit: 'month',
                    unitsNeeded: 1,
                    notes: c.notes,
                    timeline: [{ type: 'created', text: 'Imported from contacts CSV.' }],
                });
                created++;
            }
        } catch {
            insertErrors++;
        }
    }

    res.json({
        ok: true,
        created,
        skipped: updated,
        errors: parseErrors + insertErrors,
        total: contacts.length,
    });
});

export function normalizeLeadPhone(input) {
    return normalizePhone(input);
}

export default router;
