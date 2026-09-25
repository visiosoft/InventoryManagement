/**
 * The agent's day: what happens when a customer writes in, and what the
 * clock does when a touch comes due. Routes and the webhook call in here;
 * nothing here sends a message (shadow mode).
 */

import { Lead } from '../models/index.js';
import { AgentProfile, AgentLeadFile } from './models.js';
import { transition, nextTouchFor, BUCKETS, LEAD_STATUS_FOR } from './buckets.js';
import { runAgent, cadenceFor } from './runtime.js';
import { record, snapshotOf, purgeExpiredDetail } from './log.js';

const SILENCE_MS = 24 * 3600_000;
const TICK_BATCH = 10;

let agentCache = { at: 0, agent: null };
/** The agent on duty. One for now; routing by number is Phase 4. */
export async function activeAgent({ force = false } = {}) {
    if (!force && Date.now() - agentCache.at < 30_000) return agentCache.agent;
    const agent = await AgentProfile.findOne({ isActive: true, mode: 'shadow' }).sort({ createdAt: 1 });
    agentCache = { at: Date.now(), agent };
    return agent;
}
export function forgetAgentCache() { agentCache = { at: 0, agent: null }; }

/** Give an agent a file on this lead, or fetch the one it has. */
export async function adoptLead(lead, agent, { user = null, now = new Date() } = {}) {
    let file = await AgentLeadFile.findOne({ lead: lead._id });
    if (file) return { file, created: false };
    const bucket = ['won', 'already_customer'].includes(lead.status) ? 'won'
        : lead.status === 'lost' ? 'lost'
            : lead.status === 'quotation_sent' ? 'quoted'
                : lead.status === 'new' ? 'new' : 'engaged';
    file = await AgentLeadFile.create({
        lead: lead._id, agent: agent._id, phoneNormalized: lead.phoneNormalized,
        bucket, anchorAt: now,
    });
    file.nextTouchAt = nextTouchFor(file, cadenceFor(agent));
    await file.save();
    await record({
        agent, lead, leadFile: file, kind: 'adopted',
        summary: `${agent.name} took on ${lead.fullName} (${BUCKETS[bucket].label}, from status "${lead.status}")`,
        bucketAfter: bucket, snapshotAfter: snapshotOf(file), actor: user ? 'person' : 'system', user, at: now,
    });
    return { file, created: true };
}

/** Apply a bucket event to a file, keep the human-facing status in step, log it. */
export async function applyEvent(file, event, { agent, lead, now = new Date(), actor = 'agent', user = null, why = '' } = {}) {
    const before = snapshotOf(file);
    const r = transition(file, event, { now, cadence: cadenceFor(agent) });
    if (!r.changed) return { changed: false, file };
    Object.assign(file, r.state);
    if (file.frozenAt) file.nextTouchAt = null;
    await file.save();
    const status = LEAD_STATUS_FOR[file.bucket];
    if (agent?.syncLeadStatus && status && lead && lead.status !== status && !['won', 'lost', 'already_customer'].includes(lead.status)) {
        await Lead.updateOne({ _id: lead._id }, { $set: { status } });
    }
    await record({
        agent, lead, leadFile: file, kind: event === 'escalate' ? 'escalated' : event === 'hand_back' ? 'handed_back' : 'bucket_moved',
        summary: before.bucket === file.bucket ? r.reason : `Moved ${BUCKETS[before.bucket].label} → ${BUCKETS[file.bucket].label}: ${r.reason}${why ? ` (${why})` : ''}`,
        bucketBefore: before.bucket, bucketAfter: file.bucket, snapshotBefore: before, snapshotAfter: snapshotOf(file),
        revertible: true, actor, user, at: now,
    });
    return { changed: true, file, reason: r.reason };
}

/**
 * A customer wrote in. Called from the WhatsApp webhook next to the
 * existing bot; must never throw into it.
 */
export async function onInbound({ phoneNormalized, text, occurredAt }) {
    const agent = await activeAgent();
    if (!agent) return { handled: false, reason: 'no agent on duty' };
    const lead = await Lead.findOne({ phoneNormalized }).sort({ createdAt: -1 }).lean();
    if (!lead) return { handled: false, reason: 'no lead' };
    const now = occurredAt ? new Date(occurredAt) : new Date();
    const { file } = await adoptLead(lead, agent, { now });
    file.lastInboundAt = now;
    await applyEvent(file, 'inbound', { agent, lead, now });
    if (BUCKETS[file.bucket].closed || file.bucket === 'with_person') return { handled: true, drafted: false, bucket: file.bucket };
    const decision = await runAgent({ agent, lead, leadFile: file, trigger: { kind: 'inbound', text: String(text || '') }, now });
    if (file.bucket === 'new' && decision.reply) await applyEvent(file, 'first_reply_sent', { agent, lead, now });
    return { handled: true, drafted: Boolean(decision.reply), bucket: file.bucket, decision };
}

/**
 * The clock. Every due touch is proposed (shadow), the cadence advances,
 * exhausted cadences fall through, and engaged leads that went silent
 * drop into Quiet. Never throws — a tick that fails must not stop the next.
 */
export async function runAgentTick({ now = new Date() } = {}) {
    const out = { proposed: 0, exhausted: 0, silenced: 0, failed: 0, purged: 0 };
    const agent = await activeAgent();
    if (!agent) return out;
    const cadence = cadenceFor(agent);

    // Engaged for a day with nothing new from them: on to the cadence.
    const stale = await AgentLeadFile.find({
        bucket: 'engaged', frozenAt: null,
        $or: [{ lastInboundAt: { $lte: new Date(now.getTime() - SILENCE_MS) } }, { lastInboundAt: null, anchorAt: { $lte: new Date(now.getTime() - SILENCE_MS) } }],
    }).limit(TICK_BATCH);
    for (const file of stale) {
        try {
            const lead = await Lead.findById(file.lead).lean();
            const r = await applyEvent(file, 'silence', { agent, lead, now });
            if (r.changed) out.silenced += 1;
        } catch (e) { out.failed += 1; console.error('[Agents] silence:', e.message); }
    }

    const due = await AgentLeadFile.find({ nextTouchAt: { $lte: now }, frozenAt: null, bucket: { $in: Object.keys(cadence) } }).limit(TICK_BATCH);
    for (const file of due) {
        try {
            const lead = await Lead.findById(file.lead).lean();
            if (!lead || ['lost', 'won', 'already_customer'].includes(lead.status)) {
                await applyEvent(file, lead?.status === 'won' ? 'signed' : 'declined', { agent, lead, now, actor: 'system' });
                continue;
            }
            await runAgent({ agent, lead, leadFile: file, trigger: { kind: 'touch', text: '' }, now });
            out.proposed += 1;
            // Advance the cadence whether or not a template was found — a
            // stuck touch would otherwise be re-proposed on every tick.
            const r = transition(file, 'touch_sent', { now, cadence });
            Object.assign(file, r.state);
            await file.save();
            if (!nextTouchFor(file, cadence)) {
                const ex = await applyEvent(file, 'exhausted', { agent, lead, now, actor: 'system' });
                if (ex.changed) out.exhausted += 1;
            }
        } catch (e) { out.failed += 1; console.error('[Agents] touch:', e.message); }
    }

    out.purged = await purgeExpiredDetail(now).catch(() => 0);
    return out;
}
