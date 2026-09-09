import { Types } from 'mongoose';
import { Contract, Customer, Lead, LeadFollowUp, LeadRoutingConfig, WhatsAppMessage } from '../models/index.js';
import { isWaitingOnUs } from './chatFollowUp.js';
import { windowOpenFor } from './whatsapp.js';
import { attachLastNudge, attachRecentMessages, greetingNameFor } from './leadFollowUp.js';
import { displayNameFor, phoneTail } from './leadNames.js';
import { summariseConversation, cachedSummaries, refreshSummariesInBackground } from './conversationSummary.js';
import { getFollowUpPlan, sequenceState } from './followUpSequence.js';

/**
 * The follow-up queue: who to contact, and when.
 *
 * Every open lead we are still talking to gets one next-contact date, and
 * the queue is those dates sorted into days: now, today, tomorrow, in three
 * days, in a week, later. A lead is never in front of a rep on a day it is
 * not due — the thing that made the earlier version annoying for customers
 * was that somebody messaged yesterday was back on the list this morning.
 *
 * The date comes from one of three places, kept strictly apart on every row:
 *
 *   waiting on us     they wrote last, nobody answered  → now
 *   scheduled         a date somebody set               → that date
 *   went quiet        we wrote last, they went silent   → the cadence:
 *                     3 days after we last spoke, then 7 after the first
 *                     follow-up, then 14 after the second, then a person
 *                     decides (LeadRoutingConfig.quietFollowUpStages)
 *
 * The cadence is arithmetic on the send log — which follow-up this is, is
 * counted from what actually went out since they last spoke, never stored,
 * so it cannot drift. A send before the date is refused server-side.
 *
 * Priority is arithmetic on facts already on file (how long, how warm, is
 * there a live question), never a fresh model call — the AI's read is
 * attached from conversationSummary's own cache, and the queue still works
 * with it absent.
 */

export const REASONS = ['sales_response_overdue', 'manual_followup_due', 'customer_quiet'];
export const CLOSED_STATUSES = ['won', 'lost', 'already_customer'];
export const DEFAULT_STAGES = [{ afterDays: 3 }, { afterDays: 7 }, { afterDays: 14 }];
/** A customer who wrote more than this long ago and never got a reply is
 *  history, not today's work — the same bound the inbox's waiting tab
 *  uses (routes/whatsapp.js). Meta's window closed on them long ago. */
export const WAITING_MAX_DAYS = 30;
/**
 * Leads created before this are left out of the queue entirely.
 *
 * Set 2026-09-09, per an explicit call: reliable data — real conversation
 * history, a genuine name, a signal worth acting on — mostly starts at
 * 1 September 2026; leads older than that were mostly noise inflating
 * "Needs reply now" and "Contact today" into the hundreds with little a rep
 * could actually act on. Only the general queue is bounded by this — a
 * specific lead (the drawer, a bulk-send eligibility check) is never
 * silently hidden by it; see buildQueue().
 */
export const QUEUE_SINCE = new Date('2026-08-31T20:00:00.000Z'); // 2026-09-01 00:00 Asia/Dubai
export const WINDOWS = ['now', 'today', 'tomorrow', 'in_3_days', 'in_7_days', 'later', 'exhausted'];
/** A second send to the same lead inside this window needs an explicit
 *  "yes, again" even when the cadence says it is due. */
export const RESEND_GUARD_HOURS = 12;

const DAY = 864e5;
const TZ_OFFSET_MS = 4 * 3600_000;

/** Dubai midnight tonight — same arithmetic as routes/myDay.js. */
export function endOfLocalDay(now = new Date()) {
    const local = new Date(new Date(now).getTime() + TZ_OFFSET_MS);
    local.setUTCHours(23, 59, 59, 999);
    return new Date(local.getTime() - TZ_OFFSET_MS);
}
function localDayIndex(d) {
    return Math.floor((new Date(d).getTime() + TZ_OFFSET_MS) / DAY);
}

/**
 * Which day-bucket a next-contact date falls in, seen from `now`, in Dubai
 * days. Anything already past is today's work.
 */
export function windowFor(nextContactAt, now = new Date()) {
    if (!nextContactAt) return 'today';
    const diff = localDayIndex(nextContactAt) - localDayIndex(now);
    if (diff <= 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff <= 3) return 'in_3_days';
    if (diff <= 7) return 'in_7_days';
    return 'later';
}

/**
 * When a quiet lead is next due, from the cadence.
 *
 * `sentSinceReply` follow-ups have gone out since they last spoke; the gap
 * to the next one is that stage's afterDays, counted from whichever was
 * later — our last message in the chat, or our last follow-up send. Past
 * the last stage there is no next date: a person decides.
 */
export function nextQuietContact({ lastOutboundAt, lastSentAt, sentSinceReply = 0, stages = DEFAULT_STAGES }) {
    const list = stages?.length ? stages : DEFAULT_STAGES;
    if (sentSinceReply >= list.length) return { nextContactAt: null, exhausted: true };
    const base = [lastOutboundAt, lastSentAt].filter(Boolean).map((d) => new Date(d).getTime());
    if (!base.length) return { nextContactAt: null, exhausted: false };
    const gap = Number(list[sentSinceReply]?.afterDays) || DEFAULT_STAGES[Math.min(sentSinceReply, 2)].afterDays;
    return { nextContactAt: new Date(Math.max(...base) + gap * DAY), exhausted: false };
}

/**
 * Where one lead sits, if anywhere, and how urgently. Pure.
 *
 * `signals`: { lastInboundAt, lastOutboundAt, leadStatus, followUpAt,
 * sequenceExhaustedAt, temperature, nextAction, openQuestions,
 * lastSentAt, sentSinceReply }
 *
 * Returns null for a closed lead or one there is nothing to do about
 * (never spoken to), otherwise { reason, reasonDetail, since, daysWaiting,
 * nextContactAt, window, priorityScore, priority, windowOpen }.
 *
 * Precedence: waiting-on-us beats everything — it is the customer's time
 * being wasted. Then a date somebody set, then the cadence.
 */
export function classify(signals = {}, { now = new Date(), stages = DEFAULT_STAGES } = {}) {
    const status = signals.leadStatus || '';
    if (!status || CLOSED_STATUSES.includes(status)) return null;

    const nowT = new Date(now).getTime();
    let reason = null;
    let reasonDetail = null;
    let since = null;
    let nextContactAt = null;
    let window = null;

    // A follow-up template we sent is us speaking, whether or not the chat
    // log recorded it — so a customer we just replied to by template is no
    // longer waiting on us, and the cadence counts from that send.
    const lastFromUs = [signals.lastOutboundAt, signals.lastSentAt].filter(Boolean)
        .map((d) => new Date(d)).sort((a, b) => b - a)[0] || null;
    const waiting = isWaitingOnUs({ lastInboundAt: signals.lastInboundAt, lastOutboundAt: lastFromUs })
        && (nowT - new Date(signals.lastInboundAt).getTime()) <= WAITING_MAX_DAYS * DAY;

    if (waiting) {
        reason = 'sales_response_overdue';
        since = signals.lastInboundAt;
        nextContactAt = new Date(now);
        window = 'now';
    } else if (signals.sequenceExhaustedAt) {
        reason = 'manual_followup_due';
        reasonDetail = 'exhausted';
        since = signals.sequenceExhaustedAt;
        nextContactAt = new Date(now);
        window = 'today';
    } else if (signals.followUpAt) {
        reason = 'manual_followup_due';
        reasonDetail = new Date(signals.followUpAt).getTime() <= endOfLocalDay(now).getTime() ? 'overdue_date' : 'scheduled';
        since = signals.followUpAt;
        nextContactAt = new Date(signals.followUpAt);
        window = windowFor(nextContactAt, now);
    } else if (lastFromUs) {
        // We spoke last. Where they are in the cadence decides the day.
        const q = nextQuietContact({
            lastOutboundAt: signals.lastOutboundAt, lastSentAt: signals.lastSentAt,
            sentSinceReply: signals.sentSinceReply || 0, stages,
        });
        reason = 'customer_quiet';
        since = lastFromUs;
        if (q.exhausted) {
            reasonDetail = 'exhausted';
            nextContactAt = null;
            window = 'exhausted';
        } else {
            nextContactAt = q.nextContactAt;
            window = windowFor(nextContactAt, now);
        }
    }
    if (!reason) return null;

    const daysWaiting = Math.max(0, Math.floor((nowT - new Date(since).getTime()) / DAY));
    const base = reason === 'sales_response_overdue' ? 100
        : reasonDetail === 'exhausted' ? 70
            : reason === 'manual_followup_due' ? 60
                : 40;
    let score = base + Math.min(daysWaiting, 14) * 2;
    if (signals.temperature === 'hot') score += 15;
    else if (signals.temperature === 'warm') score += 5;
    if (signals.nextAction || (signals.openQuestions || []).length) score += 10;

    return {
        reason,
        reasonDetail,
        since,
        daysWaiting,
        nextContactAt,
        window,
        priorityScore: score,
        priority: priorityOf(score),
        windowOpen: windowOpenFor({ lastInboundAt: signals.lastInboundAt, now }),
    };
}

/** HIGH / MEDIUM / LOW from the score — the badge, not the order. */
export function priorityOf(score) {
    return score >= 90 ? 'high' : score >= 60 ? 'medium' : 'low';
}

/**
 * Which numbered follow-up the next send would be. Past the last stage it
 * says so rather than counting on.
 */
export function stageFor(sentSinceReply, stages = DEFAULT_STAGES) {
    const total = stages?.length || DEFAULT_STAGES.length;
    const sent = Number(sentSinceReply) || 0;
    if (sent >= total) return { next: total, total, label: `All ${total} follow-ups sent`, exhausted: true };
    return { next: sent + 1, total, label: `Follow-up ${sent + 1} of ${total}`, exhausted: false };
}

/** The counts the page's cards and tabs show. Pure. */
export function summarise(items = []) {
    const out = {
        total: items.length,
        due: 0,          // now + today: the work in front of you
        needsReply: 0,
        customerQuiet: 0,
        manualDue: 0,
        hot: 0,
        aiSuggested: 0,
        overdue: 0,
        windows: { now: 0, today: 0, tomorrow: 0, in_3_days: 0, in_7_days: 0, later: 0, exhausted: 0 },
    };
    for (const it of items) {
        if (it.window in out.windows) out.windows[it.window] += 1;
        const dueNow = it.window === 'now' || it.window === 'today' || it.window === 'exhausted';
        if (dueNow) out.due += 1;
        if (it.reason === 'sales_response_overdue') out.needsReply += 1;
        else if (it.reason === 'customer_quiet' && dueNow) out.customerQuiet += 1;
        else if (it.reason === 'manual_followup_due' && dueNow) out.manualDue += 1;
        if (it.temperature === 'hot' && dueNow) out.hot += 1;
        if (it.nextAction && dueNow) out.aiSuggested += 1;
        if ((it.reason === 'manual_followup_due' && it.reasonDetail === 'overdue_date' && it.daysWaiting >= 1)
            || (it.reason === 'sales_response_overdue' && it.daysWaiting >= 1)) out.overdue += 1;
    }
    return out;
}

/**
 * Who, in our own records, is behind each phone number.
 *
 * A "lead" whose number belongs to a tenant with a live contract is not a
 * lead — and a new-enquiry or promo template sent to them is the kind of
 * wrong message that costs trust. Matched on the last nine digits, the
 * same rule every other phone match in the app uses. Returns a Map of
 * tail → { id, name, status: 'active' | 'former', contracts[] }; a number
 * nobody in Customers has is simply absent.
 */
export async function customersByTail(tails) {
    const wanted = new Set([...tails].filter((t) => t && t.length === 9));
    if (!wanted.size) return new Map();

    // Small collection, one read — the same trade leadNames.js makes.
    const customers = await Customer.find({}).select('fullName phone phones phoneNormalized').lean();
    const byTail = new Map();
    for (const c of customers) {
        for (const p of [c.phoneNormalized, c.phone, ...(c.phones || [])]) {
            const t = phoneTail(p);
            if (t.length === 9 && wanted.has(t) && !byTail.has(t)) byTail.set(t, c);
        }
    }
    if (!byTail.size) return new Map();

    const ids = [...new Set([...byTail.values()].map((c) => String(c._id)))];
    const contracts = await Contract.find({ customer: { $in: ids }, status: { $in: ['active', 'ended'] }, archived: { $ne: true } })
        .select('customer contractNo status endDate unit units')
        .populate('unit', 'unitNumber').populate('units', 'unitNumber')
        .lean();
    const byCustomer = new Map();
    for (const k of contracts) {
        const id = String(k.customer);
        if (!byCustomer.has(id)) byCustomer.set(id, []);
        byCustomer.get(id).push({
            contractNo: k.contractNo || '',
            status: k.status,
            endDate: k.endDate || null,
            unit: k.units?.length ? k.units.map((u) => u?.unitNumber).filter(Boolean).join(', ') : (k.unit?.unitNumber || ''),
        });
    }

    const out = new Map();
    for (const [tail, c] of byTail) {
        const list = byCustomer.get(String(c._id)) || [];
        const active = list.filter((k) => k.status === 'active');
        out.set(tail, {
            id: String(c._id),
            name: c.fullName || '',
            status: active.length ? 'active' : 'former',
            contracts: (active.length ? active : list).slice(0, 3),
        });
    }
    return out;
}

/**
 * May this lead be sent a template right now? Pure — the route gathers the
 * facts, this decides. Every reason is a string the UI can show back.
 *
 *   closed_lead             won / lost / already a customer
 *   active_customer         the number belongs to a tenant with a live
 *                           contract — a lead template would be wrong
 *   no_phone                nothing to send to
 *   opted_out               asked not to be contacted
 *   replied_since_snapshot  they wrote back after the list was drawn
 *   sent_recently           a send went out within RESEND_GUARD_HOURS
 *   not_due_yet             the cadence says a later day
 *   exhausted               every stage has been sent; a person decides
 *   template_required       no approved template chosen
 *
 * `confirmResend` overrides sent_recently, not_due_yet and exhausted;
 * `allowCustomers` overrides active_customer — each is its own deliberate
 * tick, and nothing overrides the rest. The same check runs for a single
 * send, a bulk preview, and again at the moment of a bulk send.
 */
export function validateForSend(item = {}, {
    template = null, now = new Date(), snapshotAt = null,
    lastSentAt = null, latestInboundAt = null, confirmResend = false, allowCustomers = false,
    nextContactAt = null, exhausted = false,
} = {}) {
    if (!item.leadStatus || CLOSED_STATUSES.includes(item.leadStatus)) return { ok: false, reason: 'closed_lead' };
    if (item.customer?.status === 'active' && !allowCustomers) return { ok: false, reason: 'active_customer' };
    if (!item.phone && !item.phoneNormalized) return { ok: false, reason: 'no_phone' };
    if (item.optedOut) return { ok: false, reason: 'opted_out' };

    const nowT = new Date(now).getTime();
    if (latestInboundAt) {
        const inT = new Date(latestInboundAt).getTime();
        if (snapshotAt && inT > new Date(snapshotAt).getTime()) return { ok: false, reason: 'replied_since_snapshot' };
        if (item.reason === 'customer_quiet' && item.since && inT > new Date(item.since).getTime()) {
            return { ok: false, reason: 'replied_since_snapshot' };
        }
    }
    if (!confirmResend) {
        if (lastSentAt && nowT - new Date(lastSentAt).getTime() < RESEND_GUARD_HOURS * 3600_000) return { ok: false, reason: 'sent_recently' };
        if (exhausted) return { ok: false, reason: 'exhausted' };
        if (nextContactAt && new Date(nextContactAt).getTime() > endOfLocalDay(now).getTime()) return { ok: false, reason: 'not_due_yet' };
    }
    if (!template?.name) return { ok: false, reason: 'template_required' };
    return { ok: true, reason: null };
}

/** Plain-English version of a validation reason, for the review table. */
export function explainReason(code, { lastSentAt = null, nextContactAt = null, now = new Date(), customer = null } = {}) {
    switch (code) {
        case 'closed_lead': return 'Lead is closed';
        case 'active_customer': {
            const k = customer?.contracts?.[0];
            return `Active tenant${k ? ` — ${k.contractNo}${k.unit ? `, unit ${k.unit}` : ''}` : ''}; a lead template would be wrong`;
        }
        case 'no_phone': return 'No phone number on file';
        case 'opted_out': return 'Asked not to be contacted';
        case 'replied_since_snapshot': return 'Customer replied since this list was drawn';
        case 'sent_recently': {
            const h = lastSentAt ? Math.max(1, Math.round((new Date(now) - new Date(lastSentAt)) / 3600_000)) : null;
            return h ? `Already messaged ${h}h ago` : 'Already messaged recently';
        }
        case 'not_due_yet': {
            const d = nextContactAt ? new Date(nextContactAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' }) : '';
            return d ? `Not due until ${d}` : 'Not due yet';
        }
        case 'exhausted': return 'Every follow-up in the cadence has been sent';
        case 'template_required': return 'An approved template is required';
        default: return code || '';
    }
}

/** The configured escalation stages, with a safe default. */
export async function quietStages() {
    const config = await LeadRoutingConfig.findOne().select('quietFollowUpStages').lean();
    const stages = (config?.quietFollowUpStages || []).filter((s) => Number(s?.afterDays) > 0);
    return stages.length ? stages.map((s) => ({ afterDays: Number(s.afterDays) })) : DEFAULT_STAGES;
}

export async function setQuietStages(input) {
    const days = (Array.isArray(input) ? input : [])
        .map((s) => Math.round(Number(typeof s === 'object' ? s?.afterDays : s)))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 90)
        .slice(0, 6);
    const stages = days.length ? days.map((afterDays) => ({ afterDays })) : DEFAULT_STAGES;
    await LeadRoutingConfig.findOneAndUpdate({}, { $set: { quietFollowUpStages: stages } }, { upsert: true });
    return stages;
}

/** Last inbound / outbound per phone, one aggregate for the whole batch —
 *  the same query quietLeads() runs, kept identical on purpose. */
async function conversationTimes(phones) {
    if (!phones.length) return new Map();
    const rows = await WhatsAppMessage.aggregate([
        { $match: { phoneNormalized: { $in: phones } } },
        {
            $group: {
                _id: '$phoneNormalized',
                lastInboundAt: { $max: { $cond: [{ $eq: ['$direction', 'inbound'] }, '$occurredAt', null] } },
                lastOutboundAt: { $max: { $cond: [{ $eq: ['$direction', 'outbound'] }, '$occurredAt', null] } },
            },
        },
    ]);
    return new Map(rows.map((r) => [r._id, r]));
}

/**
 * Per lead: when we last sent a follow-up, and how many have gone out since
 * the customer last spoke. One query for the batch. `lastInboundByLead` is
 * a Map of leadId → time, so "since they last spoke" is per lead.
 */
async function sendHistoryByLead(leadIds, lastInboundByLead) {
    if (!leadIds.length) return new Map();
    const rows = await LeadFollowUp.find({ lead: { $in: leadIds.map((id) => new Types.ObjectId(id)) }, status: 'sent' })
        .select('lead sentAt').lean();
    const out = new Map();
    for (const r of rows) {
        const id = String(r.lead);
        const row = out.get(id) || { lastSentAt: null, sentSinceReply: 0 };
        const t = new Date(r.sentAt).getTime();
        if (!row.lastSentAt || t > new Date(row.lastSentAt).getTime()) row.lastSentAt = r.sentAt;
        if (t > (lastInboundByLead.get(id) || 0)) row.sentSinceReply += 1;
        out.set(id, row);
    }
    return out;
}

/**
 * The AI's read, from conversationSummary's own cache — nulls when the
 * model has never seen the thread or cannot read it now. The queue never
 * waits on the model and never fails because of it.
 */
/**
 * The AI's read of each conversation, from the cache.
 *
 * Two reads for the whole batch, never one per lead. A thread whose summary
 * is out of date is handed to the background lane and comes back blank this
 * time — the page refetches shortly and picks it up. `generate: 'inline'`
 * waits instead, for the one-lead detail view where the person is looking
 * at exactly this conversation.
 */
async function attachAi(items, { generate = 'background' } = {}) {
    const blankFor = (it) => ({ aiSummary: null, aiReason: null, nextAction: null, openQuestions: [], temperature: it.temperature || null });
    let fresh = new Map();
    let stale = [];
    try {
        ({ fresh, stale } = await cachedSummaries(items.map((it) => it.phoneNormalized)));
    } catch { /* the summary is a bonus, never a gate */ }

    if (stale.length) {
        if (generate === 'inline' && stale.length <= 3) {
            await Promise.all(stale.map(async (phone) => {
                try {
                    const s = await summariseConversation(phone);
                    if (s?.configured && !s.empty && !s.error) fresh.set(phone, s);
                } catch { /* stays blank */ }
            }));
        } else {
            refreshSummariesInBackground(stale);
        }
    }

    return items.map((it) => {
        const s = fresh.get(it.phoneNormalized);
        if (!s) return { ...it, ...blankFor(it) };
        return {
            ...it,
            aiSummary: s.headline || null,
            aiReason: s.reason || null,
            nextAction: s.nextAction || null,
            openQuestions: Array.isArray(s.openQuestions) ? s.openQuestions : [],
            temperature: s.temperature || it.temperature || null,
        };
    });
}

/**
 * The queue itself — every open lead we are still in contact with, each
 * with its next-contact date and day-bucket. One owner's, or everybody's
 * for admin (ownerId null). `leadIds` narrows it to specific leads.
 */
export async function buildQueue({ ownerId = null, leadIds = null, now = new Date(), generate = 'background' } = {}) {
    const [stages, plan] = await Promise.all([quietStages(), getFollowUpPlan().catch(() => null)]);

    const filter = { status: { $nin: CLOSED_STATUSES } };
    if (ownerId) filter.owner = ownerId;
    if (leadIds) filter._id = { $in: leadIds.filter((id) => Types.ObjectId.isValid(id)) };
    // The general queue only, never a specific lookup: a deep link or a
    // detail/eligibility check for a named lead must still work even if
    // that lead predates the cutoff below.
    else filter.createdAt = { $gte: QUEUE_SINCE };

    const leads = await Lead.find(filter)
        .select('fullName phone phoneNormalized whatsappProfileName status temperature owner followUpAt sequenceExhaustedAt attempts source')
        .populate('owner', 'name')
        .lean();
    if (!leads.length) return [];

    const phones = [...new Set(leads.map((l) => l.phoneNormalized).filter(Boolean))];
    const [times, customers] = await Promise.all([
        conversationTimes(phones),
        customersByTail(phones.map(phoneTail)),
    ]);
    const lastInboundByLead = new Map(leads.map((l) => {
        const c = times.get(l.phoneNormalized);
        return [String(l._id), c?.lastInboundAt ? new Date(c.lastInboundAt).getTime() : 0];
    }));
    const history = await sendHistoryByLead(leads.map((l) => String(l._id)), lastInboundByLead);

    let items = [];
    for (const lead of leads) {
        const c = times.get(lead.phoneNormalized) || {};
        const h = history.get(String(lead._id)) || { lastSentAt: null, sentSinceReply: 0 };
        const customer = customers.get(phoneTail(lead.phoneNormalized)) || null;
        const verdict = classify({
            lastInboundAt: c.lastInboundAt || null,
            lastOutboundAt: c.lastOutboundAt || null,
            lastSentAt: h.lastSentAt,
            sentSinceReply: h.sentSinceReply,
            leadStatus: lead.status,
            followUpAt: lead.followUpAt,
            sequenceExhaustedAt: lead.sequenceExhaustedAt,
            temperature: lead.temperature || null,
        }, { now, stages });
        if (!verdict) continue;

        items.push({
            leadId: String(lead._id),
            name: displayNameFor(lead, customer?.name),
            phone: lead.phone || lead.phoneNormalized,
            phoneNormalized: lead.phoneNormalized,
            ownerId: lead.owner?._id ? String(lead.owner._id) : null,
            ownerName: lead.owner?.name || 'Unassigned',
            leadStatus: lead.status,
            source: lead.source || '',
            temperature: lead.temperature || null,
            // Who this number is in Customers, if anyone: an active tenant, a
            // former one, or nobody (null). Shown on the row and on the
            // drawer, and it blocks a bulk send unless deliberately included.
            customer,
            lastInboundAt: c.lastInboundAt || null,
            lastOutboundAt: c.lastOutboundAt || null,
            lastSentAt: h.lastSentAt,
            sentSinceReply: h.sentSinceReply,
            followUpAt: lead.followUpAt || null,
            sequence: (lead.attempts || []).length && plan ? sequenceState(lead, plan) : null,
            quietStage: stageFor(h.sentSinceReply, stages),
            ...verdict,
        });
    }
    if (!items.length) return [];

    items = await attachAi(items, { generate });
    // The AI's temperature and open questions change the score, so re-run
    // the arithmetic now that they are on the row.
    for (const it of items) {
        const again = classify(it, { now, stages });
        if (again) { it.priorityScore = again.priorityScore; it.priority = again.priority; }
    }
    items = await attachLastNudge(items);
    items = await attachRecentMessages(items);

    const order = { now: 0, today: 1, exhausted: 2, tomorrow: 3, in_3_days: 4, in_7_days: 5, later: 6 };
    items.sort((a, b) => (order[a.window] - order[b.window])
        || (b.priorityScore - a.priorityScore)
        || (new Date(a.since) - new Date(b.since)));
    return items;
}

/**
 * Everything the drawer shows for one lead: the queue row if it has one,
 * the lead itself either way, and a merged timeline of what was sent,
 * what was tried and what was said.
 */
export async function detailFor({ leadId, ownerId = null, now = new Date() }) {
    const lead = await Lead.findById(leadId)
        .select('fullName phone phoneNormalized whatsappProfileName status temperature owner followUpAt sequenceExhaustedAt attempts source')
        .populate('owner', 'name')
        .lean();
    if (!lead) return null;
    if (ownerId && String(lead.owner?._id || '') !== String(ownerId)) return null;

    const [items, sends, messages, customers] = await Promise.all([
        buildQueue({ ownerId, leadIds: [leadId], now, generate: 'inline' }),
        LeadFollowUp.find({ lead: leadId }).sort({ sentAt: -1 }).limit(20).lean(),
        lead.phoneNormalized
            ? WhatsAppMessage.find({ phoneNormalized: lead.phoneNormalized })
                .sort({ occurredAt: -1 }).limit(30)
                .select('direction text transcript type status occurredAt').lean()
            : [],
        customersByTail([phoneTail(lead.phoneNormalized)]),
    ]);
    const item = items[0] || null;
    const customer = customers.get(phoneTail(lead.phoneNormalized)) || null;
    const lastInboundAt = item?.lastInboundAt
        || messages.find((m) => m.direction === 'inbound')?.occurredAt
        || null;

    const timeline = [
        ...sends.map((s) => ({
            kind: 'send', at: s.sentAt, status: s.status, error: s.error || '',
            label: s.templateLabel || s.templateName, by: s.sentByName || '', repliedAt: s.repliedAt || null,
        })),
        ...(lead.attempts || []).map((a) => ({
            kind: 'attempt', at: a.at, channel: a.channel, outcome: a.outcome, note: a.note || '', no: a.no,
        })),
        ...messages.map((m) => ({
            kind: 'message', at: m.occurredAt, direction: m.direction, status: m.status || '',
            text: m.text || m.transcript || (m.type && m.type !== 'text' ? `[${m.type}]` : ''),
        })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at));

    return {
        item,
        lead: {
            leadId: String(lead._id),
            name: displayNameFor(lead, customer?.name),
            phone: lead.phone || lead.phoneNormalized,
            phoneNormalized: lead.phoneNormalized,
            status: lead.status,
            temperature: lead.temperature || null,
            ownerName: lead.owner?.name || 'Unassigned',
            source: lead.source || '',
            followUpAt: lead.followUpAt || null,
            customer,
        },
        windowOpen: windowOpenFor({ lastInboundAt, now }),
        lastInboundAt,
        timeline,
    };
}

/**
 * Per-lead eligibility for a send — single or bulk — with the facts the
 * check needs gathered in grouped queries. Returns one row per requested
 * id, in order, whether or not the lead was found.
 */
export async function eligibilityFor(leadIds, {
    template = null, extraVars = [], snapshotAt = null, confirmResend = false, allowCustomers = false, ownerId = null, now = new Date(),
} = {}) {
    const ids = leadIds.filter((id) => Types.ObjectId.isValid(id));
    const filter = { _id: { $in: ids } };
    if (ownerId) filter.owner = ownerId;
    const [leads, stages] = await Promise.all([
        Lead.find(filter).select('fullName phone phoneNormalized whatsappProfileName status owner followUpAt').lean(),
        quietStages(),
    ]);
    const byId = new Map(leads.map((l) => [String(l._id), l]));

    const phones = [...new Set(leads.map((l) => l.phoneNormalized).filter(Boolean))];
    const [times, customers] = await Promise.all([
        conversationTimes(phones),
        customersByTail(phones.map(phoneTail)),
    ]);
    const lastInboundByLead = new Map(leads.map((l) => {
        const c = times.get(l.phoneNormalized);
        return [String(l._id), c?.lastInboundAt ? new Date(c.lastInboundAt).getTime() : 0];
    }));
    const history = await sendHistoryByLead(leads.map((l) => String(l._id)), lastInboundByLead);

    return leadIds.map((leadId) => {
        const lead = byId.get(String(leadId));
        if (!lead) return { leadId, ok: false, reason: 'not_found', explanation: 'Lead not found or not yours', name: '', phone: '', lastSentAt: null, preview: '' };
        const c = times.get(lead.phoneNormalized) || {};
        const h = history.get(String(lead._id)) || { lastSentAt: null, sentSinceReply: 0 };
        const customer = customers.get(phoneTail(lead.phoneNormalized)) || null;
        const firstName = greetingNameFor(lead);

        const lastFromUs = [c.lastOutboundAt, h.lastSentAt].filter(Boolean).map((d) => new Date(d)).sort((a, b) => b - a)[0] || null;
        const waiting = isWaitingOnUs({ lastInboundAt: c.lastInboundAt, lastOutboundAt: lastFromUs })
            && (new Date(now) - new Date(c.lastInboundAt)) <= WAITING_MAX_DAYS * DAY;
        const q = waiting ? { nextContactAt: null, exhausted: false } : nextQuietContact({
            lastOutboundAt: c.lastOutboundAt, lastSentAt: h.lastSentAt, sentSinceReply: h.sentSinceReply, stages,
        });
        const item = {
            leadStatus: lead.status,
            phone: lead.phone,
            phoneNormalized: lead.phoneNormalized,
            customer,
            reason: waiting ? 'sales_response_overdue' : 'customer_quiet',
            since: [c.lastOutboundAt, h.lastSentAt].filter(Boolean).sort().pop() || null,
        };
        const verdict = validateForSend(item, {
            template, now, snapshotAt,
            lastSentAt: h.lastSentAt, latestInboundAt: c.lastInboundAt || null, confirmResend, allowCustomers,
            // A date somebody set wins over the cadence.
            nextContactAt: lead.followUpAt || q.nextContactAt, exhausted: q.exhausted,
        });
        const preview = template?.bodyText
            ? [firstName, ...extraVars.map((v) => String(v ?? ''))]
                .reduce((text, v, i) => text.replaceAll(`{{${i + 1}}}`, v), template.bodyText)
            : '';
        return {
            leadId: String(lead._id),
            name: displayNameFor(lead, customer?.name),
            phone: lead.phone || lead.phoneNormalized,
            ok: verdict.ok,
            reason: verdict.reason,
            explanation: verdict.ok ? '' : explainReason(verdict.reason, { lastSentAt: h.lastSentAt, nextContactAt: lead.followUpAt || q.nextContactAt, now, customer }),
            lastSentAt: h.lastSentAt,
            customer,
            preview,
        };
    });
}
