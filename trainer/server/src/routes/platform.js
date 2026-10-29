import { Router } from 'express';
import * as M from '../models.js';
import { encrypt, hint, decrypt } from '../security.js';
import { verifyKey, DEFAULT_MODELS } from '../providers.js';

/**
 * Running the platform: every organisation at a glance, AI usage across
 * them, and the platform AI keys organisations without their own key use.
 * Platform admins only.
 */

const router = Router();
router.use((req, res, next) => (req.user?.platformAdmin ? next() : res.status(403).json({ error: 'Platform admins only' })));

router.get('/', async (_req, res, next) => {
   try {
      const p = (await M.Platform.findOne({ key: 'platform' }).lean()) || {};
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const [orgs, users, usage, members, records] = await Promise.all([
         M.Org.find().select('name slug plan activeSnapshot createdAt ai.provider connector.enabled').sort({ createdAt: -1 }).lean(),
         M.User.countDocuments(),
         M.Usage.aggregate([{ $match: { day: { $gte: since } } }, { $group: { _id: '$org', calls: { $sum: '$calls' }, input: { $sum: '$inputTokens' }, output: { $sum: '$outputTokens' }, platform: { $sum: { $cond: ['$platformKey', '$calls', 0] } } } }]),
         M.Member.aggregate([{ $group: { _id: '$org', n: { $sum: 1 } } }]),
         M.TrainingKnowledge.aggregate([{ $match: { status: { $in: ['approved', 'published'] } } }, { $group: { _id: '$org', n: { $sum: 1 } } }]),
      ]);
      const idx = (rows) => new Map(rows.map((r) => [String(r._id), r]));
      const u = idx(usage); const mm = idx(members); const rr = idx(records);
      res.json({
         platform: { provider: p.provider || 'anthropic', model: p.model || '', allowSignup: p.allowSignup !== false, anthropicKey: hint(p.anthropicKeyEnc ? decrypt(p.anthropicKeyEnc) : process.env.ANTHROPIC_API_KEY), openaiKey: hint(p.openaiKeyEnc ? decrypt(p.openaiKeyEnc) : process.env.OPENAI_API_KEY), defaults: DEFAULT_MODELS },
         users,
         orgs: orgs.map((o) => ({ id: String(o._id), name: o.name, slug: o.slug, plan: o.plan, createdAt: o.createdAt, ownKey: Boolean(o.ai?.provider), connected: Boolean(o.connector?.enabled), live: o.activeSnapshot, members: mm.get(String(o._id))?.n || 0, answers: rr.get(String(o._id))?.n || 0, usage30d: u.get(String(o._id)) || null })),
      });
   } catch (e) { next(e); }
});

router.patch('/', async (req, res, next) => {
   try {
      const b = req.body || {}; const set = {};
      if (['anthropic', 'openai'].includes(b.provider)) set.provider = b.provider;
      if (typeof b.model === 'string') set.model = b.model.trim();
      if (typeof b.allowSignup === 'boolean') set.allowSignup = b.allowSignup;
      for (const prov of ['anthropic', 'openai']) {
         const k = String(b[`${prov}Key`] || '').trim();
         if (!k) continue;
         const check = await verifyKey(prov, k, prov === (set.provider || b.provider) ? set.model : undefined);
         if (!check.ok) return res.status(400).json({ error: `${prov}: ${check.error}` });
         set[`${prov}KeyEnc`] = encrypt(k);
      }
      await M.Platform.updateOne({ key: 'platform' }, { $set: set }, { upsert: true });
      res.json({ ok: true });
   } catch (e) { next(e); }
});

router.patch('/orgs/:id', async (req, res, next) => {
   try {
      if (typeof req.body?.plan === 'string') await M.Org.updateOne({ _id: req.params.id }, { $set: { plan: req.body.plan.slice(0, 30) } });
      res.json({ ok: true });
   } catch (e) { next(e); }
});

export default router;
