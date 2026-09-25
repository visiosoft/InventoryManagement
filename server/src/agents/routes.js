/**
 * /api/agents — the Agent Desk's API. Admin-only for anything that changes
 * an agent or a lead's file; reading is open to anyone signed in.
 */

import { Router } from 'express';
import { Lead, User } from '../models/index.js';
import { AgentProfile, AgentLeadFile, AgentAction, AGENT_MODES, AGENT_TOOLS } from './models.js';
import { BUCKETS, BUCKET_ORDER, describeStage, DEFAULT_CADENCE } from './buckets.js';
import { runAgent, findLead, cadenceFor } from './runtime.js';
import { adoptLead, applyEvent, runAgentTick, activeAgent, forgetAgentCache } from './service.js';
import { record, revert, snapshotOf } from './log.js';
import { listWhatsAppTemplates } from '../services/whatsapp.js';

const router = Router();
const admin = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' }));
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(e.status || 400).json({ error: e.message }));

/* ---------- profiles: onboarding an agent ---------- */

router.get('/profiles', wrap(async (_req, res) => {
    const profiles = await AgentProfile.find().populate('escalateTo', 'name email').sort({ createdAt: 1 }).lean();
    const users = await User.find({ isActive: true }).select('name email role').lean();
    res.json({ profiles, users, tools: AGENT_TOOLS, modes: AGENT_MODES, defaultCadence: DEFAULT_CADENCE });
}));

function readProfile(body, existing) {
    const p = {};
    if (body.name !== undefined) p.name = String(body.name || '').trim();
    if (body.systemPrompt !== undefined) {
        p.systemPrompt = String(body.systemPrompt || '');
        if (existing && p.systemPrompt !== existing.systemPrompt) p.promptVersion = (existing.promptVersion || 1) + 1;
    }
    if (body.model !== undefined) p.model = String(body.model || '');
    if (body.mode !== undefined) {
        if (!AGENT_MODES.includes(body.mode)) throw new Error(`mode must be one of ${AGENT_MODES.join(', ')} — live sending is not part of the prototype`);
        p.mode = body.mode;
    }
    if (Array.isArray(body.enabledTools)) p.enabledTools = body.enabledTools.filter((t) => AGENT_TOOLS.includes(t));
    if (Array.isArray(body.whatsappNumbers)) p.whatsappNumbers = body.whatsappNumbers.map((n) => String(n).replace(/\D/g, '')).filter(Boolean);
    if (body.cadence && typeof body.cadence === 'object') {
        p.cadence = {};
        for (const k of Object.keys(DEFAULT_CADENCE)) {
            const v = body.cadence[k];
            p.cadence[k] = Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n) && n > 0 && n <= 365).slice(0, 6) : [];
        }
    }
    if (body.escalateTo !== undefined) p.escalateTo = body.escalateTo || null;
    if (body.maxToolRounds !== undefined) p.maxToolRounds = Math.min(8, Math.max(1, Number(body.maxToolRounds) || 4));
    if (body.syncLeadStatus !== undefined) p.syncLeadStatus = Boolean(body.syncLeadStatus);
    if (body.isActive !== undefined) p.isActive = Boolean(body.isActive);
    return p;
}

router.post('/profiles', admin, wrap(async (req, res) => {
    const p = readProfile(req.body, null);
    if (!p.name) throw new Error('An agent needs a name');
    const profile = await AgentProfile.create(p);
    forgetAgentCache();
    res.status(201).json(profile);
}));

router.put('/profiles/:id', admin, wrap(async (req, res) => {
    const existing = await AgentProfile.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'No such agent' });
    Object.assign(existing, readProfile(req.body, existing));
    await existing.save();
    forgetAgentCache();
    res.json(existing);
}));

/* ---------- the desk ---------- */

router.get('/desk', wrap(async (req, res) => {
    const agent = await activeAgent();
    const cadence = cadenceFor(agent);
    const counts = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0]));
    for (const c of await AgentLeadFile.aggregate([{ $group: { _id: '$bucket', n: { $sum: 1 } } }])) counts[c._id] = c.n;

    const bucket = BUCKET_ORDER.includes(req.query.bucket) ? req.query.bucket : null;
    const files = await AgentLeadFile.find(bucket ? { bucket } : {})
        .populate('lead', 'fullName phone status temperature owner')
        .populate('agent', 'name')
        .sort({ nextTouchAt: 1, lastActionAt: -1 }).limit(200).lean();

    const last = await AgentAction.aggregate([
        { $match: { leadFile: { $in: files.map((f) => f._id) } } },
        { $sort: { at: -1 } },
        { $group: { _id: '$leadFile', summary: { $first: '$summary' }, kind: { $first: '$kind' }, at: { $first: '$at' } } },
    ]);
    const lastBy = new Map(last.map((l) => [String(l._id), l]));

    res.json({
        agent: agent ? { _id: agent._id, name: agent.name, mode: agent.mode, promptVersion: agent.promptVersion } : null,
        buckets: BUCKET_ORDER.map((b) => ({ key: b, label: BUCKETS[b].label, count: counts[b] })),
        rows: files.map((f) => ({
            leadFileId: f._id, leadId: f.lead?._id, name: f.lead?.fullName || '—', phone: f.lead?.phone || '', status: f.lead?.status, temperature: f.lead?.temperature || '',
            bucket: f.bucket, bucketLabel: BUCKETS[f.bucket].label, stage: describeStage(f, cadence),
            nextTouchAt: f.nextTouchAt, frozen: Boolean(f.frozenAt), agent: f.agent?.name || '',
            need: f.need, lastSummary: f.lastSummary,
            lastAction: lastBy.get(String(f._id)) || null,
        })),
    });
}));

router.get('/leads/:leadId', wrap(async (req, res) => {
    const file = await AgentLeadFile.findOne({ lead: req.params.leadId }).populate('lead', 'fullName phone status temperature').populate('agent', 'name promptVersion').lean();
    if (!file) return res.status(404).json({ error: 'The agent has no file on this lead yet' });
    const actions = await AgentAction.find({ leadFile: file._id }).sort({ at: -1 }).limit(100).populate('user', 'name').lean();
    const agent = await activeAgent();
    res.json({ file: { ...file, bucketLabel: BUCKETS[file.bucket].label, stage: describeStage(file, cadenceFor(agent)) }, actions });
}));

/* ---------- a person acting on a file ---------- */

router.post('/leads/:leadId/adopt', admin, wrap(async (req, res) => {
    const agent = await activeAgent();
    if (!agent) throw new Error('No agent is on duty — create one in shadow mode first');
    const lead = await Lead.findById(req.params.leadId).lean();
    if (!lead) return res.status(404).json({ error: 'No such lead' });
    const { file, created } = await adoptLead(lead, agent, { user: req.user });
    res.status(created ? 201 : 200).json({ file, created });
}));

router.post('/adopt-open', admin, wrap(async (req, res) => {
    const agent = await activeAgent();
    if (!agent) throw new Error('No agent is on duty — create one in shadow mode first');
    const limit = Math.min(100, Math.max(1, Number(req.body?.limit) || 25));
    const taken = new Set((await AgentLeadFile.find().select('lead').lean()).map((f) => String(f.lead)));
    const leads = await Lead.find({ status: { $nin: ['won', 'lost', 'already_customer'] }, phoneNormalized: { $ne: '' } }).sort({ createdAt: -1 }).limit(limit * 2).lean();
    let created = 0;
    for (const lead of leads) {
        if (taken.has(String(lead._id)) || created >= limit) continue;
        await adoptLead(lead, agent, { user: req.user });
        created += 1;
    }
    res.json({ created });
}));

router.post('/leads/:leadId/hand-back', admin, wrap(async (req, res) => {
    const file = await AgentLeadFile.findOne({ lead: req.params.leadId });
    if (!file) return res.status(404).json({ error: 'No file' });
    const agent = await activeAgent();
    const lead = await Lead.findById(file.lead).lean();
    const r = await applyEvent(file, 'hand_back', { agent, lead, actor: 'person', user: req.user, why: req.body?.note || '' });
    res.json({ changed: r.changed, bucket: file.bucket });
}));

router.post('/leads/:leadId/freeze', admin, wrap(async (req, res) => {
    const file = await AgentLeadFile.findOne({ lead: req.params.leadId });
    if (!file) return res.status(404).json({ error: 'No file' });
    const agent = await activeAgent();
    const before = snapshotOf(file);
    const freeze = req.body?.resume !== true;
    file.frozenAt = freeze ? new Date() : null;
    if (freeze) file.nextTouchAt = null;
    else { const { nextTouchFor } = await import('./buckets.js'); file.nextTouchAt = nextTouchFor(file, cadenceFor(agent)); }
    await file.save();
    await record({
        agent, lead: file.lead, leadFile: file, kind: freeze ? 'frozen' : 'resumed',
        summary: freeze ? `Cadence stopped by ${req.user.name || 'a person'}${req.body?.note ? `: ${req.body.note}` : ''}` : `Cadence resumed by ${req.user.name || 'a person'}`,
        bucketBefore: before.bucket, bucketAfter: file.bucket, snapshotBefore: before, snapshotAfter: snapshotOf(file), revertible: true, actor: 'person', user: req.user,
    });
    res.json({ frozen: freeze, nextTouchAt: file.nextTouchAt });
}));

router.post('/actions/:id/revert', admin, wrap(async (req, res) => {
    const row = await revert(req.params.id, req.user);
    res.json(row);
}));

/* ---------- watching it think ---------- */

router.post('/simulate', admin, wrap(async (req, res) => {
    const agent = await activeAgent();
    if (!agent) throw new Error('No agent is on duty — create one in shadow mode first');
    const lead = await findLead({ leadId: req.body?.leadId, phone: req.body?.phone });
    if (!lead) return res.status(404).json({ error: 'No lead with that id or phone' });
    const kind = req.body?.trigger === 'touch' ? 'touch' : 'inbound';
    const text = String(req.body?.text || '').trim();
    if (kind === 'inbound' && !text) throw new Error('Type the message the customer sent');
    const { file } = await adoptLead(lead, agent, { user: req.user });
    const persist = req.body?.persist !== false;
    const now = new Date();
    if (persist && kind === 'inbound') { file.lastInboundAt = now; await applyEvent(file, 'inbound', { agent, lead, now }); }
    const decision = await runAgent({ agent, lead, leadFile: file, trigger: { kind, text }, now, persist });
    if (persist && kind === 'inbound' && file.bucket === 'new' && decision.reply) await applyEvent(file, 'first_reply_sent', { agent, lead, now });
    res.json({ lead: { _id: lead._id, fullName: lead.fullName, phone: lead.phone }, decision, file: { bucket: file.bucket, need: file.need, offers: file.offers, openQuestions: file.openQuestions } });
}));

router.post('/tick', admin, wrap(async (_req, res) => {
    res.json(await runAgentTick());
}));

router.get('/templates', wrap(async (_req, res) => {
    const { configured, templates = [], error } = await listWhatsAppTemplates().catch((e) => ({ configured: false, templates: [], error: e.message }));
    res.json({ configured, error: error || '', templates: templates.filter((t) => t.status === 'APPROVED').map((t) => ({ name: t.name, language: t.language, bodyText: t.bodyText })) });
}));

export default router;
