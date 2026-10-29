import { Router } from 'express';
import crypto from 'node:crypto';
import * as M from '../models.js';
import { scoped } from '../repo.js';
import { can } from '../core/knowledge.js';
import { encrypt, hint, sha256, randomToken } from '../security.js';
import { verifyKey, DEFAULT_MODELS } from '../providers.js';
import { assertPublicUrl, connectorClient } from '../connector.js';
import { audit } from '../service.js';

/**
 * One organisation's settings, team and keys. Every request names its
 * organisation (X-Org header); membership and role are checked here, on the
 * server, before anything is read.
 */

export async function orgContext(req, res, next) {
   try {
      const orgId = String(req.headers['x-org'] || '');
      if (!/^[0-9a-f]{24}$/i.test(orgId)) return res.status(400).json({ error: 'Choose an organisation' });
      const org = await M.Org.findById(orgId).lean();
      if (!org) return res.status(404).json({ error: 'Organisation not found' });
      const m = await M.Member.findOne({ org: org._id, user: req.user._id }).lean();
      // The platform admin can step in to support any organisation; it is logged.
      const role = m?.role || (req.user.platformAdmin ? 'admin' : null);
      if (!role) return res.status(403).json({ error: 'You are not a member of this organisation' });
      req.org = org; req.role = role; req.r = scoped(M, org._id); req.viaPlatform = !m;
      next();
   } catch (e) { next(e); }
}

export const need = (action) => (req, res, next) => (can(req.role, action) ? next() : res.status(403).json({ error: `Your role (${req.role}) cannot ${action}` }));
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const actor = (req) => ({ id: req.user.id, name: req.user.name || req.user.email });

/** What the settings page shows: secrets as hints only. Pure. */
export function orgView(org) {
   return {
      id: String(org._id), name: org.name, slug: org.slug, business: org.business, categories: org.categories, prohibited: org.prohibited,
      maxReplyLength: org.maxReplyLength, retentionDays: org.retentionDays, activeSnapshot: org.activeSnapshot, plan: org.plan,
      facts: org.facts, variables: org.variables,
      ai: { provider: org.ai?.provider || '', model: org.ai?.model || '', keyHint: org.ai?.keyHint || '', defaults: DEFAULT_MODELS },
      connector: { url: org.connector?.url || '', enabled: Boolean(org.connector?.enabled), hasToken: Boolean(org.connector?.tokenEnc), lastCheckAt: org.connector?.lastCheckAt, lastCheck: org.connector?.lastCheck || '' },
      whatsapp: { connected: Boolean(org.whatsapp?.verifyToken), phoneNumberId: org.whatsapp?.phoneNumberId || '', connectedAt: org.whatsapp?.connectedAt },
   };
}

const router = Router();
router.use(orgContext);

router.get('/', (req, res) => res.json({ org: orgView(req.org), role: req.role, permissions: ['import', 'review', 'approve', 'publish', 'evaluate', 'manage'].filter((a) => can(req.role, a)) }));

router.patch('/', need('manage'), wrap(async (req, res) => {
   const b = req.body || {}; const set = {};
   if (typeof b.name === 'string' && b.name.trim()) set.name = b.name.trim().slice(0, 80);
   if (typeof b.business === 'string') set.business = b.business.slice(0, 300);
   if (typeof b.facts === 'string') set.facts = b.facts.slice(0, 20000);
   if (Array.isArray(b.categories)) set.categories = [...new Set(b.categories.map((c) => String(c).trim()).filter(Boolean))].slice(0, 40).concat(b.categories.includes('Other') ? [] : ['Other']);
   if (Array.isArray(b.prohibited)) set.prohibited = b.prohibited.map((p) => String(p).trim()).filter(Boolean).slice(0, 50);
   if (Array.isArray(b.variables)) set.variables = b.variables.filter((v) => /^[a-z][a-z0-9_]{0,40}$/i.test(v?.name)).map((v) => ({ name: v.name.toLowerCase(), value: String(v.value ?? '').slice(0, 300) })).slice(0, 100);
   if (Number(b.maxReplyLength) >= 100) set.maxReplyLength = Math.min(Number(b.maxReplyLength), 4000);
   if (b.retentionDays !== undefined && Number(b.retentionDays) >= 0) set.retentionDays = Math.min(Number(b.retentionDays), 3650);
   const org = await M.Org.findByIdAndUpdate(req.org._id, { $set: set }, { new: true }).lean();
   await audit(req.r, actor(req), 'org.update', '', { fields: Object.keys(set) });
   res.json({ org: orgView(org) });
}));

/* ---------- AI provider (bring your own key) ---------- */

router.put('/ai', need('manage'), wrap(async (req, res) => {
   const { provider, model = '', key } = req.body || {};
   if (!['anthropic', 'openai'].includes(provider)) return res.status(400).json({ error: 'Choose Anthropic or OpenAI' });
   if (!String(key || '').trim()) return res.status(400).json({ error: 'Paste the API key' });
   const check = await verifyKey(provider, String(key).trim(), model || undefined);
   if (!check.ok) return res.status(400).json({ error: check.error });
   await M.Org.updateOne({ _id: req.org._id }, { $set: { ai: { provider, model: String(model).trim(), keyEnc: encrypt(String(key).trim()), keyHint: hint(String(key).trim()) } } });
   await audit(req.r, actor(req), 'ai.key_set', provider, { model });
   res.json({ ok: true });
}));
router.delete('/ai', need('manage'), wrap(async (req, res) => {
   await M.Org.updateOne({ _id: req.org._id }, { $set: { ai: { provider: '', model: '', keyEnc: '', keyHint: '' } } });
   await audit(req.r, actor(req), 'ai.key_removed');
   res.json({ ok: true });
}));

/* ---------- connected system ---------- */

router.put('/connector', need('manage'), wrap(async (req, res) => {
   const { url, token, enabled = true } = req.body || {};
   const clean = String(url || '').trim().replace(/\/+$/, '');
   try { await assertPublicUrl(clean); } catch (e) { return res.status(400).json({ error: e.message }); }
   const set = { 'connector.url': clean, 'connector.enabled': Boolean(enabled) };
   if (token) set['connector.tokenEnc'] = encrypt(String(token).trim());
   await M.Org.updateOne({ _id: req.org._id }, { $set: set });
   const org = await M.Org.findById(req.org._id).lean();
   let check = 'saved';
   try { const h = await connectorClient(org)?.health(); check = h?.ok ? `connected${h.name ? ` to ${String(h.name).slice(0, 60)}` : ''}` : 'no answer'; } catch (e) { check = `could not reach it: ${e.response?.status || e.message}`; }
   await M.Org.updateOne({ _id: req.org._id }, { $set: { 'connector.lastCheckAt': new Date(), 'connector.lastCheck': check } });
   await audit(req.r, actor(req), 'connector.set', clean, { check });
   res.json({ ok: true, check });
}));
router.delete('/connector', need('manage'), wrap(async (req, res) => {
   await M.Org.updateOne({ _id: req.org._id }, { $set: { connector: { url: '', tokenEnc: '', enabled: false } } });
   await audit(req.r, actor(req), 'connector.removed');
   res.json({ ok: true });
}));

/* ---------- WhatsApp Business (messages arrive from now on, by webhook) ---------- */

router.put('/whatsapp', need('manage'), wrap(async (req, res) => {
   const { appSecret, phoneNumberId = '' } = req.body || {};
   if (!String(appSecret || '').trim()) return res.status(400).json({ error: 'Paste the Meta app secret, so messages can be verified' });
   const verifyToken = req.org.whatsapp?.verifyToken || randomToken(18);
   await M.Org.updateOne({ _id: req.org._id }, { $set: { whatsapp: { verifyToken, appSecretEnc: encrypt(String(appSecret).trim()), phoneNumberId: String(phoneNumberId).trim(), connectedAt: new Date() } } });
   await audit(req.r, actor(req), 'whatsapp.connect', phoneNumberId);
   res.json({ ok: true, verifyToken, path: `/webhooks/whatsapp/${req.org._id}` });
}));
router.get('/whatsapp', need('manage'), (req, res) => res.json({ verifyToken: req.org.whatsapp?.verifyToken || '', path: `/webhooks/whatsapp/${req.org._id}` }));
router.delete('/whatsapp', need('manage'), wrap(async (req, res) => {
   await M.Org.updateOne({ _id: req.org._id }, { $set: { whatsapp: { verifyToken: '', appSecretEnc: '', phoneNumberId: '' } } });
   res.json({ ok: true });
}));

/* ---------- team ---------- */

router.get('/members', need('read'), wrap(async (req, res) => {
   const ms = await M.Member.find({ org: req.org._id }).populate('user', 'email name lastLoginAt').lean();
   const invites = can(req.role, 'manage') ? await M.Invite.find({ org: req.org._id, acceptedAt: null, expiresAt: { $gt: new Date() } }).select('email role expiresAt createdAt').lean() : [];
   res.json({ members: ms.filter((m) => m.user).map((m) => ({ id: String(m._id), userId: String(m.user._id), email: m.user.email, name: m.user.name, role: m.role, lastLoginAt: m.user.lastLoginAt })), invites, roles: M.ROLES });
}));
router.patch('/members/:id', need('manage'), wrap(async (req, res) => {
   if (!M.ROLES.includes(req.body?.role)) return res.status(400).json({ error: 'Unknown role' });
   const m = await M.Member.findOne({ _id: req.params.id, org: req.org._id });
   if (!m) return res.status(404).json({ error: 'Not found' });
   if (m.role === 'owner' && req.body.role !== 'owner' && (await M.Member.countDocuments({ org: req.org._id, role: 'owner' })) < 2) return res.status(400).json({ error: 'An organisation needs at least one owner' });
   m.role = req.body.role; await m.save();
   await audit(req.r, actor(req), 'member.role', m.user, { role: m.role });
   res.json({ ok: true });
}));
router.delete('/members/:id', need('manage'), wrap(async (req, res) => {
   const m = await M.Member.findOne({ _id: req.params.id, org: req.org._id });
   if (!m) return res.status(404).json({ error: 'Not found' });
   if (m.role === 'owner' && (await M.Member.countDocuments({ org: req.org._id, role: 'owner' })) < 2) return res.status(400).json({ error: 'An organisation needs at least one owner' });
   await m.deleteOne();
   await audit(req.r, actor(req), 'member.remove', m.user);
   res.json({ ok: true });
}));
router.post('/invites', need('manage'), wrap(async (req, res) => {
   const email = String(req.body?.email || '').toLowerCase().trim();
   const role = M.ROLES.includes(req.body?.role) ? req.body.role : 'reviewer';
   if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
   const token = randomToken(24);
   await M.Invite.create({ org: req.org._id, email, role, tokenHash: sha256(token), invitedBy: { userId: req.user.id, name: req.user.name }, expiresAt: new Date(Date.now() + 14 * 86_400_000) });
   await audit(req.r, actor(req), 'invite.create', email, { role });
   res.status(201).json({ token, note: 'Send this link to them. It works once, for 14 days.' });
}));
router.delete('/invites/:id', need('manage'), wrap(async (req, res) => {
   await M.Invite.deleteOne({ _id: req.params.id, org: req.org._id });
   res.json({ ok: true });
}));

/* ---------- API keys ---------- */

router.get('/keys', need('manage'), (req, res) => res.json({ keys: (req.org.apiKeys || []).map(({ hash: _h, ...k }) => k) }));
router.post('/keys', need('manage'), wrap(async (req, res) => {
   const id = crypto.randomBytes(6).toString('hex');
   const secret = randomToken(24);
   await M.Org.updateOne({ _id: req.org._id }, { $push: { apiKeys: { id, label: String(req.body?.label || 'API key').slice(0, 60), hash: sha256(secret), last4: secret.slice(-4), createdAt: new Date() } } });
   await audit(req.r, actor(req), 'key.create', id);
   res.status(201).json({ key: `tq_${id}_${secret}`, note: 'Copy it now — it is not shown again.' });
}));
router.delete('/keys/:id', need('manage'), wrap(async (req, res) => {
   await M.Org.updateOne({ _id: req.org._id, 'apiKeys.id': req.params.id }, { $set: { 'apiKeys.$.revokedAt': new Date() } });
   await audit(req.r, actor(req), 'key.revoke', req.params.id);
   res.json({ ok: true });
}));

/* ---------- usage, audit, export, delete ---------- */

router.get('/usage', need('read'), wrap(async (req, res) => {
   const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
   const rows = await M.Usage.find({ org: req.org._id, day: { $gte: since } }).lean();
   const by = (k) => Object.values(rows.reduce((a, r) => { const x = (a[r[k]] ||= { [k]: r[k], calls: 0, inputTokens: 0, outputTokens: 0 }); x.calls += r.calls; x.inputTokens += r.inputTokens; x.outputTokens += r.outputTokens; return a; }, {}));
   res.json({ since, byFeature: by('feature'), byModel: by('model'), platformCalls: rows.filter((r) => r.platformKey).reduce((n, r) => n + r.calls, 0) });
}));
router.get('/audit', need('manage'), wrap(async (req, res) => res.json({ audit: await req.r.audit.find({}, { sort: { at: -1 }, limit: 300 }) })));

router.get('/export', need('manage'), wrap(async (req, res) => {
   const [knowledge, clusters, snapshots] = await Promise.all([req.r.knowledge.find({}), req.r.clusters.find({}, { select: '-history' }), req.r.snapshots.find({})]);
   await audit(req.r, actor(req), 'org.export');
   res.setHeader('Content-Disposition', `attachment; filename="${req.org.slug}-ai-training-export.json"`);
   res.json({ exportedAt: new Date(), org: orgView(req.org), knowledge, clusters, snapshots });
}));

/** Right to delete: the organisation and everything stored for it. Owner only, with its name typed to confirm. */
router.delete('/', wrap(async (req, res) => {
   if (req.role !== 'owner') return res.status(403).json({ error: 'Only an owner can delete the organisation' });
   if (String(req.body?.confirm || '') !== req.org.name) return res.status(400).json({ error: 'Type the organisation name to confirm' });
   const id = req.org._id;
   await Promise.all([M.TrainingImport, M.TrainingQuestion, M.TrainingCluster, M.TrainingKnowledge, M.TrainingSnapshot, M.TrainingEval, M.TrainingFeedback, M.TrainingAudit, M.Message, M.Usage, M.Invite, M.Member].map((Mod) => Mod.deleteMany({ org: id })));
   await M.Org.deleteOne({ _id: id });
   res.json({ ok: true });
}));

export default router;
