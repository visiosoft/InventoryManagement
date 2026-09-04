/**
 * The owner's console: the customers themselves.
 *
 * Everything else in this system belongs to one customer. This does not — it
 * is the list of who they are, and it is the one place where acting on the
 * wrong row means acting on somebody else's whole company.
 *
 * So the guard is not "an admin". Every customer has admins, and theirs must
 * never reach this. It is an explicit list of addresses in the platform's own
 * environment, which is to say: on the server you control, not in a database a
 * customer's data shares.
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { Organisation, OrgUserIndex, PlatformAudit } from '../tenancy/control.js';
import { connectionFor, forgetDatabase } from '../tenancy/connections.js';
import { runInTenant } from '../tenancy/context.js';
import { provisionOrganisation } from '../tenancy/provision.js';
import { forgetOrganisation } from '../middleware/tenant.js';

const router = Router();

/** Who owns the platform. Addresses, comma-separated, in the environment. */
const owners = () => String(process.env.PLATFORM_OWNERS || '')
   .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Only the people who own the product.
 *
 * Refused rather than defaulted when the list is empty: a console that lets
 * everybody in until it is configured is a console that ships unconfigured.
 */
function requireOwner(req, res, next) {
   const list = owners();
   if (!list.length) {
      return res.status(503).json({
         error: 'The owner console is not set up. Add PLATFORM_OWNERS to the server environment — a comma-separated list of the email addresses allowed to manage customers.',
      });
   }
   const who = String(req.user?.email || '').toLowerCase();
   if (!list.includes(who)) return res.status(403).json({ error: 'Not allowed' });
   return next();
}

router.use(requireOwner);

const audit = (req, action, org, detail = '') => PlatformAudit()
   .create({ action, organisation: org?._id ?? org, actor: req.user?.email || '', detail })
   .catch(() => { /* an audit line must never be the reason an action fails */ });

/**
 * Every customer, with enough of a shape to recognise them by.
 *
 * The counts come from each customer's own database, asked for together. They
 * are the only figures here, and they are deliberately about size rather than
 * business: how much is in there, not what it says.
 */
router.get('/organisations', async (_req, res) => {
   try {
      const orgs = await Organisation().find().sort({ createdAt: -1 }).lean();
      const withCounts = await Promise.all(orgs.map(async (org) => {
         try {
            const connection = connectionFor(org.dbName);
            const counts = await runInTenant({ connection, org }, async () => {
               const { User, Unit, Contract, Lead } = await import('../models/index.js');
               const [users, units, contracts, leads] = await Promise.all([
                  User.countDocuments(), Unit.countDocuments(),
                  Contract.countDocuments(), Lead.countDocuments(),
               ]);
               return { users, units, contracts, leads };
            });
            return { ...org, counts };
         } catch (e) {
            // A customer whose database will not open is exactly what somebody
            // opens this page to find out about.
            return { ...org, counts: null, error: e.message };
         }
      }));
      res.json({ organisations: withCounts, owners: owners() });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

/** Set one up. The password comes back once and is never stored. */
router.post('/organisations', async (req, res) => {
   try {
      const out = await provisionOrganisation({
         name: req.body?.name,
         slug: req.body?.slug,
         ownerEmail: req.body?.ownerEmail,
         adminName: req.body?.adminName,
         demo: Boolean(req.body?.demo),
      });
      await audit(req, 'organisation.created', out.organisation, out.organisation.slug);
      res.status(201).json(out);
   } catch (e) {
      res.status(400).json({ error: e.message });
   }
});

/** Rename, change plan, suspend, or stop their scheduled jobs. */
router.patch('/organisations/:id', async (req, res) => {
   try {
      const update = {};
      for (const key of ['name', 'plan', 'timezone']) {
         if (req.body?.[key] !== undefined) update[key] = String(req.body[key]).trim();
      }
      if (req.body?.status !== undefined) {
         const allowed = ['trial', 'active', 'suspended', 'cancelled'];
         if (!allowed.includes(req.body.status)) {
            return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
         }
         update.status = req.body.status;
      }
      if (req.body?.jobsEnabled !== undefined) update.jobsEnabled = Boolean(req.body.jobsEnabled);

      const org = await Organisation().findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean();
      if (!org) return res.status(404).json({ error: 'No such customer' });

      // So a suspension takes effect now rather than when the cache expires.
      forgetOrganisation(org._id);
      await audit(req, 'organisation.updated', org, JSON.stringify(update));
      res.json(org);
   } catch (e) {
      res.status(400).json({ error: e.message });
   }
});

/**
 * A new password for their first admin.
 *
 * For the support call that starts "nobody can get in". Shown once, like the
 * one handed over at setup.
 */
router.post('/organisations/:id/reset-admin', async (req, res) => {
   try {
      const org = await Organisation().findById(req.params.id).lean();
      if (!org) return res.status(404).json({ error: 'No such customer' });

      const password = crypto.randomBytes(9).toString('base64url');
      const changed = await runInTenant({ connection: connectionFor(org.dbName), org }, async () => {
         const { User } = await import('../models/index.js');
         return User.updateOne(
            { email: org.ownerEmail },
            { $set: { passwordHash: await bcrypt.hash(password, 10), isActive: true } },
         );
      });
      if (!changed.matchedCount) return res.status(404).json({ error: `${org.ownerEmail} is not a user in that customer` });

      await audit(req, 'organisation.adminReset', org, org.ownerEmail);
      res.json({ email: org.ownerEmail, password });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

/**
 * Close an account.
 *
 * Their data is kept. This is the reversible half — somebody who stops paying
 * and comes back in a month should find their units where they left them.
 */
router.delete('/organisations/:id', async (req, res) => {
   try {
      const org = await Organisation().findByIdAndUpdate(
         req.params.id, { $set: { status: 'cancelled' } }, { new: true },
      ).lean();
      if (!org) return res.status(404).json({ error: 'No such customer' });
      forgetOrganisation(org._id);
      await audit(req, 'organisation.cancelled', org, org.slug);
      res.json({ ok: true, organisation: org, dataKept: true });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

/**
 * Delete a customer's data, for good.
 *
 * The slug has to be typed back. Not ceremony: this drops a company's entire
 * database — every contract, every conversation — and there is no undo behind
 * it. The confirmation is the difference between deleting a customer and
 * deleting the customer above them in a list.
 */
router.delete('/organisations/:id/data', async (req, res) => {
   try {
      const org = await Organisation().findById(req.params.id).lean();
      if (!org) return res.status(404).json({ error: 'No such customer' });

      if (String(req.query.confirm || '') !== org.slug) {
         return res.status(400).json({ error: `Type "${org.slug}" to confirm. This deletes their data permanently.` });
      }
      if (org.status !== 'cancelled') {
         return res.status(409).json({ error: 'Close the account first. Deleting the data of a customer who is still active is not something to do in one click.' });
      }

      const connection = connectionFor(org.dbName);
      await connection.dropDatabase();
      forgetDatabase(org.dbName);
      forgetOrganisation(org._id);

      await OrgUserIndex().deleteMany({ organisation: org._id });
      await Organisation().deleteOne({ _id: org._id });
      await audit(req, 'organisation.deleted', org._id, `${org.slug} → ${org.dbName}`);

      res.json({ ok: true, deleted: org.slug });
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

/** What has been done to customers, newest first. */
router.get('/audit', async (_req, res) => {
   try {
      res.json(await PlatformAudit().find().sort({ at: -1 }).limit(200).populate('organisation', 'name slug').lean());
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

export default router;
