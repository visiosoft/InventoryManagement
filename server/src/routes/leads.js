import { Router } from 'express';
import mongoose from 'mongoose';
import { Customer, Contract, Document, Lead, Task, User, WhatsAppMessage } from '../models/index.js';
import { FOLLOW_UP_KINDS, runFollowUps, syncFollowUpTask, syncSiteVisitTask } from '../services/followUps.js';
import { applyOutcome, getFollowUpPlan, nextDateFor, sequenceState } from '../services/followUpSequence.js';
import { summarise } from '../services/speedToLead.js';
import { ATTEMPT_CHANNELS, ATTEMPT_OUTCOMES } from '../models/index.js';
import { mailConfigured, sendMail } from '../services/mail.js';

const router = Router();

const ALLOWED_STATUS = new Set(['new', 'contact_attempted', 'contacted', 'site_visit_scheduled', 'follow_up_scheduled', 'quotation_sent', 'won', 'lost']);
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
        // Absent means not asked yet, not invalid — the size is set once
        // somebody has actually spoken to them.
        storageSizeValue: Number(body.storageSizeValue) || 0,
        storageSizeUnit: String(body.storageSizeUnit || 'sqft').trim(),
        durationValue: Number(body.durationValue) || 1,
        durationUnit: String(body.durationUnit || '').trim(),
        owner: String(body.owner || ''),
        unitsNeeded: Number(body.unitsNeeded),
        notes: String(body.notes || '').trim(),
        temperature: String(body.temperature || '').trim(),
        // Unknown tags are dropped rather than rejected: a stale option in an
        // open tab should not fail the whole save.
        tags: Array.isArray(body.tags) ? [...new Set(body.tags.map(String).filter((t) => ALLOWED_TAGS.has(t)))] : [],
        followUpAt: body.followUpAt ? parseDate(body.followUpAt) : null,
        followUpKind: FOLLOW_UP_KINDS.includes(body.followUpKind) ? body.followUpKind : 'date',
        followUpNote: String(body.followUpNote || '').slice(0, 500),
        siteVisitAt: body.siteVisitAt ? parseDate(body.siteVisitAt) : null,
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

/**
 * Narrow a lead query by where its chase has got to.
 *
 *   none       nobody has tried yet — the ones that quietly rot
 *   active     being chased, with the next attempt booked
 *   exhausted  every attempt used and no answer; waiting on a decision
 *
 * `by` is who actually logged an attempt, which is deliberately not the same
 * question as who owns the lead: ownership gets reassigned, and the record of
 * who did the work stays where it happened.
 */
function applyChaseFilter(filter, { chase, attemptBy }) {
    if (chase === 'none') filter.attempts = { $size: 0 };
    else if (chase === 'active') {
        filter['attempts.0'] = { $exists: true };
        filter.followUpAt = { $ne: null };
        filter.sequenceExhaustedAt = null;
    } else if (chase === 'exhausted') filter.sequenceExhaustedAt = { $ne: null };

    if (attemptBy) filter['attempts.user'] = attemptBy;
    return filter;
}

router.get('/', async (req, res) => {
    const filter = {};
    applyChaseFilter(filter, { chase: String(req.query.chase || ''), attemptBy: req.query.attemptBy ? String(req.query.attemptBy) : '' });
    if (req.query.status && ALLOWED_STATUS.has(String(req.query.status))) {
        filter.status = String(req.query.status);
    }
    if (req.query.source && ALLOWED_SOURCE.has(String(req.query.source))) {
        filter.source = String(req.query.source);
    }
    // 'unassigned' is a real answer to "whose is this?", and the workload rail
    // asks it. Without this it fell through to matching an owner literally
    // named unassigned, which is to say nothing at all.
    if (req.query.owner === 'unassigned') filter.owner = null;
    else if (req.query.owner) filter.owner = String(req.query.owner);
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

    /* Search the way people actually type.
     *
     * The term was used raw, so a single space either side of a pasted number
     * found nothing — and a number copied out of WhatsApp brings one. Worse,
     * none of the ways a UAE number is normally written matched at all:
     * +971502612729, 971 50 261 2729 and 0502612729 all failed against a
     * stored 971502612729.
     *
     * So: trim it, and when it looks like a number, match the last nine digits
     * against phoneNormalized — the same rule the rest of the app uses to
     * decide two numbers are the same person.
     */
    const term = String(req.query.search || '').trim();
    if (term) {
        const re = new RegExp(escRegex(term), 'i');
        const or = [{ fullName: re }, { firstName: re }, { lastName: re }, { email: re }, { phone: re }, { whatsappNo: re }, { notes: re }];

        const digits = term.replace(/\D/g, '');
        if (digits.length >= 6) {
            const tail = digits.slice(-9);
            or.push({ phoneNormalized: new RegExp(`${escRegex(tail)}$`) });
        }

        filter.$or = or;
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 25), 500);
    const skip = (page - 1) * limit;

    // Exclude heavy subdocuments (timeline, comments) — the detail endpoint loads them.
    const [leads, total] = await Promise.all([
        Lead.find(filter)
            .select('-timeline -comments')
            .populate('owner', 'name email')
            // Who did the chasing, not just who it belongs to.
            .populate('attempts.user', 'name')
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
/**
 * Counts for the whole set, not just the page being looked at.
 *
 * The tabs used to count the twenty-five rows on screen, so "New 3" meant
 * three on this page rather than three leads. Same arithmetic drives the
 * workload rail, which is only worth reading if it covers everybody.
 *
 * Scoped exactly as the list is — a rep's numbers are their own leads — and
 * placeholder WhatsApp names are left out on the same terms, or the rail would
 * report hundreds of contacts nobody has decided to work.
 */
router.get('/stats', async (req, res) => {
    try {
        const filter = {};
        if (isSalesRep(req)) filter.owner = req.user.id;
        if (req.query.includeUnsaved !== '1') filter.fullName = { $not: /^whatsapp\s*contact/i };

        // Where the chasing has got to, over everybody rather than the page in
        // view. "Nobody has tried" is the number worth knowing first.
        const open = { ...filter, status: { $nin: ['won', 'lost'] } };

        const [byStatus, byOwner, total, chaseNone, chaseActive, chaseExhausted, byChaser] = await Promise.all([
            Lead.aggregate([{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
            Lead.aggregate([{ $match: filter }, { $group: { _id: '$owner', n: { $sum: 1 } } }]),
            Lead.countDocuments(filter),
            Lead.countDocuments({ ...open, attempts: { $size: 0 } }),
            Lead.countDocuments({ ...open, 'attempts.0': { $exists: true }, followUpAt: { $ne: null }, sequenceExhaustedAt: null }),
            Lead.countDocuments({ ...open, sequenceExhaustedAt: { $ne: null } }),
            // Who has actually done the chasing. One lead counts once per
            // person who worked it, not once per attempt — the question is who
            // is working leads, not who clicks most.
            Lead.aggregate([
                { $match: filter },
                { $unwind: '$attempts' },
                { $group: { _id: { lead: '$_id', user: '$attempts.user' } } },
                { $group: { _id: '$_id.user', n: { $sum: 1 } } },
            ]),
        ]);

        const ownerIds = [...byOwner.map((r) => r._id), ...byChaser.map((r) => r._id)].filter(Boolean);
        const users = ownerIds.length
            ? await User.find({ _id: { $in: ownerIds } }).select('name email').lean()
            : [];
        const nameOf = new Map(users.map((u) => [String(u._id), u.name || u.email || 'Someone']));

        res.json({
            total,
            byStatus: Object.fromEntries(byStatus.map((r) => [r._id || 'new', r.n])),
            // A lead whose owner has since been deleted counts as unassigned:
            // there is nobody to chase it, which is what the rail is asking.
            unassigned: byOwner
                .filter((r) => !r._id || !nameOf.has(String(r._id)))
                .reduce((sum, r) => sum + r.n, 0),
            byOwner: byOwner
                .filter((r) => r._id && nameOf.has(String(r._id)))
                .map((r) => ({ _id: String(r._id), name: nameOf.get(String(r._id)), count: r.n }))
                .sort((a, b) => b.count - a.count),
            chase: { none: chaseNone, active: chaseActive, exhausted: chaseExhausted },
            byChaser: byChaser
                .filter((r) => r._id && nameOf.has(String(r._id)))
                .map((r) => ({ _id: String(r._id), name: nameOf.get(String(r._id)), count: r.n }))
                .sort((a, b) => b.count - a.count),
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Raise the reminders that are due, now, rather than waiting for the morning.
 *
 * Admin only, and safe to press twice: each lead is stamped as it is reminded,
 * so a second press finds nothing left to do. It creates tasks and sends
 * nothing outward.
 */
/** The chase everybody follows. Read by anyone — the lead page prefills from it. */
router.get('/follow-up-plan', async (_req, res) => {
    try {
        res.json(await getFollowUpPlan());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/follow-up-plan', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    try {
        const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
        if (steps.length > 12) return res.status(400).json({ error: 'Twelve steps is already more chasing than anybody does' });

        const clean = steps.map((st) => ({
            label: String(st?.label || '').trim().slice(0, 60),
            afterDays: Math.max(0, Math.min(365, Number(st?.afterDays) || 0)),
            channel: ATTEMPT_CHANNELS.includes(st?.channel) ? st.channel : 'call',
        }));

        const plan = await getFollowUpPlan();
        plan.steps = clean;
        if (req.body?.responseSlaMinutes !== undefined) {
            plan.responseSlaMinutes = Math.max(1, Math.min(240, Number(req.body.responseSlaMinutes) || 2));
        }
        await plan.save();
        res.json(plan);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Leads assigned to somebody and still untouched past the window.
 *
 * Computed on the way out rather than swept up by a job: there is nothing to
 * remember between requests, so there is nothing to get out of step. Reps see
 * their own, admins see everybody — the same scoping as the list and the
 * counts.
 */
router.get('/waiting', async (req, res) => {
    try {
        const filter = {
            assignedAt: { $ne: null },
            firstResponseAt: null,
            owner: { $ne: null },
            status: { $nin: ['won', 'lost'] },
        };
        if (isSalesRep(req)) filter.owner = req.user.id;

        const [leads, plan] = await Promise.all([
            Lead.find(filter).select('fullName phone owner assignedAt firstResponseAt status').populate('owner', 'name').lean(),
            getFollowUpPlan(),
        ]);

        res.json(summarise(leads, new Date(), plan?.responseSlaMinutes));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/follow-ups/run', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    try {
        res.json(await runFollowUps());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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

    // A rep only ever owns their own. For anybody else an empty owner is a
    // choice — "Unassigned" — not a missing value to fill in with the caller,
    // which is what it used to become: toggling a tag on a lead nobody owned
    // quietly handed it to the admin doing the toggling.
    const ownerId = isSalesRep(req) ? req.user.id : (body.owner || null);
    if (ownerId && !(await validateOwner(ownerId))) return res.status(400).json({ error: 'Lead owner not found' });

    // Handing a lead to somebody makes it new to them, whatever its age, so
    // the highlight on their board comes back — and starts their clock. A lead
    // moved to a second person gets a fresh two minutes: it is their window,
    // not a continuation of somebody else's.
    if (String(lead.owner || '') !== String(ownerId || '')) {
        lead.ownerSeenAt = null;
        lead.assignedAt = ownerId ? new Date() : null;
        lead.firstResponseAt = null;
    }

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
    const before = { followUpAt: lead.followUpAt };

    // Moving a follow-up re-arms it. Without this a lead reminded once in
    // August could be rescheduled for September and never chased again,
    // because followUpNotifiedAt would still be stamped.
    const sameDay = (a, b) => {
        const x = a ? new Date(a).getTime() : 0;
        const y = b ? new Date(b).getTime() : 0;
        return x === y;
    };
    if (!sameDay(lead.followUpAt, body.followUpAt) || lead.followUpKind !== body.followUpKind) {
        lead.followUpNotifiedAt = null;
        lead.followUpPushedAt = null;
    }
    lead.followUpAt = body.followUpAt;
    lead.followUpKind = body.followUpKind;
    lead.followUpNote = body.followUpNote;

    /* A copy on the profile.
     *
     * The date itself moves whenever it is rescheduled, so on its own it can
     * never answer "what did we agree, and when did we agree it". A timeline
     * entry is the record that stays put. */
    if (body.followUpAt && !sameDay(before.followUpAt, body.followUpAt)) {
        const when = new Date(body.followUpAt).toLocaleString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });
        lead.timeline.push({
            type: 'note',
            text: `Follow-up set for ${when}${body.followUpNote ? ` — ${body.followUpNote}` : ''}`,
            user: req.user.id,
        });
    }
    lead.siteVisitAt = body.siteVisitAt;
    const userName = req.user.name || req.user.email || 'user';
    lead.timeline.push({ type: 'updated', text: `Lead updated by ${userName}`, user: req.user.id });

    // Both tasks stand for their dates from the moment they are set, so the
    // rep can see what is coming rather than being told on the day.
    await syncFollowUpTask(lead);
    await syncSiteVisitTask(lead);

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

    // The note belongs to the change, not beside it. Two timeline rows for one
    // action read as two things happening, and their order was decided by
    // insertion rather than by what actually came first.
    // Moving the stage is what somebody does after trying to reach them, so
    // it answers the clock. Written once and never moved: a later action must
    // not make the first response look slower than it was.
    if (!lead.firstResponseAt) lead.firstResponseAt = new Date();

    const comment = String(req.body?.comment || '').trim();
    lead.timeline.push({
        type: 'status_changed',
        text: comment
            ? `Status changed to ${status} — ${comment.slice(0, 2000)}`
            : `Status changed to ${status}`,
        user: req.user.id,
    });

    // Moving to Contact Attempted by hand raises the first chase, but only
    // when nothing is already scheduled and no attempt has been logged —
    // otherwise the sequence owns this and would be duplicated here.
    if (status === 'contact_attempted' && lead.owner && !lead.followUpAt && !(lead.attempts || []).length) {
        const plan = await getFollowUpPlan();
        const day = nextDateFor(plan, 0);
        if (day) {
            lead.followUpAt = new Date(`${day}T00:00:00.000Z`);
            lead.followUpKind = 'date';
            lead.followUpNotifiedAt = null;
        }
    }

    // Won or lost ends the chasing, so the standing tasks go with it rather
    // than sitting on somebody's board for a closed lead.
    await syncFollowUpTask(lead);
    await syncSiteVisitTask(lead);

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

/**
 * Record one attempt to reach this lead, and book the next.
 *
 * The single write behind the whole sequence. It records what was done, then
 * asks the plan when to look again and puts that on the owner's board through
 * the follow-up task machinery that already exists.
 *
 * It sends nothing. The rep has already called or messaged; this is where they
 * say so.
 */
router.post('/:id/attempts', async (req, res) => {
    try {
        const outcome = String(req.body?.outcome || '');
        if (!ATTEMPT_OUTCOMES.includes(outcome)) return res.status(400).json({ error: 'Say how the attempt went' });

        const channel = ATTEMPT_CHANNELS.includes(req.body?.channel) ? req.body.channel : 'call';

        const lead = await Lead.findById(req.params.id);
        if (!lead) return res.status(404).json({ error: 'Lead not found' });
        if (isSalesRep(req) && !ownsLead(req, lead)) return res.status(403).json({ error: 'Not your lead' });

        const plan = await getFollowUpPlan();
        const { attempt, exhausted, suggestStatus } = applyOutcome(lead, plan, {
            channel,
            outcome,
            note: req.body?.note,
            nextAt: req.body?.nextAt,
            userId: req.user.id,
        });

        // A lead being chased is a lead somebody has tried to reach, so the
        // stage catches up by itself rather than waiting to be set by hand.
        if (lead.status === 'new') lead.status = 'contact_attempted';
        if (!lead.firstResponseAt) lead.firstResponseAt = new Date();

        await syncFollowUpTask(lead);
        await lead.save();

        res.status(201).json({
            attempt,
            exhausted,
            suggestStatus,
            sequence: sequenceState(lead, plan),
            followUpAt: lead.followUpAt,
        });
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

    // Its reminders go with it. A follow-up or site-visit task outliving the
    // lead is somebody being told to chase a record that no longer exists —
    // and there is nothing left to open from the task. Work already picked up
    // is left alone: somebody is part-way through it and should say so.
    await Task.deleteMany({ leadId: lead._id, leadType: 'storage', status: 'todo' });

    // The conversation stays; its pointer to this lead does not. Left behind,
    // it names a record that no longer resolves, and the next lead made for
    // the same number inherits a thread that quietly refuses to recognise it.
    await WhatsAppMessage.updateMany({ lead: lead._id }, { $set: { lead: null } });

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
