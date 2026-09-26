/**
 * The agents' day: a customer writes in, the clock fires a due touch, a
 * person answers a draft. Routes and the WhatsApp webhook call in here.
 *
 * Shadow mode: the agents draft and propose, and nothing goes to a customer
 * until a person approves it from the inbox — at which point it is sent
 * through the same WhatsApp functions the console uses.
 */

import { Lead, WhatsAppMessage } from '../models/index.js';
import { AgentProfile, AgentLeadFile, AgentAction } from './models.js';
import { transition, nextTouchFor, BUCKETS, BUCKET_ORDER, LEAD_STATUS_FOR, describeStage } from './buckets.js';
import { runAgent, cadenceFor } from './runtime.js';
import { record, snapshotOf, purgeExpiredDetail } from './log.js';
import { routeFirstOwner, handoffFor, ownerForBucket } from './team.js';
import { sendWhatsAppText, whatsappSendConfigured } from '../services/whatsapp.js';
import { sendQuietFollowUp } from '../services/leadFollowUp.js';
import { sendMail, mailConfigured } from '../services/mail.js';
import { runJob, isDue } from './jobs.js';

const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textToHtml = (t) => String(t || '').split(/\n{2,}/).map((p) => `<p style="font-size:14px;color:#14081F">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');

const SILENCE_MS = 24 * 3600_000;
const TICK_BATCH = 10;

/* ---------- the team ---------- */

let teamCache = { at: 0, profiles: [] };
export async function team({ force = false } = {}) {
    if (!force && Date.now() - teamCache.at < 30_000) return teamCache.profiles;
    const profiles = await AgentProfile.find({ isActive: true }).sort({ createdAt: 1 });
    teamCache = { at: Date.now(), profiles };
    return profiles;
}
export function forgetTeamCache() { teamCache = { at: 0, profiles: [] }; }

async function agentOf(file) {
    const profiles = await team();
    return profiles.find((p) => String(p._id) === String(file.agent)) || null;
}

/* ---------- a lead joins ---------- */

const bucketForStatus = (status) => (['won', 'already_customer'].includes(status) ? 'won'
    : status === 'lost' ? 'lost'
        : status === 'quotation_sent' ? 'quoted'
            : status === 'new' ? 'new' : 'engaged');

/** Give the right agent a file on this lead, or fetch the one that exists. */
export async function adoptLead(lead, { user = null, now = new Date(), signals = {} } = {}) {
    let file = await AgentLeadFile.findOne({ lead: lead._id });
    if (file) return { file, created: false };
    const profiles = await team();
    const bucket = bucketForStatus(lead.status);
    // The first owner: routing rules, then whoever owns the bucket the lead
    // lands in, then the default.
    const agent = ownerForBucket(profiles, bucket) || routeFirstOwner(profiles, { ...signals, isTenant: lead.status === 'already_customer' });
    if (!agent) throw new Error('No agent is on duty');
    file = await AgentLeadFile.create({ lead: lead._id, agent: agent._id, phoneNormalized: lead.phoneNormalized, bucket, anchorAt: now });
    file.nextTouchAt = nextTouchFor(file, cadenceFor(agent));
    await file.save();
    await record({
        agent, lead, leadFile: file, kind: 'adopted',
        summary: `${agent.name} took on ${lead.fullName} (${BUCKETS[bucket].label}, from status "${lead.status}")`,
        bucketAfter: bucket, snapshotAfter: snapshotOf(file), actor: user ? 'person' : 'system', user, at: now,
    });
    return { file, created: true };
}

/* ---------- a bucket event, with handoff ---------- */

export async function applyEvent(file, event, { lead, now = new Date(), actor = 'agent', user = null, why = '' } = {}) {
    const profiles = await team();
    let agent = await agentOf(file);
    const before = snapshotOf(file);
    const r = transition(file, event, { now, cadence: cadenceFor(agent) });
    if (!r.changed) return { changed: false, file, agent };
    Object.assign(file, r.state);
    if (file.frozenAt) file.nextTouchAt = null;

    const next = handoffFor(profiles, { currentAgentId: file.agent, bucketBefore: before.bucket, bucketAfter: file.bucket, event });
    if (next) {
        // The new owner's cadence applies from here.
        file.agent = next._id;
        file.touchCount = 0;
        file.anchorAt = now;
        file.nextTouchAt = file.frozenAt ? null : nextTouchFor(file, cadenceFor(next));
    }
    await file.save();

    const status = LEAD_STATUS_FOR[file.bucket];
    if (agent?.syncLeadStatus && status && lead && lead.status !== status && !['won', 'lost', 'already_customer'].includes(lead.status)) {
        await Lead.updateOne({ _id: lead._id }, { $set: { status } });
    }
    await record({
        agent, lead, leadFile: file,
        kind: event === 'escalate' ? 'escalated' : event === 'hand_back' ? 'handed_back' : 'bucket_moved',
        summary: before.bucket === file.bucket ? r.reason : `Moved ${BUCKETS[before.bucket].label} → ${BUCKETS[file.bucket].label}: ${r.reason}${why ? ` (${why})` : ''}`,
        bucketBefore: before.bucket, bucketAfter: file.bucket, snapshotBefore: before, snapshotAfter: snapshotOf(file),
        revertible: true, actor, user, at: now,
    });
    if (next) {
        await record({
            agent: next, lead, leadFile: file, kind: 'handoff',
            summary: `Passed from ${agent?.name || 'nobody'} to ${next.name} — entered ${BUCKETS[file.bucket].label}, which ${next.name} owns. The lead file went with it.`,
            detail: { from: agent?._id || null, to: next._id },
            bucketBefore: file.bucket, bucketAfter: file.bucket, actor: 'system', at: now,
        });
        agent = next;
    }
    return { changed: true, file, agent, reason: r.reason };
}

/* ---------- a customer writes in ---------- */

export async function onInbound({ phoneNormalized, text, occurredAt, businessNumber = '' }) {
    const profiles = await team();
    if (!profiles.some((p) => p.mode !== 'off')) return { handled: false, reason: 'no agent on duty' };
    const lead = await Lead.findOne({ phoneNormalized }).sort({ createdAt: -1 }).lean();
    if (!lead) return { handled: false, reason: 'no lead' };
    const now = occurredAt ? new Date(occurredAt) : new Date();
    const { file } = await adoptLead(lead, { now, signals: { businessNumber } });
    file.lastInboundAt = now;
    const { agent } = await applyEvent(file, 'inbound', { lead, now });
    if (BUCKETS[file.bucket].closed || file.bucket === 'with_person' || !agent || agent.mode === 'off') {
        return { handled: true, drafted: false, bucket: file.bucket };
    }
    const decision = await runAgent({ agent, lead, leadFile: file, trigger: { kind: 'inbound', text: String(text || '') }, now });
    return { handled: true, drafted: Boolean(decision.reply), bucket: file.bucket, decision };
}

/* ---------- the clock ---------- */

export async function runAgentTick({ now = new Date() } = {}) {
    const out = { proposed: 0, exhausted: 0, silenced: 0, failed: 0, purged: 0, jobs: 0 };
    const profiles = await team();
    if (!profiles.some((p) => p.mode !== 'off')) return out;

    // Scheduled agents whose hour has come. Stamped before the run so a
    // slow run cannot be started twice by the next tick.
    for (const agent of profiles.filter((p) => isDue(p, now))) {
        try {
            const { dubaiParts } = await import('./jobs.js');
            await AgentProfile.updateOne({ _id: agent._id }, { $set: { lastRunDay: dubaiParts(now).dayKey } });
            await runJob({ agent, now });
            out.jobs += 1;
        } catch (e) { out.failed += 1; console.error(`[Agents] ${agent.name}:`, e.message); }
    }

    const stale = await AgentLeadFile.find({
        bucket: 'engaged', frozenAt: null,
        $or: [{ lastInboundAt: { $lte: new Date(now.getTime() - SILENCE_MS) } }, { lastInboundAt: null, anchorAt: { $lte: new Date(now.getTime() - SILENCE_MS) } }],
    }).limit(TICK_BATCH);
    for (const file of stale) {
        try {
            const lead = await Lead.findById(file.lead).lean();
            const r = await applyEvent(file, 'silence', { lead, now });
            if (r.changed) out.silenced += 1;
        } catch (e) { out.failed += 1; console.error('[Agents] silence:', e.message); }
    }

    const cadenced = ['quoted', 'booking', 'quiet', 'dormant'];
    const due = await AgentLeadFile.find({ nextTouchAt: { $lte: now }, frozenAt: null, bucket: { $in: cadenced } }).limit(TICK_BATCH);
    for (const file of due) {
        try {
            const lead = await Lead.findById(file.lead).lean();
            const agent = await agentOf(file);
            if (!lead || ['lost', 'won', 'already_customer'].includes(lead.status)) {
                await applyEvent(file, lead?.status === 'won' ? 'signed' : 'declined', { lead, now, actor: 'system' });
                continue;
            }
            if (!agent || agent.mode === 'off') { file.nextTouchAt = null; await file.save(); continue; }
            const cadence = cadenceFor(agent);
            await runAgent({ agent, lead, leadFile: file, trigger: { kind: 'touch', text: '' }, now });
            out.proposed += 1;
            const r = transition(file, 'touch_sent', { now, cadence });
            Object.assign(file, r.state);
            await file.save();
            if (!nextTouchFor(file, cadence)) {
                const ex = await applyEvent(file, 'exhausted', { lead, now, actor: 'system' });
                if (ex.changed) out.exhausted += 1;
            }
        } catch (e) { out.failed += 1; console.error('[Agents] touch:', e.message); }
    }

    out.purged = await purgeExpiredDetail(now).catch(() => 0);
    return out;
}

/* ---------- the inbox: what a person needs to answer ---------- */

const lastCustomerLine = (detail) => {
    const msgs = Array.isArray(detail?.messages) ? detail.messages : [];
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') return String(msgs[i].content || '');
    return '';
};

export async function inbox({ agentId = null } = {}) {
    const pending = { kind: { $in: ['reply_drafted', 'touch_proposed', 'email_drafted'] }, resolution: null, ...(agentId ? { agent: agentId } : {}) };
    const rows = await AgentAction.find(pending).sort({ at: -1 }).limit(120)
        .populate('lead', 'fullName phone temperature').populate('agent', 'name role avatarColor').populate('leadFile', 'bucket touchCount need offers frozenAt').lean();
    const profiles = await team();
    const drafts = [];
    const touches = [];
    const emails = [];
    for (const a of rows) {
        if (a.kind === 'email_drafted') {
            emails.push({ actionId: a._id, at: a.at, agent: a.agent, to: a.detail?.to || '', subject: a.detail?.subject || '', body: a.detail?.body || '', why: a.detail?.why || '', from: a.detail?.from || '', originalSubject: a.detail?.originalSubject || '', customerText: a.detail?.customerText || '', grounded: a.detail?.grounded || null, needsHuman: Boolean(a.detail?.grounded && a.detail.grounded.ok === false) });
            continue;
        }
        if (!a.lead || !a.leadFile) continue;
        const agent = profiles.find((p) => String(p._id) === String(a.agent?._id));
        const base = {
            actionId: a._id, at: a.at, lead: a.lead, agent: a.agent, bucket: a.leadFile.bucket, bucketLabel: BUCKETS[a.leadFile.bucket]?.label,
            stage: describeStage(a.leadFile, cadenceFor(agent)), need: a.leadFile.need, frozen: Boolean(a.leadFile.frozenAt),
            needsHuman: Boolean(a.detail?.grounded && a.detail.grounded.ok === false) || /Handed to a person|hands to a person/i.test(a.summary),
            trace: (a.detail?.toolCalls || []).map((c) => c.name),
        };
        if (a.kind === 'reply_drafted') drafts.push({ ...base, customerText: a.detail?.customerText || lastCustomerLine(a.detail), reply: a.detail?.reply || '', grounded: a.detail?.grounded || null, summary: a.summary });
        else touches.push({ ...base, template: a.detail?.template || null, summary: a.summary });
    }
    const handedFiles = await AgentLeadFile.find({ bucket: 'with_person', ...(agentId ? { agent: agentId } : {}) })
        .populate('lead', 'fullName phone temperature status').populate('agent', 'name role avatarColor').sort({ lastActionAt: -1 }).limit(50).lean();
    const handed = [];
    for (const f of handedFiles) {
        const esc = await AgentAction.findOne({ leadFile: f._id, kind: 'escalated' }).sort({ at: -1 }).lean();
        handed.push({ leadFileId: f._id, lead: f.lead, agent: f.agent, previousBucket: f.previousBucket, need: f.need, offers: f.offers, openQuestions: f.openQuestions, lastSummary: f.lastSummary, why: esc?.summary?.replace(/^Handed to a person:\s*/, '') || '', at: esc?.at || f.lastActionAt });
    }
    // The latest report from each scheduled agent, from the last three days.
    const since = new Date(Date.now() - 3 * 86_400_000);
    const reportRows = await AgentAction.find({ kind: 'report', at: { $gte: since }, ...(agentId ? { agent: agentId } : {}) }).sort({ at: -1 }).limit(20).populate('agent', 'name role avatarColor').lean();
    const seen = new Set();
    const reports = [];
    for (const r of reportRows) {
        const key = String(r.agent?._id);
        if (seen.has(key)) continue;
        seen.add(key);
        reports.push({ actionId: r._id, at: r.at, agent: r.agent, summary: r.summary, text: r.detail?.summary || '', items: r.detail?.items || [], draftCount: r.detail?.draftCount || 0, needsHuman: Boolean(r.detail?.needsHuman), reason: r.detail?.reason || '' });
    }
    return { drafts, touches, handed, emails, reports };
}

/**
 * A person answers a draft or a proposed touch. Approving sends it as the
 * agent, through the same functions the console and the follow-up page use.
 */
export async function resolveAction(actionId, { resolution, text = '', user }) {
    const action = await AgentAction.findById(actionId).populate('lead').populate('agent');
    if (!action) throw new Error('That item does not exist');
    if (action.resolution) throw new Error('Already answered');
    if (!['reply_drafted', 'touch_proposed', 'email_drafted'].includes(action.kind)) throw new Error('Only drafts and proposed touches can be answered');
    const file = action.leadFile ? await AgentLeadFile.findById(action.leadFile) : null;
    const lead = action.lead;
    const agent = action.agent;
    const now = new Date();
    let sent = null;

    if ((resolution === 'approved' || resolution === 'edited') && action.kind === 'email_drafted') {
        if (!mailConfigured()) throw new Error('Email is not configured, so nothing can be sent');
        const body = String(resolution === 'edited' ? text : action.detail?.body || '').trim();
        if (!body) throw new Error('There is nothing to send');
        const subject = String(action.detail?.subject || '').trim() || `Re: ${action.detail?.originalSubject || ''}`.trim();
        sent = await sendMail({ to: action.detail?.to, subject, text: body, html: textToHtml(body), context: { kind: 'agent_email_reply', label: agent?.name || '' } });
        action.sentText = body;
    } else if (resolution === 'approved' || resolution === 'edited') {
        if (!whatsappSendConfigured()) throw new Error('WhatsApp is not configured, so nothing can be sent');
        if (action.kind === 'reply_drafted') {
            const body = String(resolution === 'edited' ? text : action.detail?.reply || '').trim();
            if (!body) throw new Error('There is nothing to send');
            sent = await sendWhatsAppText({ to: file.phoneNormalized, body });
            await WhatsAppMessage.create({
                messageId: sent?.messages?.[0]?.id || '', phone: file.phoneNormalized, phoneNormalized: file.phoneNormalized,
                direction: 'outbound', type: 'text', text: body, status: 'sent', occurredAt: now, sentByAi: true, raw: sent,
            });
            action.sentText = body;
            if (file.bucket === 'new') await applyEvent(file, 'first_reply_sent', { lead, now, actor: 'person', user });
        } else {
            const tpl = action.detail?.template;
            if (!tpl?.name) throw new Error('This touch has no approved template to send');
            const r = await sendQuietFollowUp({ leadIds: [String(lead._id)], template: { name: tpl.name, label: tpl.name, language: tpl.language || 'en', variableCount: 1 }, byUser: user });
            if (r.failed?.length) throw new Error(r.failed[0].reason || 'The template could not be sent');
            sent = r;
        }
    }

    action.resolution = resolution;
    action.resolvedAt = now;
    action.resolvedBy = user?.id || null;
    await action.save();

    const label = action.kind === 'reply_drafted' ? 'draft' : action.kind === 'email_drafted' ? 'email' : 'follow-up';
    await record({
        agent, lead, leadFile: file,
        kind: resolution === 'approved' ? 'approved' : resolution === 'edited' ? 'edited' : 'dismissed',
        summary: resolution === 'approved' ? `${user?.name || 'A person'} sent ${agent?.name || 'the agent'}'s ${label} as written`
            : resolution === 'edited' ? `${user?.name || 'A person'} edited ${agent?.name || 'the agent'}'s ${label} and sent it`
                : `${user?.name || 'A person'} ${resolution === 'skipped' ? 'skipped' : 'dismissed'} ${agent?.name || 'the agent'}'s ${label}`,
        detail: { of: action._id, sentText: action.sentText || '', template: action.detail?.template || null },
        bucketBefore: file?.bucket, bucketAfter: file?.bucket, actor: 'person', user, at: now,
    });
    return { ok: true, sent: Boolean(sent) };
}

/* ---------- numbers: the pipeline and the team's day ---------- */

export async function pipelineStats({ days = 30, now = new Date() } = {}) {
    const counts = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0]));
    for (const c of await AgentLeadFile.aggregate([{ $group: { _id: '$bucket', n: { $sum: 1 } } }])) counts[c._id] = c.n;
    const since = new Date(now.getTime() - days * 86_400_000);
    const moves = await AgentAction.find({ kind: { $in: ['bucket_moved', 'escalated', 'handed_back'] }, at: { $gte: since } }).select('bucketBefore bucketAfter').lean();
    const entered = {};
    const pair = {};
    for (const m of moves) {
        if (!m.bucketBefore || !m.bucketAfter || m.bucketBefore === m.bucketAfter) continue;
        entered[m.bucketAfter] = (entered[m.bucketAfter] || 0) + 1;
        const k = `${m.bucketBefore}>${m.bucketAfter}`;
        pair[k] = (pair[k] || 0) + 1;
    }
    const conv = (from, to) => {
        const left = Object.entries(pair).filter(([k]) => k.startsWith(`${from}>`)).reduce((s, [, n]) => s + n, 0);
        return left ? Math.round(((pair[`${from}>${to}`] || 0) / left) * 100) : null;
    };
    return {
        counts,
        conversion: {
            new_engaged: conv('new', 'engaged'), engaged_quoted: conv('engaged', 'quoted'), quoted_booking: conv('quoted', 'booking'), booking_won: conv('booking', 'won'),
            quiet_engaged: conv('quiet', 'engaged'), dormant_engaged: conv('dormant', 'engaged'),
        },
        dueThisWeek: await AgentLeadFile.countDocuments({ nextTouchAt: { $lte: new Date(now.getTime() + 7 * 86_400_000) }, frozenAt: null }),
        days,
    };
}

export async function teamStats({ now = new Date() } = {}) {
    const profiles = await team();
    const dayStart = new Date(now); dayStart.setUTCHours(dayStart.getUTCHours() - 4, 0, 0, 0); // Dubai midnight, roughly
    const today = await AgentAction.aggregate([
        { $match: { at: { $gte: dayStart } } },
        { $group: { _id: { agent: '$agent', kind: '$kind' }, n: { $sum: 1 } } },
    ]);
    const files = await AgentLeadFile.aggregate([{ $group: { _id: '$agent', n: { $sum: 1 } } }]);
    const filesBy = new Map(files.map((f) => [String(f._id), f.n]));
    return profiles.map((p) => {
        const k = (kind) => today.find((t) => String(t._id.agent) === String(p._id) && t._id.kind === kind)?.n || 0;
        const approved = k('approved'); const edited = k('edited'); const dismissed = k('dismissed');
        const judged = approved + edited + dismissed;
        return {
            _id: p._id, name: p.name, role: p.role, mode: p.mode, promptVersion: p.promptVersion, model: p.model, ownsBuckets: p.ownsBuckets, languages: p.languages,
            escalateTo: p.escalateTo, isDefault: p.isDefault, dailyBudgetAed: p.dailyBudgetAed, avatarColor: p.avatarColor, isActive: p.isActive,
            leads: filesBy.get(String(p._id)) || 0,
            today: { drafts: k('reply_drafted'), proposed: k('touch_proposed'), approved, edited, dismissed, handed: k('escalated'), approvedRate: judged ? Math.round((approved / judged) * 100) : null },
        };
    });
}

export async function conversationFor(phoneNormalized, { limit = 60 } = {}) {
    const rows = await WhatsAppMessage.find({ phoneNormalized, $or: [{ type: 'text', text: { $ne: '' } }, { transcript: { $ne: '' } }] })
        .sort({ occurredAt: -1 }).limit(limit).select('direction text transcript type occurredAt sentByAi').lean();
    return rows.reverse().map((m) => ({ direction: m.direction, text: m.text || m.transcript, type: m.type, at: m.occurredAt, byAi: Boolean(m.sentByAi) }));
}
