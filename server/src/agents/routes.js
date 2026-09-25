/**
 * /api/agents — the agents' API. Anything that changes an agent, a lead's
 * file, or sends something is admin-only; reading is open to anyone signed in.
 */

import { Router } from 'express';
import { Lead, User } from '../models/index.js';
import { AgentProfile, AgentLeadFile, AgentAction, AGENT_MODES, AGENT_TOOLS, RESOLUTIONS } from './models.js';
import { BUCKETS, BUCKET_ORDER, describeStage, DEFAULT_CADENCE, nextTouchFor } from './buckets.js';
import { runAgent, findLead, cadenceFor } from './runtime.js';
import { adoptLead, applyEvent, runAgentTick, team, forgetTeamCache, inbox, resolveAction, pipelineStats, teamStats, conversationFor } from './service.js';
import { record, revert, snapshotOf } from './log.js';
import { seedStarterTeam } from './seed.js';
import { listWhatsAppTemplates } from '../services/whatsapp.js';

const router = Router();
const admin = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' }));
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(e.status || 400).json({ error: e.message }));
const OWNABLE = [...BUCKET_ORDER, 'tenant'];

/* ---------- profiles: onboarding ---------- */

router.get('/profiles', wrap(async (_req, res) => {
    const profiles = await AgentProfile.find().populate('escalateTo', 'name email').sort({ createdAt: 1 }).lean();
    const users = await User.find({ isActive: true }).select('name email role').lean();
    res.json({ profiles, users, tools: AGENT_TOOLS, modes: AGENT_MODES, buckets: OWNABLE, defaultCadence: DEFAULT_CADENCE });
}));

function readProfile(body, existing) {
    const p = {};
    if (body.name !== undefined) p.name = String(body.name || '').trim();
    if (body.role !== undefined) p.role = String(body.role || '').trim();
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
    if (Array.isArray(body.ownsBuckets)) p.ownsBuckets = body.ownsBuckets.filter((b) => OWNABLE.includes(b));
    if (Array.isArray(body.languages)) p.languages = body.languages.map((l) => String(l).trim().toLowerCase()).filter(Boolean);
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
    if (body.isDefault !== undefined) p.isDefault = Boolean(body.isDefault);
    if (body.dailyBudgetAed !== undefined) p.dailyBudgetAed = Math.max(0, Number(body.dailyBudgetAed) || 0);
    if (body.avatarColor !== undefined) p.avatarColor = String(body.avatarColor || '').slice(0, 20);
    if (body.isActive !== undefined) p.isActive = Boolean(body.isActive);
    return p;
}

/** A bucket has one owner: claiming it takes it from whoever had it. */
async function claimBuckets(profileId, buckets) {
    if (!buckets?.length) return;
    await AgentProfile.updateMany({ _id: { $ne: profileId }, ownsBuckets: { $in: buckets } }, { $pull: { ownsBuckets: { $in: buckets } } });
}

router.post('/profiles', admin, wrap(async (req, res) => {
    const p = readProfile(req.body, null);
    if (!p.name) throw new Error('An agent needs a name');
    if (!(await AgentProfile.countDocuments())) p.isDefault = true;
    const profile = await AgentProfile.create(p);
    await claimBuckets(profile._id, profile.ownsBuckets);
    if (profile.isDefault) await AgentProfile.updateMany({ _id: { $ne: profile._id } }, { $set: { isDefault: false } });
    forgetTeamCache();
    res.status(201).json(profile);
}));

router.put('/profiles/:id', admin, wrap(async (req, res) => {
    const existing = await AgentProfile.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'No such agent' });
    Object.assign(existing, readProfile(req.body, existing));
    await existing.save();
    await claimBuckets(existing._id, existing.ownsBuckets);
    if (existing.isDefault) await AgentProfile.updateMany({ _id: { $ne: existing._id } }, { $set: { isDefault: false } });
    forgetTeamCache();
    res.json(existing);
}));

/* ---------- the team, the inbox, the pipeline ---------- */

// Aisha, Omar, Layla and Sam, with their jobs and permissions. Safe to run
// again: it updates what is here and keeps an admin's edits.
router.post('/seed-team', admin, wrap(async (req, res) => {
    res.json({ team: await seedStarterTeam({ force: req.body?.force === true }) });
}));

router.get('/team', wrap(async (_req, res) => {
    const agents = await teamStats();
    res.json({ agents, buckets: BUCKET_ORDER.map((b) => ({ key: b, label: BUCKETS[b].label })) });
}));

router.get('/inbox', wrap(async (req, res) => {
    res.json(await inbox({ agentId: req.query.agent || null }));
}));

router.post('/actions/:id/resolve', admin, wrap(async (req, res) => {
    const resolution = String(req.body?.resolution || '');
    if (!RESOLUTIONS.includes(resolution)) throw new Error(`resolution must be one of ${RESOLUTIONS.join(', ')}`);
    res.json(await resolveAction(req.params.id, { resolution, text: req.body?.text || '', user: req.user }));
}));

router.get('/pipeline', wrap(async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const stats = await pipelineStats({ days });
    const bucket = BUCKET_ORDER.includes(req.query.bucket) ? req.query.bucket : null;
    const profiles = await team();
    const files = await AgentLeadFile.find(bucket ? { bucket } : {})
        .populate('lead', 'fullName phone status temperature').populate('agent', 'name avatarColor')
        .sort({ nextTouchAt: 1, lastActionAt: -1 }).limit(200).lean();
    const last = await AgentAction.aggregate([
        { $match: { leadFile: { $in: files.map((f) => f._id) } } }, { $sort: { at: -1 } },
        { $group: { _id: '$leadFile', summary: { $first: '$summary' }, kind: { $first: '$kind' }, at: { $first: '$at' } } },
    ]);
    const lastBy = new Map(last.map((l) => [String(l._id), l]));
    res.json({
        ...stats,
        buckets: BUCKET_ORDER.map((b) => ({ key: b, label: BUCKETS[b].label, count: stats.counts[b] })),
        rows: files.map((f) => {
            const agent = profiles.find((p) => String(p._id) === String(f.agent?._id));
            return {
                leadFileId: f._id, leadId: f.lead?._id, name: f.lead?.fullName || '—', phone: f.lead?.phone || '', temperature: f.lead?.temperature || '',
                bucket: f.bucket, bucketLabel: BUCKETS[f.bucket].label, stage: describeStage(f, cadenceFor(agent)),
                nextTouchAt: f.nextTouchAt, frozen: Boolean(f.frozenAt), agent: f.agent ? { name: f.agent.name, avatarColor: f.agent.avatarColor } : null,
                need: f.need, offers: f.offers, lastSummary: f.lastSummary, lastAction: lastBy.get(String(f._id)) || null,
            };
        }),
    });
}));

/* ---------- one lead ---------- */

router.get('/leads/:leadId', wrap(async (req, res) => {
    const file = await AgentLeadFile.findOne({ lead: req.params.leadId }).populate('lead', 'fullName phone status temperature createdAt').populate('agent', 'name role promptVersion avatarColor').lean();
    if (!file) return res.status(404).json({ error: 'No agent has a file on this lead yet' });
    const [actions, messages, profiles] = await Promise.all([
        AgentAction.find({ leadFile: file._id }).sort({ at: -1 }).limit(100).populate('user', 'name').populate('agent', 'name').lean(),
        conversationFor(file.phoneNormalized),
        team(),
    ]);
    const agent = profiles.find((p) => String(p._id) === String(file.agent?._id));
    res.json({ file: { ...file, bucketLabel: BUCKETS[file.bucket].label, stage: describeStage(file, cadenceFor(agent)) }, actions, messages });
}));

router.post('/leads/:leadId/adopt', admin, wrap(async (req, res) => {
    const lead = await Lead.findById(req.params.leadId).lean();
    if (!lead) return res.status(404).json({ error: 'No such lead' });
    const { file, created } = await adoptLead(lead, { user: req.user });
    res.status(created ? 201 : 200).json({ file, created });
}));

router.post('/adopt-open', admin, wrap(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.body?.limit) || 25));
    const taken = new Set((await AgentLeadFile.find().select('lead').lean()).map((f) => String(f.lead)));
    const leads = await Lead.find({ status: { $nin: ['won', 'lost', 'already_customer'] }, phoneNormalized: { $ne: '' } }).sort({ createdAt: -1 }).limit(limit * 2).lean();
    let created = 0;
    for (const lead of leads) {
        if (taken.has(String(lead._id)) || created >= limit) continue;
        await adoptLead(lead, { user: req.user });
        created += 1;
    }
    res.json({ created });
}));

router.post('/leads/:leadId/hand-back', admin, wrap(async (req, res) => {
    const file = await AgentLeadFile.findOne({ lead: req.params.leadId });
    if (!file) return res.status(404).json({ error: 'No file' });
    const lead = await Lead.findById(file.lead).lean();
    const r = await applyEvent(file, 'hand_back', { lead, actor: 'person', user: req.user, why: req.body?.note || '' });
    res.json({ changed: r.changed, bucket: file.bucket });
}));

router.post('/leads/:leadId/freeze', admin, wrap(async (req, res) => {
    const file = await AgentLeadFile.findOne({ lead: req.params.leadId });
    if (!file) return res.status(404).json({ error: 'No file' });
    const profiles = await team();
    const agent = profiles.find((p) => String(p._id) === String(file.agent));
    const before = snapshotOf(file);
    const freeze = req.body?.resume !== true;
    file.frozenAt = freeze ? new Date() : null;
    file.nextTouchAt = freeze ? null : nextTouchFor(file, cadenceFor(agent));
    await file.save();
    await record({
        agent, lead: file.lead, leadFile: file, kind: freeze ? 'frozen' : 'resumed',
        summary: freeze ? `Follow-ups stopped by ${req.user.name || 'a person'}${req.body?.note ? `: ${req.body.note}` : ''}` : `Follow-ups resumed by ${req.user.name || 'a person'}`,
        bucketBefore: before.bucket, bucketAfter: file.bucket, snapshotBefore: before, snapshotAfter: snapshotOf(file), revertible: true, actor: 'person', user: req.user,
    });
    res.json({ frozen: freeze, nextTouchAt: file.nextTouchAt });
}));

router.post('/actions/:id/revert', admin, wrap(async (req, res) => {
    res.json(await revert(req.params.id, req.user));
}));

/* ---------- training: watch it think ---------- */

router.post('/simulate', admin, wrap(async (req, res) => {
    const lead = await findLead({ leadId: req.body?.leadId, phone: req.body?.phone });
    if (!lead) return res.status(404).json({ error: 'No lead with that id or phone' });
    const kind = req.body?.trigger === 'touch' ? 'touch' : 'inbound';
    const text = String(req.body?.text || '').trim();
    if (kind === 'inbound' && !text) throw new Error('Type the message the customer sent');
    const { file } = await adoptLead(lead, { user: req.user });
    const profiles = await team();
    // Try a specific agent, or the lead's current owner.
    const agent = (req.body?.agentId && profiles.find((p) => String(p._id) === String(req.body.agentId))) || profiles.find((p) => String(p._id) === String(file.agent));
    if (!agent) throw new Error('No agent is on duty');
    const persist = req.body?.persist !== false;
    const now = new Date();
    if (persist && kind === 'inbound') { file.lastInboundAt = now; await applyEvent(file, 'inbound', { lead, now }); }
    const decision = await runAgent({ agent, lead, leadFile: file, trigger: { kind, text }, now, persist });
    res.json({ lead: { _id: lead._id, fullName: lead.fullName, phone: lead.phone }, agent: { _id: agent._id, name: agent.name }, decision, file: { bucket: file.bucket, need: file.need, offers: file.offers, openQuestions: file.openQuestions } });
}));

router.post('/tick', admin, wrap(async (_req, res) => {
    res.json(await runAgentTick());
}));

router.get('/templates', wrap(async (_req, res) => {
    const { configured, templates = [], error } = await listWhatsAppTemplates().catch((e) => ({ configured: false, templates: [], error: e.message }));
    res.json({ configured, error: error || '', templates: templates.filter((t) => t.status === 'APPROVED').map((t) => ({ name: t.name, language: t.language, bodyText: t.bodyText })) });
}));

export default router;
