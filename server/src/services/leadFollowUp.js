import { Types } from 'mongoose';
import { Lead, LeadFollowUp, LeadRoutingConfig, WhatsAppMessage } from '../models/index.js';
import { QUIET_DAYS, wentQuiet, quietDays } from './chatFollowUp.js';
import { summariseConversation } from './conversationSummary.js';
import { sendWhatsAppTemplate, whatsappSendConfigured } from './whatsapp.js';

/**
 * Leads a rep or admin already spoke to, who then went quiet — surfaced as a
 * count and a reviewable list, not a task. 200+ tasks already sit unactioned
 * on the board; this exists because that mechanism was tried and did not
 * work, not because it was missing.
 *
 * Three things happen here that the inbox's own "quiet" tab does not do:
 *
 *   the threshold is configurable   admin's judgement call, not a constant
 *   each one carries a reason       the AI's read of the conversation, so a
 *                                    rep is not reconstructing context from
 *                                    scratch before deciding what to send
 *   a send is logged                so "already messaged 5 hours ago" is a
 *                                    fact, not a guess, and so admin can see
 *                                    sent / replied / still quiet over time
 *
 * The message itself is never generated. Outside WhatsApp's 24-hour window it
 * has to be an approved template — free text is refused by Meta regardless of
 * how well the AI understands the conversation — so the only real choices are
 * who gets one and which of the existing approved templates fits. Both stay
 * with a person.
 */

export async function quietThreshold() {
    const config = await LeadRoutingConfig.findOne().select('quietFollowUpDays').lean();
    return config?.quietFollowUpDays || QUIET_DAYS;
}

export async function setQuietThreshold(days) {
    const n = Math.max(1, Math.min(30, Number(days) || QUIET_DAYS));
    await LeadRoutingConfig.findOneAndUpdate({}, { $set: { quietFollowUpDays: n } }, { upsert: true });
    return n;
}

/**
 * The quiet leads themselves — scoped to one owner, or every open lead when
 * ownerId is null (admin's rollup). Reasons and last-nudge times are not
 * attached here; callers ask for those separately, since a summary/count
 * view often does not need either.
 */
export async function quietLeads({ ownerId = null, days = null } = {}) {
    const threshold = days || await quietThreshold();
    const now = new Date();

    const leadFilter = { status: { $nin: ['won', 'lost'] } };
    if (ownerId) leadFilter.owner = ownerId;

    const leads = await Lead.find(leadFilter)
        .select('fullName phone phoneNormalized whatsappProfileName status owner followUpAt')
        .populate('owner', 'name')
        .lean();
    if (!leads.length) return [];

    const phones = [...new Set(leads.map((l) => l.phoneNormalized).filter(Boolean))];
    const convos = phones.length
        ? await WhatsAppMessage.aggregate([
            { $match: { phoneNormalized: { $in: phones } } },
            {
                $group: {
                    _id: '$phoneNormalized',
                    lastInboundAt: { $max: { $cond: [{ $eq: ['$direction', 'inbound'] }, '$occurredAt', null] } },
                    lastOutboundAt: { $max: { $cond: [{ $eq: ['$direction', 'outbound'] }, '$occurredAt', null] } },
                },
            },
        ])
        : [];
    const byPhone = new Map(convos.map((c) => [c._id, c]));

    const out = [];
    for (const lead of leads) {
        const c = byPhone.get(lead.phoneNormalized);
        if (!c) continue;
        if (!wentQuiet({
            lastInboundAt: c.lastInboundAt,
            lastOutboundAt: c.lastOutboundAt,
            leadStatus: lead.status,
            followUpAt: lead.followUpAt,
            now,
            days: threshold,
        })) continue;

        out.push({
            leadId: String(lead._id),
            name: lead.fullName || lead.whatsappProfileName || 'Unknown',
            phone: lead.phone || lead.phoneNormalized,
            phoneNormalized: lead.phoneNormalized,
            ownerId: lead.owner?._id ? String(lead.owner._id) : null,
            ownerName: lead.owner?.name || 'Unassigned',
            since: c.lastOutboundAt,
            daysQuiet: quietDays(c.lastOutboundAt, now),
        });
    }

    out.sort((a, b) => new Date(a.since) - new Date(b.since));
    return out;
}

/**
 * The AI's read of why each one went quiet, one short sentence.
 *
 * Reuses conversationSummary's own cache (keyed on the newest message id), so
 * a thread already summarised — from the inbox's own summary button, or an
 * earlier call here — costs nothing to read again. Only a conversation that
 * has genuinely moved since it was last read costs a model call. A summary
 * that fails or is unconfigured is left null rather than guessed at.
 */
export async function attachReasons(leads) {
    const results = await Promise.all(leads.map(async (l) => {
        try {
            const s = await summariseConversation(l.phoneNormalized);
            if (!s?.configured || s.empty || s.error) return { ...l, reason: null, temperature: null };
            return { ...l, reason: s.headline || null, temperature: s.temperature || null };
        } catch {
            return { ...l, reason: null, temperature: null };
        }
    }));
    return results;
}

/**
 * When each one was last sent a quiet-follow-up, and by whom — the fact
 * behind the "already messaged 5 hours ago" warning. Only the most recent
 * send matters for the warning, found with one grouped query rather than one
 * round trip per lead.
 */
export async function attachLastNudge(leads) {
    const leadIds = leads.map((l) => l.leadId);
    if (!leadIds.length) return leads;

    const rows = await LeadFollowUp.aggregate([
        { $match: { lead: { $in: leadIds.map((id) => new Types.ObjectId(id)) }, status: 'sent' } },
        { $sort: { sentAt: -1 } },
        { $group: { _id: '$lead', sentAt: { $first: '$sentAt' }, sentByName: { $first: '$sentByName' } } },
    ]);
    const byLead = new Map(rows.map((r) => [String(r._id), r]));
    return leads.map((l) => {
        const r = byLead.get(l.leadId);
        return { ...l, lastNudgedAt: r?.sentAt || null, lastNudgedBy: r?.sentByName || '' };
    });
}

/** Which chart bucket a days-quiet count falls into. Pure, so the boundaries
 *  (4/6, matching the 3-day default threshold) can be tested without a
 *  database standing behind them. */
export function bucketOf(daysQuiet) {
    const d = Number(daysQuiet) || 0;
    return d <= 4 ? '3-4 days' : d <= 6 ? '5-6 days' : '7+ days';
}

/** Counts by how-long-quiet bucket, for the dashboard chart — and per owner,
 *  so admin can see it is not evenly spread. */
export async function quietSummary({ ownerId = null } = {}) {
    const leads = await quietLeads({ ownerId });
    const buckets = new Map();
    const byOwner = new Map();
    for (const l of leads) {
        const b = bucketOf(l.daysQuiet);
        buckets.set(b, (buckets.get(b) || 0) + 1);
        const key = l.ownerId || 'unassigned';
        const row = byOwner.get(key) || { ownerId: l.ownerId, ownerName: l.ownerName, count: 0 };
        row.count += 1;
        byOwner.set(key, row);
    }
    return {
        total: leads.length,
        buckets: [...buckets.entries()].map(([bucket, count]) => ({ bucket, count })),
        byOwner: [...byOwner.values()].sort((a, b) => b.count - a.count),
    };
}

/**
 * Send an approved template to a batch of quiet leads.
 *
 * Each is independent — one bad number does not stop the other five — and
 * every attempt is logged, sent or failed, which is what lets the warning and
 * the report both work off the same record rather than two that can drift.
 */
export async function sendQuietFollowUp({ leadIds, templateId, byUser, template, reasons = new Map() }) {
    if (!whatsappSendConfigured()) return { sent: [], failed: leadIds.map((id) => ({ leadId: id, reason: 'WhatsApp is not configured' })) };
    if (!template) return { sent: [], failed: leadIds.map((id) => ({ leadId: id, reason: 'Template not found' })) };
    if (!String(template.whatsappTemplate || '').trim()) {
        return { sent: [], failed: leadIds.map((id) => ({ leadId: id, reason: `"${template.label}" has no approved WhatsApp template` })) };
    }

    const leads = await Lead.find({ _id: { $in: leadIds } }).select('fullName phone phoneNormalized whatsappProfileName').lean();
    const byId = new Map(leads.map((l) => [String(l._id), l]));
    const name = String(template.whatsappTemplate).trim();
    const lang = String(template.whatsappTemplateLang || 'en').trim() || 'en';
    const threshold = await quietThreshold();
    const sentBy = byUser?.id || null;
    const sentByName = byUser?.name || byUser?.email || '';

    const sent = [];
    const failed = [];
    for (const leadId of leadIds) {
        const lead = byId.get(leadId);
        try {
            if (!lead) throw new Error('Lead not found');
            const phone = lead.phone || lead.phoneNormalized;
            if (!phone) throw new Error('No phone number on file');
            const reasonRow = reasons.get(leadId);
            const vars = { name: lead.fullName || lead.whatsappProfileName || '', reason: reasonRow?.reason || '' };
            const variables = (template.whatsappTemplateVars || []).map((k) => String(vars[k] ?? ''));

            await sendWhatsAppTemplate({ to: phone, name, language: lang, variables });

            await LeadFollowUp.create({
                lead: leadId, phoneNormalized: lead.phoneNormalized, sentBy, sentByName,
                template: template._id, templateLabel: template.label,
                reason: reasonRow?.reason || '', daysQuietAtSend: reasonRow?.daysQuiet ?? 0,
                status: 'sent',
            });
            await Lead.updateOne({ _id: leadId }, {
                $push: { timeline: { type: 'whatsapp_message', text: `Follow-up "${template.label}" sent after going quiet`, at: new Date() } },
            });
            sent.push({ leadId, name: lead.fullName, to: phone });
        } catch (e) {
            await LeadFollowUp.create({
                lead: leadId, phoneNormalized: lead?.phoneNormalized || '', sentBy, sentByName,
                template: template._id, templateLabel: template.label,
                daysQuietAtSend: reasons.get(leadId)?.daysQuiet ?? 0,
                status: 'failed', error: e.message,
            }).catch(() => { });
            failed.push({ leadId, name: lead?.fullName || '', reason: e.message });
        }
    }

    return { sent, failed, template: name, threshold };
}

/**
 * They wrote back after a nudge, so it is no longer "still quiet".
 *
 * Marks the most recent un-replied send for this number, matching the same
 * "only the latest matters" rule the warning itself uses. Never throws — a
 * message must be delivered whatever bookkeeping does with it.
 */
export async function markQuietFollowUpReplied(phoneNormalized, at = new Date()) {
    try {
        await LeadFollowUp.findOneAndUpdate(
            { phoneNormalized, status: 'sent', repliedAt: null, sentAt: { $lte: at } },
            { $set: { repliedAt: at } },
            { sort: { sentAt: -1 } },
        );
    } catch (e) {
        console.error('[LeadFollowUp] could not record a reply:', e.message);
    }
}
