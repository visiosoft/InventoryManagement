/**
 * The lead distribution rules, and a way to see what they would do.
 *
 * Admin only: this decides who gets paid work.
 */

import { Router } from 'express';
import { Customer, Lead, LeadRoutingConfig, LeadRoutingRule, PushSubscription, User, WhatsAppMessage } from '../models/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { availability, countsForToday, digitTail, pickOwner, targetShares } from '../services/leadRouting.js';
import { runLeadSla } from '../services/leadSla.js';

const router = Router();
router.use(requireAdmin);

/* Sales reps only.
 *
 * Every dropdown on this page hands somebody leads to work, and that is a
 * rep's job — an admin appearing in the list is an invitation to give the
 * whole rotation to whoever set it up, which is how one person came to own 275
 * chats in the first place. */
const ROLES = ['sales_rep'];

async function loadConfig() {
   return (await LeadRoutingConfig.findOne()) ?? (await LeadRoutingConfig.create({}));
}

/**
 * Everything the settings page needs: the rules, who could have one, and what
 * has actually gone out today.
 */
router.get('/', async (_req, res) => {
   try {
      const [config, rules, people, counts, subscribed] = await Promise.all([
         loadConfig(),
         LeadRoutingRule.find({}).populate('user', 'name email role isActive').populate('fallbackUser', 'name').lean(),
         User.find({ isActive: true, role: { $in: ROLES } }).select('name email role').sort({ name: 1 }).lean(),
         countsForToday(),
         /* Who would actually hear about it.
          *
          * Sharing leads out is half a feature if the person it lands on is not
          * told, and a browser push only reaches somebody who has switched it
          * on once under My Account. Surfaced per rep so it is obvious who
          * still needs to, rather than being a silent gap. */
         PushSubscription.distinct('user'),
      ]);
      const notified = new Set(subscribed.map(String));

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
            pushEnabled: notified.has(String(r.user._id)),
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
      /* The two marks on the unanswered-lead clock, in minutes. Clamped rather
         than rejected: a typo should not be able to set a reminder to fire in
         a second or a reassignment to fire never-but-look-set. 0 means off. */
      for (const key of ['slaNudgeMinutes', 'slaReassignMinutes']) {
         if (req.body[key] !== undefined) {
            const n = Math.round(Number(req.body[key]));
            config[key] = Number.isFinite(n) ? Math.min(24 * 60, Math.max(0, n)) : 0;
         }
      }
      await config.save();
      res.json(config);
   } catch (e) {
      res.status(400).json({ error: e.message });
   }
});

/* What the clock would do right now, without waiting a minute for it or
   writing anything. This is how the settings get trusted before they are left
   to move somebody's leads on their own. */
router.get('/sla/preview', async (_req, res) => {
   try {
      res.json(await runLeadSla({ dry: true }));
   } catch (e) {
      res.status(500).json({ error: e.message });
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

/**
 * The chats that belong to somebody we already deal with.
 *
 * The setting above decides where a customer's chat goes from now on. It does
 * nothing about the ones already in the inbox — 114 of them, 87 sitting with
 * one admin because that is where every chat used to land. This finds them and
 * hands them over in one go.
 *
 * Matched on the last nine digits, the same rule behind the green Customer tag
 * in the inbox, so what this counts is exactly what somebody can see.
 */
async function customerChats() {
   const [customers, chatPhones] = await Promise.all([
      Customer.find({}).select('_id fullName phone phones').lean(),
      WhatsAppMessage.distinct('phoneNormalized'),
   ]);

   const tails = new Set();
   for (const c of customers) {
      for (const p of [c.phone, ...(c.phones || [])]) { const t = digitTail(p); if (t) tails.add(t); }
   }
   const phones = chatPhones.filter((p) => tails.has(digitTail(p)));
   const leads = await Lead.find({ phoneNormalized: { $in: phones } })
      .select('_id fullName phoneNormalized owner').populate('owner', 'name').lean();
   return { phones, leads };
}

router.get('/customer-chats', async (_req, res) => {
   try {
      const { phones, leads } = await customerChats();
      const byOwner = {};
      for (const l of leads) {
         const name = l.owner?.name ?? 'Nobody';
         byOwner[name] = (byOwner[name] || 0) + 1;
      }
      res.json({
         chats: phones.length,
         withLead: leads.length,
         // A chat with no lead behind it cannot be handed to anybody until one
         // exists, so it is counted separately rather than silently skipped.
         withoutLead: phones.length - leads.length,
         byOwner: Object.entries(byOwner).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

router.post('/customer-chats/assign', async (req, res) => {
   try {
      const owner = await User.findById(req.body?.userId).select('_id name');
      if (!owner) return res.status(400).json({ error: 'Choose somebody to hand them to' });

      const { leads } = await customerChats();
      const toMove = leads.filter((l) => String(l.owner?._id ?? l.owner ?? '') !== String(owner._id));
      if (!toMove.length) return res.json({ moved: 0, alreadyTheirs: leads.length, owner: owner.name });

      /* The same stamps a hand-off by hand sets: it is new to them, their
         two-minute clock starts, and the board stops calling it somebody
         else's. */
      const now = new Date();
      await Lead.updateMany(
         { _id: { $in: toMove.map((l) => l._id) } },
         { $set: { owner: owner._id, assignedAt: now, ownerSeenAt: null, firstResponseAt: null, assignedBy: req.user?.id ?? null, autoAssigned: false } },
      );
      res.json({ moved: toMove.length, alreadyTheirs: leads.length - toMove.length, owner: owner.name });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

export default router;
