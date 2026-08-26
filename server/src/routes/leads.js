import { Router } from 'express';
import mongoose from 'mongoose';
import { Customer, Contract, Document, Lead, User, WhatsAppMessage } from '../models/index.js';
import { mailConfigured, sendMail } from '../services/mail.js';

const router = Router();

const ALLOWED_STATUS = new Set(['new', 'contact_attempted', 'contacted', 'follow_up_scheduled', 'quotation_sent', 'won', 'lost']);
const ALLOWED_TEMPERATURE = new Set(['', 'hot', 'warm', 'cold']);

/* Tags add detail without replacing the status. Fixed rather than free text so
   they stay countable — a board filtered by "Business Storage" is only useful
   if everyone spells it the same way. */
const ALLOWED_TAGS = new Set([
    'storage_lead', 'moving_lead', 'storage_and_moving',
    'personal_storage', 'business_storage',
    'urgent', 'site_visit_required', 'price_sensitive', 'unresponsive',
]);
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
        temperature: String(body.temperature || '').trim(),
        // Unknown tags are dropped rather than rejected: a stale option in an
        // open tab should not fail the whole save.
        tags: Array.isArray(body.tags) ? [...new Set(body.tags.map(String).filter((t) => ALLOWED_TAGS.has(t)))] : [],
        followUpAt: body.followUpAt ? parseDate(body.followUpAt) : null,
    };
}

async function validateOwner(ownerId) {
    const owner = await User.findById(ownerId).select('_id');
    return Boolean(owner);
}

// Sales reps only ever see/touch leads assigned to them — enforced server-side
// so a rep can't widen their view via query params or a crafted request body.
function isSalesRep(req) {
    return req.user?.role === 'sales_rep' || req.user?.role === 'accounts';
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

    /* Leads nobody made.
     *
     * Every inbound WhatsApp conversation creates a Lead so the messages have
     * something to hang off, named "WhatsApp Contact 7057". They are
     * bookkeeping, and there are hundreds of them — enough to bury the leads
     * somebody actually decided to work.
     *
     * So the list shows named leads by default. Nothing is deleted or hidden
     * for good: ?includeUnsaved=1 returns them, and the WhatsApp contacts view
     * on the same page has always listed them.
     */
    if (req.query.includeUnsaved !== '1') {
        filter.fullName = { $not: /^whatsapp\s*contact/i };
    }

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

/**
 * Leads with a follow-up date that has arrived.
 *
 * Capturing the date was only half of it — a date nothing surfaces is a note
 * to self. This is what makes Follow-Up Scheduled an instruction.
 *
 * Split into overdue and today rather than returned as one list: a follow-up
 * missed three days ago and one due this afternoon need different reactions,
 * and sorting alone does not say which is which.
 *
 * Reps see only their own, enforced here the same way the list is.
 */
router.get('/follow-ups', async (req, res) => {
    try {
        const days = Math.min(Math.max(Number(req.query.days) || 7, 0), 90);

        // Dubai, like the rest of the app's day boundaries.
        const TZ_OFFSET_MS = 4 * 3600_000;
        const localNow = new Date(Date.now() + TZ_OFFSET_MS);
        const startOfToday = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()) - TZ_OFFSET_MS);
        const endOfToday = new Date(startOfToday.getTime() + 86400000);
        const horizon = new Date(endOfToday.getTime() + days * 86400000);

        const filter = {
            followUpAt: { $ne: null, $lt: horizon },
            // A closed lead's follow-up date is history, not a task.
            status: { $nin: ['won', 'lost'] },
        };
        if (isSalesRep(req)) filter.owner = req.user.id;
        else if (req.query.owner) filter.owner = String(req.query.owner);

        const leads = await Lead.find(filter)
            .select('fullName phone status temperature tags followUpAt owner ownerSeenAt')
            .populate('owner', 'name email')
            .sort({ followUpAt: 1 })
            .lean();

        const at = (l) => new Date(l.followUpAt).getTime();
        res.json({
            overdue: leads.filter((l) => at(l) < startOfToday.getTime()),
            today: leads.filter((l) => at(l) >= startOfToday.getTime() && at(l) < endOfToday.getTime()),
            upcoming: leads.filter((l) => at(l) >= endOfToday.getTime()),
            days,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * The owner has looked at it.
 *
 * Only the person it belongs to can mark it seen — an admin opening a rep's
 * lead should not clear the highlight the rep has not acted on yet.
 */
router.post('/:id/seen', async (req, res) => {
    try {
        const lead = await Lead.findById(req.params.id);
        if (!lead) return res.status(404).json({ error: 'Lead not found' });
        if (String(lead.owner) !== String(req.user.id)) return res.json({ ok: true, changed: false });
        if (lead.ownerSeenAt) return res.json({ ok: true, changed: false });
        lead.ownerSeenAt = new Date();
        await lead.save();
        res.json({ ok: true, changed: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Everything about one person, in a single call.
 *
 * A lead and a customer are the same human at two stages, and until now only
 * the lead half had a page — /customers/:id redirected to a contract, so a
 * tenant had no record of their own to open. This assembles both halves plus
 * whatever they have accumulated.
 *
 * Accepts a lead id or a customer id: the caller usually knows only one.
 */
router.get('/:id/profile', async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Not a valid id' });

        let lead = await Lead.findById(id)
            .populate('owner', 'name email')
            .populate('timeline.user', 'name')
            .lean();
        let customer = null;

        if (lead) {
            // The convert step does not store a link, so the customer is found
            // the same way the rest of the app matches people: email or phone.
            const email = String(lead.email || '').trim().toLowerCase();
            const digits = String(lead.phoneNormalized || '').replace(/\D/g, '');
            const tail = digits.length >= 9 ? digits.slice(-9) : '';
            const candidates = await Customer.find(
                email ? { $or: [{ email }, { phones: { $exists: true } }] } : {},
            ).lean();
            customer = candidates.find((c) => {
                if (email && String(c.email || '').trim().toLowerCase() === email) return true;
                if (!tail) return false;
                return [...(c.phones || []), c.phone].some((p) => String(p || '').replace(/\D/g, '').slice(-9) === tail);
            }) || null;
        } else {
            customer = await Customer.findById(id).lean();
            if (!customer) return res.status(404).json({ error: 'Nobody found with that id' });
            const tail = String(customer.phone || '').replace(/\D/g, '').slice(-9);
            if (tail) {
                lead = await Lead.findOne({ phoneNormalized: { $regex: tail + '$' } })
                    .populate('owner', 'name email')
                    .populate('timeline.user', 'name')
                    .lean();
            }
        }

        if (isSalesRep(req) && lead && !ownsLead(req, lead)) {
            return res.status(403).json({ error: 'Not your lead' });
        }

        const contracts = customer
            ? await Contract.find({ customer: customer._id })
                .populate('unit', 'unitNumber floor sizeSqf')
                .populate('units', 'unitNumber floor sizeSqf')
                .select('contractNo status startDate endDate rate billingPeriod unit units archived')
                .sort({ startDate: -1 })
                .lean()
            : [];

        const documents = customer
            ? await Document.find({ customer: customer._id }).select('name type url createdAt').sort({ createdAt: -1 }).lean()
            : [];

        res.json({
            lead,
            customer,
            contracts,
            documents,
            // Said plainly so the page can show the right actions rather than
            // inferring the stage from which fields happen to be present.
            stage: customer ? 'customer' : lead ? 'lead' : 'unknown',
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
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
    if (!ALLOWED_TEMPERATURE.has(body.temperature)) return res.status(400).json({ error: 'Invalid temperature' });
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
    if (!ALLOWED_TEMPERATURE.has(body.temperature)) return res.status(400).json({ error: 'Invalid temperature' });
    if (!Number.isFinite(body.storageSizeValue) || body.storageSizeValue < 0) return res.status(400).json({ error: 'Invalid storage size' });
    if (!Number.isFinite(body.durationValue) || body.durationValue < 1) return res.status(400).json({ error: 'Invalid duration value' });
    if (!Number.isFinite(body.unitsNeeded) || body.unitsNeeded < 1) return res.status(400).json({ error: 'Invalid units needed' });

    const ownerId = isSalesRep(req) ? req.user.id : (body.owner || req.user.id);
    if (!(await validateOwner(ownerId))) return res.status(400).json({ error: 'Lead owner not found' });

    // Handing a lead to somebody makes it new to them, whatever its age, so
    // the highlight on their board comes back.
    if (String(lead.owner) !== String(ownerId)) lead.ownerSeenAt = null;

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
    lead.temperature = body.temperature;
    lead.tags = body.tags;
    lead.followUpAt = body.followUpAt;
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

/**
 * A note against the lead.
 *
 * Status changes already record themselves, and can carry a note with them.
 * This is for everything in between: what was said, what was promised, why
 * they went quiet — the running account of working somebody.
 */
router.post('/:id/notes', async (req, res) => {
    try {
        const text = String(req.body?.text || '').trim();
        if (!text) return res.status(400).json({ error: 'A note needs some words' });

        const lead = await Lead.findById(req.params.id);
        if (!lead) return res.status(404).json({ error: 'Lead not found' });
        if (isSalesRep(req) && !ownsLead(req, lead)) return res.status(403).json({ error: 'Not your lead' });

        lead.timeline.push({ type: 'note', text: text.slice(0, 2000), user: req.user.id });
        await lead.save();
        res.status(201).json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
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

    // Details typed on the conversion form, when there were any. A lead created
    // from an inbound WhatsApp message is named "WhatsApp Contact 1368", and
    // converting that straight through put the placeholder on the customer
    // record, where it stayed.
    const given = req.body && typeof req.body === 'object' ? req.body : {};
    const FIELDS = [
        'fullName', 'clientId', 'tenantType', 'email', 'nationality', 'company',
        'address', 'emergencyNumber', 'emiratesId', 'eidExpiry', 'passportNumber',
        'passportExpiry', 'notes', 'accessPersons',
    ];
    const supplied = {};
    for (const f of FIELDS) {
        const v = given[f];
        if (v === undefined || v === null || v === '') continue;
        if (Array.isArray(v) && !v.length) continue;
        supplied[f] = v;
    }
    const suppliedPhones = Array.isArray(given.phones) ? given.phones.filter(Boolean) : [];

    if (existingCustomer) {
        // Fill the blanks on the record that already exists rather than
        // overwriting details somebody checked, and never discard what was just
        // typed without saying where it went.
        const filled = [];
        for (const [k, v] of Object.entries(supplied)) {
            const current = existingCustomer[k];
            const empty = current === undefined || current === null || current === ''
                || (Array.isArray(current) && !current.length);
            if (empty) { existingCustomer[k] = v; filled.push(k); }
        }
        for (const p of suppliedPhones) {
            if (!(existingCustomer.phones || []).includes(p)) existingCustomer.phones.push(p);
        }
        if (filled.length || suppliedPhones.length) await existingCustomer.save();

        lead.status = 'won';
        lead.timeline.push({ type: 'converted', text: 'Lead converted to existing customer.', user: req.user.id });
        await lead.save();
        return res.json({
            ok: true,
            created: false,
            filled,
            customer: existingCustomer,
        });
    }

    const customerPhones = Array.from(new Set([...suppliedPhones, ...phoneCandidates]));

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
        // Applied last so a typed name beats the lead's placeholder.
        ...supplied,
        ...(suppliedPhones.length ? { phone: suppliedPhones[0] } : {}),
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
