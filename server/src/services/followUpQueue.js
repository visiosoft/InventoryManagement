import { Types } from 'mongoose';
import { Lead, LeadFollowUp, LeadRoutingConfig, WhatsAppMessage } from '../models/index.js';
import { wentQuiet, isWaitingOnUs } from './chatFollowUp.js';
import { windowOpenFor } from './whatsapp.js';
import { quietThreshold, attachLastNudge, attachRecentMessages } from './leadFollowUp.js';
import { resolvePlaceholderNames } from './leadNames.js';
import { summariseConversation } from './conversationSummary.js';
import { getFollowUpPlan, sequenceState } from './followUpSequence.js';

/**
 * The follow-up queue: one ranked list of who a rep should contact today,
 * and why.
 *
 * Nothing here detects anything new. Three signals already existed, each
 * computed in its own corner of the app and shown in its own place:
 *
 *   waiting on us     they wrote last, nobody answered  — the inbox's tab
 *   went quiet        we wrote last, they went silent   — the quiet-leads modal
 *   follow-up due     a date somebody set has arrived   — the rep's board
 *
 * This merges them into one queue with one order, so a rep opens one page
 * and works down it. The three are kept strictly apart on every row —
 * "customer went quiet" and "we have not replied" are different failures
 * with different urgency, and a list that blurred them would teach people
 * to ignore both. A lead appears once, under whichever applies most.
 *
 * Priority is arithmetic on facts already on file (how long, how warm, is
 * there a live question), never a fresh model call — the AI's read is
 * attached from conversationSummary's own cache, and the queue still works
 * with it absent. See classify().
 */

export const REASONS = ['sales_response_overdue', 'manual_followup_due', 'customer_quiet'];
export const CLOSED_STATUSES = ['won', 'lost', 'already_customer'];
export const DEFAULT_STAGES = [{ afterDays: 3 }, { afterDays: 7 }, { afterDays: 14 }];
/** A second send to the same lead inside this window needs an explicit
 *  "yes, again" — the same 12 hours the quiet-leads modal warns at. */
export const RESEND_GUARD_HOURS = 12;

const DAY = 864e5;
const TZ_OFFSET_MS = 4 * 3600_000;

/** Dubai midnight tonight — a follow-up dated today is due today, whatever
 *  hour it was set for. Same arithmetic as routes/myDay.js. */
export function endOfLocalDay(now = new Date()) {
    const local = new Date(new Date(now).getTime() + TZ_OFFSET_MS);
    local.setUTCHours(23, 59, 59, 999);
    return new Date(local.getTime() - TZ_OFFSET_MS);
}

/**
 * Which queue a lead belongs in, if any, and how urgently. Pure.
 *
 * `signals` is everything known about one lead and its conversation:
 *   { lastInboundAt, lastOutboundAt, leadStatus, followUpAt, sequenceExhaustedAt,
 *     temperature, nextAction, openQuestions }
 *
 * Returns null when there is nothing to do — closed lead, or a conversation
 * that is simply fine — otherwise { reason, reasonDetail, since, daysWaiting,
 * priorityScore, priority, windowOpen }.
 *
 * Precedence when more than one applies: waiting-on-us beats everything,
 * because it is the customer's time being wasted, not ours. Then a follow-up
 * somebody scheduled, then the silence nobody scheduled anything for.
 *
 * The score is deliberately not just time. A hot lead quiet for two days
 * outranks a cold one quiet for ten: base by reason, plus a capped amount
 * for how long, plus the temperature the AI read, plus a little for a live
 * unanswered question. All of those are already on file; none of this asks
 * the model anything.
 */
export function classify(signals = {}, { now = new Date(), quietAfterDays = 3, dueBefore = null } = {}) {
    const status = signals.leadStatus || '';
    if (!status || CLOSED_STATUSES.includes(status)) return null;

    const nowT = new Date(now).getTime();
    const dueT = dueBefore ? new Date(dueBefore).getTime() : endOfLocalDay(now).getTime();

    let reason = null;
    let reasonDetail = null;
    let since = null;

    if (isWaitingOnUs(signals)) {
        reason = 'sales_response_overdue';
        since = signals.lastInboundAt;
    } else if (signals.sequenceExhaustedAt) {
        reason = 'manual_followup_due';
        reasonDetail = 'exhausted';
        since = signals.sequenceExhaustedAt;
    } else if (signals.followUpAt && new Date(signals.followUpAt).getTime() <= dueT) {
        reason = 'manual_followup_due';
        reasonDetail = 'overdue_date';
        since = signals.followUpAt;
    } else if (wentQuiet({
        lastInboundAt: signals.lastInboundAt,
        lastOutboundAt: signals.lastOutboundAt,
        leadStatus: status,
        followUpAt: signals.followUpAt,
        now,
        days: quietAfterDays,
    })) {
        reason = 'customer_quiet';
        since = signals.lastOutboundAt;
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
 * Which numbered follow-up the next template send would be, from how many
 * have gone out since the customer last spoke — derived, never stored, so it
 * cannot drift from what was actually sent. Capped at the last stage: a rep
 * who sends a fourth should not read "Follow-up 4 of 3".
 */
export function stageFor(sentSinceReply, stages = DEFAULT_STAGES) {
    const total = stages.length || DEFAULT_STAGES.length;
    const next = Math.min((Number(sentSinceReply) || 0) + 1, total);
    return { next, total, label: `Follow-up ${next} of ${total}` };
}

/** The counts the page's tiles and tab badges show. Pure. */
export function summarise(items = []) {
    const out = {
        total: items.length,
        needsReply: 0,
        customerQuiet: 0,
        manualDue: 0,
        hot: 0,
        aiSuggested: 0,
        // Past its day, not merely due today: a scheduled follow-up whose date
        // has gone by, or a customer left waiting for more than a day.
        overdue: 0,
    };
    for (const it of items) {
        if (it.reason === 'sales_response_overdue') out.needsReply += 1;
        else if (it.reason === 'customer_quiet') out.customerQuiet += 1;
        else if (it.reason === 'manual_followup_due') out.manualDue += 1;
        if (it.temperature === 'hot') out.hot += 1;
        if (it.nextAction) out.aiSuggested += 1;
        if ((it.reason === 'manual_followup_due' && it.reasonDetail === 'overdue_date' && it.daysWaiting >= 1)
            || (it.reason === 'sales_response_overdue' && it.daysWaiting >= 1)) out.overdue += 1;
    }
    return out;
}

/**
 * May this lead be sent a template right now? Pure — the route gathers the
 * facts, this decides. Every reason is a string the UI can show back.
 *
 *   closed_lead             won / lost / already a customer
 *   no_phone                nothing to send to
 *   opted_out               asked not to be contacted
 *   replied_since_snapshot  they wrote back after the list was drawn
 *   sent_recently           a send went out within RESEND_GUARD_HOURS
 *   template_required       no approved template chosen (free text is never
 *                           sent from here)
 *
 * The same check runs for a single send, for a bulk preview, and again at
 * the moment of a bulk send — so the review screen and the send can never
 * disagree, and a click on an excluded row does nothing.
 */
export function validateForSend(item = {}, {
    template = null, now = new Date(), snapshotAt = null,
    lastSentAt = null, latestInboundAt = null, confirmResend = false,
} = {}) {
    if (!item.leadStatus || CLOSED_STATUSES.includes(item.leadStatus)) return { ok: false, reason: 'closed_lead' };
    if (!item.phone && !item.phoneNormalized) return { ok: false, reason: 'no_phone' };
    if (item.optedOut) return { ok: false, reason: 'opted_out' };

    const nowT = new Date(now).getTime();
    if (latestInboundAt) {
        const inT = new Date(latestInboundAt).getTime();
        if (snapshotAt && inT > new Date(snapshotAt).getTime()) return { ok: false, reason: 'replied_since_snapshot' };
        // A quiet lead is only quiet while we spoke last.
        if (item.reason === 'customer_quiet' && item.since && inT > new Date(item.since).getTime()) {
            return { ok: false, reason: 'replied_since_snapshot' };
        }
    }
    if (lastSentAt && !confirmResend) {
        if (nowT - new Date(lastSentAt).getTime() < RESEND_GUARD_HOURS * 3600_000) return { ok: false, reason: 'sent_recently' };
    }
    if (!template?.name) return { ok: false, reason: 'template_required' };
    return { ok: true, reason: null };
}

/** Plain-English version of a validation reason, for the review table. */
export function explainReason(code, { lastSentAt = null, now = new Date() } = {}) {
    switch (code) {
        case 'closed_lead': return 'Lead is closed';
        case 'no_phone': return 'No phone number on file';
        case 'opted_out': return 'Asked not to be contacted';
        case 'replied_since_snapshot': return 'Customer replied since this list was drawn';
        case 'sent_recently': {
            const h = lastSentAt ? Math.max(1, Math.round((new Date(now) - new Date(lastSentAt)) / 3600_000)) : null;
            return h ? `Already messaged ${h}h ago` : 'Already messaged recently';
        }
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
        .slice(0, 6)
        .sort((a, b) => a - b);
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
 * The AI's read, from conversationSummary's own cache — the same call the
 * quiet-leads modal makes, exposing a little more of what it already
 * returns. A thread the model has never seen, or one it cannot read right
 * now, gets nulls: the queue never waits on the model and never fails
 * because of it.
 */
async function attachAi(items) {
    return Promise.all(items.map(async (it) => {
        try {
            const s = await summariseConversation(it.phoneNormalized);
            if (!s?.configured || s.empty || s.error) return { ...it, aiSummary: null, aiReason: null, nextAction: null, openQuestions: [], temperature: it.temperature || null };
            return {
                ...it,
                aiSummary: s.headline || null,
                aiReason: s.reason || null,
                nextAction: s.nextAction || null,
                openQuestions: Array.isArray(s.openQuestions) ? s.openQuestions : [],
                temperature: s.temperature || it.temperature || null,
            };
        } catch {
            return { ...it, aiSummary: null, aiReason: null, nextAction: null, openQuestions: [], temperature: it.temperature || null };
        }
    }));
}

/** How many template sends have gone out to each lead since the customer
 *  last spoke — the derived "which follow-up is next". One grouped query. */
async function sentSinceReplyByLead(items) {
    if (!items.length) return new Map();
    const ids = items.map((it) => new Types.ObjectId(it.leadId));
    const rows = await LeadFollowUp.find({ lead: { $in: ids }, status: 'sent' }).select('lead sentAt').lean();
    const lastIn = new Map(items.map((it) => [it.leadId, it.lastInboundAt ? new Date(it.lastInboundAt).getTime() : 0]));
    const counts = new Map();
    for (const r of rows) {
        const id = String(r.lead);
        if (new Date(r.sentAt).getTime() > (lastIn.get(id) || 0)) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
}

/**
 * The queue itself. One owner's, or everybody's for admin (ownerId null).
 * `leadIds` narrows it to specific leads — the detail view asks for one.
 */
export async function buildQueue({ ownerId = null, leadIds = null, now = new Date() } = {}) {
    const [threshold, stages, plan] = await Promise.all([quietThreshold(), quietStages(), getFollowUpPlan().catch(() => null)]);

    const filter = { status: { $nin: CLOSED_STATUSES } };
    if (ownerId) filter.owner = ownerId;
    if (leadIds) filter._id = { $in: leadIds.filter((id) => Types.ObjectId.isValid(id)) };

    const leads = await Lead.find(filter)
        .select('fullName phone phoneNormalized whatsappProfileName status temperature owner followUpAt sequenceExhaustedAt attempts source')
        .populate('owner', 'name')
        .lean();
    if (!leads.length) return [];

    const phones = [...new Set(leads.map((l) => l.phoneNormalized).filter(Boolean))];
    const times = await conversationTimes(phones);

    let items = [];
    for (const lead of leads) {
        const c = times.get(lead.phoneNormalized) || {};
        const verdict = classify({
            lastInboundAt: c.lastInboundAt || null,
            lastOutboundAt: c.lastOutboundAt || null,
            leadStatus: lead.status,
            followUpAt: lead.followUpAt,
            sequenceExhaustedAt: lead.sequenceExhaustedAt,
            temperature: lead.temperature || null,
        }, { now, quietAfterDays: threshold });
        if (!verdict) continue;

        items.push({
            leadId: String(lead._id),
            name: lead.fullName || lead.whatsappProfileName || 'Unknown',
            phone: lead.phone || lead.phoneNormalized,
            phoneNormalized: lead.phoneNormalized,
            ownerId: lead.owner?._id ? String(lead.owner._id) : null,
            ownerName: lead.owner?.name || 'Unassigned',
            leadStatus: lead.status,
            source: lead.source || '',
            temperature: lead.temperature || null,
            lastInboundAt: c.lastInboundAt || null,
            lastOutboundAt: c.lastOutboundAt || null,
            followUpAt: lead.followUpAt || null,
            sequence: (lead.attempts || []).length && plan ? sequenceState(lead, plan) : null,
            ...verdict,
        });
    }
    if (!items.length) return [];

    await resolvePlaceholderNames(items, 'name');
    items = await attachAi(items);
    // The AI's temperature and open questions change the score, so re-run the
    // arithmetic now that they are on the row.
    for (const it of items) {
        const again = classify(it, { now, quietAfterDays: threshold });
        if (again) { it.priorityScore = again.priorityScore; it.priority = again.priority; }
    }
    items = await attachLastNudge(items);
    items = await attachRecentMessages(items);

    const sentCounts = await sentSinceReplyByLead(items);
    for (const it of items) {
        const sent = sentCounts.get(it.leadId) || 0;
        it.quietStage = it.reason === 'customer_quiet' ? stageFor(sent, stages) : null;
        it.sentSinceReply = sent;
    }

    items.sort((a, b) => b.priorityScore - a.priorityScore || new Date(a.since) - new Date(b.since));
    return items;
}

/**
 * Everything the drawer shows for one lead: the queue row if it is in the
 * queue (it may not be — a lead just sent to drops out), the lead itself
 * either way, and a merged timeline of what was sent, what was tried and
 * what was said.
 */
export async function detailFor({ leadId, ownerId = null, now = new Date() }) {
    const lead = await Lead.findById(leadId)
        .select('fullName phone phoneNormalized whatsappProfileName status temperature owner followUpAt sequenceExhaustedAt attempts source')
        .populate('owner', 'name')
        .lean();
    if (!lead) return null;
    if (ownerId && String(lead.owner?._id || '') !== String(ownerId)) return null;

    const [items, sends, messages] = await Promise.all([
        buildQueue({ ownerId, leadIds: [leadId], now }),
        LeadFollowUp.find({ lead: leadId }).sort({ sentAt: -1 }).limit(20).lean(),
        lead.phoneNormalized
            ? WhatsAppMessage.find({ phoneNormalized: lead.phoneNormalized })
                .sort({ occurredAt: -1 }).limit(20)
                .select('direction text transcript type status occurredAt').lean()
            : [],
    ]);
    const item = items[0] || null;
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
            name: lead.fullName || lead.whatsappProfileName || 'Unknown',
            phone: lead.phone || lead.phoneNormalized,
            phoneNormalized: lead.phoneNormalized,
            status: lead.status,
            temperature: lead.temperature || null,
            ownerName: lead.owner?.name || 'Unassigned',
            source: lead.source || '',
            followUpAt: lead.followUpAt || null,
        },
        windowOpen: windowOpenFor({ lastInboundAt, now }),
        lastInboundAt,
        timeline,
    };
}

/**
 * Per-lead eligibility for a send — single or bulk — with the facts the
 * check needs gathered in two grouped queries rather than two per lead. The
 * caller passes the template it resolved (or null), and gets back one row
 * per requested id, in order, whether or not the lead was found.
 */
export async function eligibilityFor(leadIds, {
    template = null, extraVars = [], snapshotAt = null, confirmResend = false, ownerId = null, now = new Date(),
} = {}) {
    const ids = leadIds.filter((id) => Types.ObjectId.isValid(id));
    const filter = { _id: { $in: ids } };
    if (ownerId) filter.owner = ownerId;
    const leads = await Lead.find(filter)
        .select('fullName phone phoneNormalized whatsappProfileName status owner')
        .lean();
    const byId = new Map(leads.map((l) => [String(l._id), l]));

    const phones = [...new Set(leads.map((l) => l.phoneNormalized).filter(Boolean))];
    const [times, lastSends] = await Promise.all([
        conversationTimes(phones),
        LeadFollowUp.aggregate([
            { $match: { lead: { $in: leads.map((l) => l._id) }, status: 'sent' } },
            { $sort: { sentAt: -1 } },
            { $group: { _id: '$lead', sentAt: { $first: '$sentAt' } } },
        ]),
    ]);
    const lastSentByLead = new Map(lastSends.map((r) => [String(r._id), r.sentAt]));

    return leadIds.map((leadId) => {
        const lead = byId.get(String(leadId));
        if (!lead) return { leadId, ok: false, reason: 'not_found', explanation: 'Lead not found or not yours', name: '', preview: '' };
        const c = times.get(lead.phoneNormalized) || {};
        const firstName = String(lead.fullName || lead.whatsappProfileName || '').trim().split(/\s+/)[0] || '';
        const item = {
            leadStatus: lead.status,
            phone: lead.phone,
            phoneNormalized: lead.phoneNormalized,
            reason: isWaitingOnUs(c) ? 'sales_response_overdue' : 'customer_quiet',
            since: c.lastOutboundAt || null,
        };
        const lastSentAt = lastSentByLead.get(String(lead._id)) || null;
        const verdict = validateForSend(item, {
            template, now, snapshotAt, lastSentAt, latestInboundAt: c.lastInboundAt || null, confirmResend,
        });
        const preview = template?.bodyText
            ? [firstName || 'there', ...extraVars.map((v) => String(v ?? ''))]
                .reduce((text, v, i) => text.replaceAll(`{{${i + 1}}}`, v), template.bodyText)
            : '';
        return {
            leadId: String(lead._id),
            name: lead.fullName || lead.whatsappProfileName || 'Unknown',
            phone: lead.phone || lead.phoneNormalized,
            ok: verdict.ok,
            reason: verdict.reason,
            explanation: verdict.ok ? '' : explainReason(verdict.reason, { lastSentAt, now }),
            lastSentAt,
            preview,
        };
    });
}
