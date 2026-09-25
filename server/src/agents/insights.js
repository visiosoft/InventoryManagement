/**
 * How an agent is doing, and how it could do better.
 *
 *   agentStats()   — the numbers: who it has approached, what people did
 *                    with its drafts, where it hands over, what came back.
 *   runRehearsal() — past conversations replayed through the agent, each
 *                    draft beside what a person actually replied. Nothing
 *                    is sent, no lead file is touched.
 *   reviewAgent()  — a manager's review written by the model from the
 *                    record above, ending in concrete instruction changes.
 *
 * The pure helpers at the top are what the tests cover.
 */

import { Lead, WhatsAppMessage } from '../models/index.js';
import { AgentAction, AgentLeadFile, AgentRehearsal, AgentReview } from './models.js';
import { chatJson, openaiConfigured, openaiModel } from '../services/openai.js';
import { runAgent } from './runtime.js';
import { freshState, BUCKETS } from './buckets.js';

/* ---------- pure ---------- */

export const HANDOVER_REASONS = {
    discount: 'Discount asked',
    account: 'Existing contract, invoice or payment',
    person: 'Asked for a person',
    figures: "Couldn't back a figure",
    limits: 'Ran out of tool rounds',
    template: 'No approved template',
    other: 'Other',
};

/** Which bucket of reasons a hand-over summary falls into. */
export function classifyHandover(summary) {
    // Every hand-over summary starts "Handed to a person: …" — the reason
    // is what comes after, and "a person" in the prefix must not count.
    const s = String(summary || '').toLowerCase().replace(/^handed to a person:\s*/, '');
    if (/discount|cheaper|price match|lower price|negotiat/.test(s)) return 'discount';
    if (/invoice|payment|contract|renewal|refund|complain|tenant/.test(s)) return 'account';
    if (/figures? not backed|ungrounded|not backed by/.test(s)) return 'figures';
    if (/tool rounds/.test(s)) return 'limits';
    if (/template/.test(s)) return 'template';
    if (/speak to|talk to|a person|human|colleague|someone/.test(s)) return 'person';
    return 'other';
}

/** Group a list of actions into what the stats page shows. */
export function shapeStats(actions, files, { now = new Date(), days = 14 } = {}) {
    const k = (kind) => actions.filter((a) => a.kind === kind).length;
    const approved = k('approved'); const edited = k('edited'); const dismissed = k('dismissed');
    const judged = approved + edited + dismissed;
    const handovers = {};
    for (const a of actions) if (a.kind === 'escalated') { const c = classifyHandover(a.summary); handovers[c] = (handovers[c] || 0) + 1; }
    const moves = (from, to) => actions.filter((a) => a.kind === 'bucket_moved' && from.includes(a.bucketBefore) && a.bucketAfter === to).length;
    const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
    const series = [];
    for (let i = days - 1; i >= 0; i--) {
        const key = dayKey(new Date(now.getTime() - i * 86_400_000));
        const day = actions.filter((a) => dayKey(a.at) === key);
        series.push({ day: key, drafted: day.filter((a) => a.kind === 'reply_drafted' || a.kind === 'touch_proposed').length, approved: day.filter((a) => a.kind === 'approved').length, edited: day.filter((a) => a.kind === 'edited').length, dismissed: day.filter((a) => a.kind === 'dismissed').length });
    }
    const buckets = {};
    for (const f of files) buckets[f.bucket] = (buckets[f.bucket] || 0) + 1;
    return {
        leadsInCare: files.length,
        peopleApproached: new Set(actions.filter((a) => a.lead).map((a) => String(a.lead))).size,
        drafts: k('reply_drafted'), touchesProposed: k('touch_proposed'),
        approved, edited, dismissed, judged, approvedRate: judged ? Math.round((approved / judged) * 100) : null,
        handedOver: k('escalated'), handedIn: k('handoff'), reverted: k('reverted'),
        handovers: Object.entries(handovers).sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, label: HANDOVER_REASONS[key], n })),
        cameBack: moves(['quiet', 'dormant'], 'engaged'), toQuoted: moves(['engaged', 'new'], 'quoted'), toBooking: moves(['quoted'], 'booking'), won: moves(['booking', 'quoted'], 'won'),
        buckets, series,
    };
}

/* ---------- stats ---------- */

export async function agentStats(agentId, { now = new Date(), days = 30 } = {}) {
    const since = new Date(now.getTime() - days * 86_400_000);
    const [actions, files] = await Promise.all([
        AgentAction.find({ agent: agentId, at: { $gte: since } }).select('kind summary lead bucketBefore bucketAfter at').lean(),
        AgentLeadFile.find({ agent: agentId }).select('bucket').lean(),
    ]);
    const allTimePeople = await AgentAction.distinct('lead', { agent: agentId, lead: { $ne: null } });
    return { days, ...shapeStats(actions, files, { now }), peopleApproachedAllTime: allTimePeople.length };
}

/* ---------- rehearsal ---------- */

/** Recent conversations where a customer wrote and a person replied. */
async function pickConversations({ limit, now }) {
    const since = new Date(now.getTime() - 90 * 86_400_000);
    const rows = await WhatsAppMessage.aggregate([
        { $match: { occurredAt: { $gte: since }, type: 'text', text: { $ne: '' } } },
        { $group: { _id: '$phoneNormalized', inbound: { $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] } }, human: { $sum: { $cond: [{ $and: [{ $eq: ['$direction', 'outbound'] }, { $ne: ['$sentByAi', true] }] }, 1, 0] } }, last: { $max: '$occurredAt' } } },
        { $match: { inbound: { $gte: 1 }, human: { $gte: 1 } } },
        { $sort: { last: -1 } },
        { $limit: limit * 3 },
    ]);
    const out = [];
    for (const r of rows) {
        const lead = await Lead.findOne({ phoneNormalized: r._id }).sort({ createdAt: -1 }).select('fullName phoneNormalized status').lean();
        if (lead) out.push(lead);
        if (out.length >= limit) break;
    }
    return out;
}

export async function startRehearsal(agent, { conversations = 8, turns = 3, now = new Date() } = {}) {
    const doc = await AgentRehearsal.create({ agent: agent._id, promptVersion: agent.promptVersion, model: agent.model || openaiModel(), params: { conversations, turns } });
    // Runs on its own; the page polls. A failure is recorded, never thrown.
    (async () => {
        try {
            const leads = await pickConversations({ limit: conversations, now });
            doc.progress.total = leads.length * turns;
            await doc.save();
            for (const lead of leads) {
                const msgs = await WhatsAppMessage.find({ phoneNormalized: lead.phoneNormalized, type: 'text', text: { $ne: '' }, occurredAt: { $gte: new Date(now.getTime() - 90 * 86_400_000) } })
                    .sort({ occurredAt: 1 }).select('direction text occurredAt sentByAi').lean();
                const inbound = msgs.filter((m) => m.direction === 'inbound').slice(0, turns);
                for (const m of inbound) {
                    const humanReply = msgs.find((x) => x.direction === 'outbound' && !x.sentByAi && x.occurredAt > m.occurredAt && x.occurredAt - m.occurredAt < 48 * 3600_000);
                    const turn = { lead: lead._id, leadName: lead.fullName, at: m.occurredAt, customerText: m.text, humanReply: humanReply?.text || '' };
                    try {
                        const file = { ...freshState(m.occurredAt), phoneNormalized: lead.phoneNormalized, need: {}, offers: [], openQuestions: [], lastSummary: '' };
                        const d = await runAgent({ agent, lead, leadFile: file, trigger: { kind: 'inbound', text: m.text, until: m.occurredAt }, now: new Date(m.occurredAt), persist: false });
                        Object.assign(turn, { agentReply: d.reply, needsHuman: d.needsHuman, reason: d.reason, groundedOk: d.grounded.ok, loose: d.grounded.loose, tools: d.toolCalls.map((c) => c.name) });
                    } catch (e) {
                        turn.error = e.message;
                    }
                    doc.turns.push(turn);
                    doc.progress.done += 1;
                    await doc.save();
                }
            }
            const t = doc.turns.filter((x) => !x.error);
            doc.summary = { turns: t.length, grounded: t.filter((x) => x.groundedOk).length, handedOver: t.filter((x) => x.needsHuman).length, withHumanReply: t.filter((x) => x.humanReply).length, conversations: leads.length };
            doc.status = 'done';
        } catch (e) {
            doc.status = 'failed';
            doc.error = e.message;
        }
        doc.finishedAt = new Date();
        await doc.save();
    })();
    return doc;
}

/* ---------- the review ---------- */

const REVIEW_SYSTEM = [
    'You are an experienced sales manager at a self-storage company in Dubai, reviewing the work of an AI sales agent on your team.',
    'You are given the agent\'s job (its instructions), its numbers for the period, hand-over reasons, examples of drafts that people approved, edited or dismissed (with what they changed them to), and a rehearsal: the agent\'s draft beside what a human rep actually replied to the same customer message.',
    'Judge it the way you would judge a new hire: what it does well, where it costs the business (wrong tone, missed qualification, hand-overs that a rule could have handled, replies too long, invented figures), and what to change.',
    'Be concrete and honest. Every weakness must be tied to something in the evidence. Every suggestion must be an actual sentence or two that could be pasted into the agent\'s instructions, and say which section it belongs in: who, talk, sell, or hand.',
    'Reply with JSON only: {"summary": string (three sentences), "grade": "A"|"B"|"C"|"D", "strengths": string[], "weaknesses": string[], "suggestions": [{"section": "who"|"talk"|"sell"|"hand", "change": string (one line), "why": string (one line, from the evidence), "text": string (the instruction to add)}]}',
    'At most four strengths, four weaknesses, four suggestions. If the evidence is thin, say so in the summary and grade with what you have.',
].join('\n');

export async function reviewAgent(agent, { now = new Date(), days = 30 } = {}) {
    if (!openaiConfigured()) throw new Error('OpenAI is not configured');
    const stats = await agentStats(agent._id, { now, days });
    const rehearsal = await AgentRehearsal.findOne({ agent: agent._id, status: 'done' }).sort({ finishedAt: -1 }).lean();
    const judged = await AgentAction.find({ agent: agent._id, kind: { $in: ['edited', 'dismissed', 'approved'] } }).sort({ at: -1 }).limit(12).select('kind summary detail at').lean();
    const drafts = [];
    for (const j of judged) {
        const of = j.detail?.of ? await AgentAction.findById(j.detail.of).select('detail').lean() : null;
        drafts.push({ what: j.kind, customer: of?.detail?.customerText || '', agentDraft: of?.detail?.reply || '', sentInstead: j.detail?.sentText || '' });
    }
    const handovers = await AgentAction.find({ agent: agent._id, kind: 'escalated' }).sort({ at: -1 }).limit(10).select('summary').lean();
    const evidence = {
        agent: { name: agent.name, role: agent.role, ownsBuckets: (agent.ownsBuckets || []).map((b) => BUCKETS[b]?.label || b), instructions: agent.systemPrompt },
        periodDays: days,
        numbers: { leadsInCare: stats.leadsInCare, peopleApproached: stats.peopleApproached, drafts: stats.drafts, touchesProposed: stats.touchesProposed, approved: stats.approved, edited: stats.edited, dismissed: stats.dismissed, approvedRate: stats.approvedRate, handedOver: stats.handedOver, cameBack: stats.cameBack, toQuoted: stats.toQuoted, toBooking: stats.toBooking },
        handoverReasons: stats.handovers,
        recentHandovers: handovers.map((h) => h.summary),
        judgedDrafts: drafts,
        rehearsal: rehearsal ? { conversations: rehearsal.summary.conversations, turns: rehearsal.summary.turns, grounded: rehearsal.summary.grounded, handedOver: rehearsal.summary.handedOver, samples: rehearsal.turns.filter((t) => !t.error).slice(0, 12).map((t) => ({ customer: t.customerText, agent: t.agentReply || `(handed over: ${t.reason})`, rep: t.humanReply || '(no reply recorded)' })) } : null,
    };
    const parsed = await chatJson({ system: REVIEW_SYSTEM, messages: [{ role: 'user', content: JSON.stringify(evidence) }], model: agent.model || undefined, maxTokens: 1200, temperature: 0.3 });
    if (!parsed) throw new Error('The model did not return a usable review');
    const review = {
        summary: String(parsed.summary || '').slice(0, 1200), grade: ['A', 'B', 'C', 'D'].includes(parsed.grade) ? parsed.grade : '',
        strengths: (parsed.strengths || []).slice(0, 4).map(String), weaknesses: (parsed.weaknesses || []).slice(0, 4).map(String),
        suggestions: (parsed.suggestions || []).slice(0, 4).map((s) => ({ section: ['who', 'talk', 'sell', 'hand'].includes(s.section) ? s.section : 'talk', change: String(s.change || ''), why: String(s.why || ''), text: String(s.text || '') })),
    };
    return AgentReview.create({ agent: agent._id, promptVersion: agent.promptVersion, model: agent.model || openaiModel(), periodDays: days, stats, rehearsal: rehearsal?._id || null, review });
}
