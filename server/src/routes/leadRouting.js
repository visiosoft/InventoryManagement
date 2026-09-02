/**
 * The lead distribution rules, and a way to see what they would do.
 *
 * Admin only: this decides who gets paid work.
 */

import { Router } from 'express';
import { LeadRoutingConfig, LeadRoutingRule, User } from '../models/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { availability, countsForToday, pickOwner, targetShares } from '../services/leadRouting.js';

const router = Router();
router.use(requireAdmin);

const ROLES = ['sales_rep', 'admin', 'accounts', 'staff'];

async function loadConfig() {
   return (await LeadRoutingConfig.findOne()) ?? (await LeadRoutingConfig.create({}));
}

/**
 * Everything the settings page needs: the rules, who could have one, and what
 * has actually gone out today.
 */
router.get('/', async (_req, res) => {
   try {
      const [config, rules, people, counts] = await Promise.all([
         loadConfig(),
         LeadRoutingRule.find({}).populate('user', 'name email role isActive').populate('fallbackUser', 'name').lean(),
         User.find({ isActive: true, role: { $in: ROLES } }).select('name email role').sort({ name: 1 }).lean(),
         countsForToday(),
      ]);

      // A rule for somebody who has since been deactivated is noise, not a rep.
      const live = rules.filter((r) => r.user && r.user.isActive !== false);
      const { available, excluded } = availability({ rules: live, counts });
      const shares = targetShares({ rules: live, available });
      const totalShare = [...shares.values()].reduce((s, v) => s + v, 0);

      res.json({
         config,
         people,
         rules: live.map((r) => ({
            ...r,
            todayCount: counts[String(r.user._id)] || 0,
            // What they are actually due right now, once absences are handed
            // on — which is not the same as the share they were typed in with.
            effectivePct: totalShare > 0 ? Math.round(((shares.get(String(r.user._id)) || 0) / totalShare) * 1000) / 10 : 0,
            unavailableBecause: excluded.find((e) => e.id === String(r.user._id))?.reason ?? null,
         })),
         totalSharePct: live.reduce((s, r) => s + (Number(r.sharePct) || 0), 0),
      });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

router.put('/config', async (req, res) => {
   try {
      const config = await loadConfig();
      for (const key of ['enabled', 'timeZone', 'outOfHoursMode', 'outOfHoursUser', 'existingCustomerUser']) {
         if (req.body[key] !== undefined) config[key] = req.body[key] || (key === 'enabled' ? false : null);
      }
      if (req.body.enabled !== undefined) config.enabled = Boolean(req.body.enabled);
      if (req.body.timeZone) config.timeZone = String(req.body.timeZone);
      await config.save();
      res.json(config);
   } catch (e) {
      res.status(400).json({ error: e.message });
   }
});

const FIELDS = ['sharePct', 'status', 'absentFrom', 'absentTo', 'dailyCap', 'workingHours', 'fallbackMode', 'fallbackUser', 'notes'];

/** One row per rep, created on first save. */
router.put('/rules/:userId', async (req, res) => {
   try {
      const user = await User.findById(req.params.userId).select('_id');
      if (!user) return res.status(404).json({ error: 'That person no longer exists' });

      const update = {};
      for (const key of FIELDS) if (req.body[key] !== undefined) update[key] = req.body[key];
      if (update.sharePct !== undefined) update.sharePct = Math.max(0, Number(update.sharePct) || 0);
      if (update.dailyCap !== undefined) update.dailyCap = Math.max(0, Number(update.dailyCap) || 0);
      if (update.fallbackUser === '') update.fallbackUser = null;
      // A stand-in cannot be the person they are standing in for.
      if (update.fallbackUser && String(update.fallbackUser) === String(user._id)) {
         return res.status(400).json({ error: 'Somebody cannot be their own stand-in' });
      }

      const rule = await LeadRoutingRule.findOneAndUpdate(
         { user: user._id }, { $set: update, $setOnInsert: { user: user._id } },
         { new: true, upsert: true, runValidators: true },
      ).populate('user', 'name email role').populate('fallbackUser', 'name');
      res.json(rule);
   } catch (e) {
      res.status(400).json({ error: e.message });
   }
});

router.delete('/rules/:userId', async (req, res) => {
   try {
      await LeadRoutingRule.deleteOne({ user: req.params.userId });
      res.json({ ok: true });
   } catch (e) {
      res.status(400).json({ error: e.message });
   }
});

/**
 * What would happen to the next n leads, right now.
 *
 * Nothing is written. Percentages on a page are hard to believe; a list of who
 * would actually get the next twenty is not.
 */
router.get('/preview', async (req, res) => {
   try {
      const n = Math.min(100, Math.max(1, Number(req.query.n) || 20));
      const [rules, counts, config] = await Promise.all([
         LeadRoutingRule.find({}).populate('user', 'name').lean(),
         countsForToday(),
         loadConfig(),
      ]);
      const live = rules.filter((r) => r.user);
      const tally = { ...counts };
      const order = [];
      for (let i = 0; i < n; i++) {
         const d = pickOwner({ rules: live, counts: tally, timeZone: config.timeZone });
         if (!d.ownerId) { order.push({ name: null, reason: d.reason }); continue; }
         tally[d.ownerId] = (tally[d.ownerId] || 0) + 1;
         order.push({ name: live.find((r) => String(r.user._id) === d.ownerId)?.user?.name ?? '—', reason: d.reason });
      }
      /* Somebody can have leads today without having a rule — they were given
         one by hand, or the rules changed under them — so names come from the
         user list, not only from the rules. An id in this table reads as a
         bug. */
      const owners = await User.find({ _id: { $in: Object.keys(tally) } }).select('name').lean();
      const nameOf = (id) => live.find((r) => String(r.user._id) === id)?.user?.name
         ?? owners.find((u) => String(u._id) === id)?.name
         ?? 'Someone no longer on the system';
      res.json({
         order,
         tallyAfter: Object.entries(tally).map(([id, n2]) => ({ name: nameOf(id), count: n2 })).sort((a, b) => b.count - a.count),
         startedFrom: Object.entries(counts).map(([id, n2]) => ({ name: nameOf(id), count: n2 })),
      });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

export default router;
