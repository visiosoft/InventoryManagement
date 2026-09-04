/**
 * Setting up a new customer.
 *
 * Creates their database, puts the first admin in it, and gives them a system
 * that is ready to use but has not been switched on: nothing sends, nothing is
 * assigned, nothing is answered automatically until somebody decides it should
 * be. A brand-new customer whose first act is to email their own contact list,
 * or to WhatsApp somebody with a half-configured assistant, has been handed a
 * loaded system rather than a working one.
 *
 * Idempotent from end to end. Every step is an upsert and every step is safe to
 * repeat, so a run that dies halfway can simply be run again — which matters,
 * because the alternative is a customer who exists in the directory and has no
 * database, and nobody wanting to find out which half is missing.
 */

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Organisation, OrgUserIndex, PlatformAudit } from './control.js';
import { connectionFor } from './connections.js';
import { runInTenant, currentConnection } from './context.js';
import { SCHEMAS } from '../models/index.js';
import { isProtectedDatabase } from './protected.js';

/** A URL-safe name from whatever somebody typed. */
export function slugify(name) {
   return String(name || '')
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
}

/* Reserved because they are, or will be, addresses of ours rather than a
   customer's. Cheaper to refuse now than to explain later why the customer
   calling themselves "api" cannot receive webhooks. */
const RESERVED = new Set([
   'api', 'www', 'app', 'admin', 'office', 'mail', 'demo', 'status', 'help',
   'support', 'billing', 'docs', 'static', 'assets', 'cdn', 'whatsapp',
]);

/**
 * The name of a customer's database.
 *
 * Named after them, because somebody looking at a list of databases in Atlas
 * at two in the morning needs to know whose is whose. `org_acme-storage` says
 * it; a random string says nothing, and the only way back from it is a lookup
 * in another database.
 *
 * The prefix stays. It groups our databases together among whatever else lives
 * on the cluster, and it is what the destructive paths check before they drop
 * anything — a guard that reads "this must start with org_" is worth more than
 * a tidier name.
 *
 * The name is fixed at creation and never follows a rename: MongoDB cannot
 * rename a database, so keeping the two in step would mean copying every
 * collection to a new one. The stored name is the truth; the company's name is
 * only where it came from.
 */
/**
 * A web address nobody else is using.
 *
 * The slug is the subdomain, so it has to be unique whatever somebody typed.
 * Suffixed rather than refused: two companies with similar names is our
 * problem to solve, not theirs to work around at the point of signing up.
 */
async function freeSlug(wanted) {
   if (!await Organisation().exists({ slug: wanted })) return wanted;
   for (let n = 2; n <= 99; n += 1) {
      const candidate = `${wanted.slice(0, 37)}-${n}`;
      if (!await Organisation().exists({ slug: candidate })) return candidate;
   }
   return `${wanted.slice(0, 32)}-${crypto.randomBytes(3).toString('hex')}`;
}

async function databaseNameFor(slug) {
   const base = `org_${slug}`.slice(0, 60);

   /* Never the database this deployment already serves.
    *
    * The prefix makes a collision impossible today, because nothing existing
    * carries it. This says so out loud anyway: the cost of being wrong here is
    * a new customer being seeded on top of a live company's data, and a
    * one-line check is cheaper than trusting that a naming convention is never
    * revisited. */
   if (isProtectedDatabase(base)) {
      throw new Error(`${base} is this deployment's own database and cannot be given to a customer`);
   }
   if (!await Organisation().exists({ dbName: base })) return base;

   /* Two customers who sanitise to the same name — "Acme Storage" and
      "ACME storage" — must not land in the same database. Suffixed rather
      than refused: it is our problem to solve, not theirs to work around. */
   for (let n = 2; n <= 99; n += 1) {
      const candidate = `${base.slice(0, 57)}-${n}`;
      if (!await Organisation().exists({ dbName: candidate })) return candidate;
   }
   return `${base.slice(0, 50)}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * The seed.
 *
 * Deliberately quiet. Distribution off, the assistant off, automation off,
 * backups off. Each is a thing that acts on its own, and none of them should
 * start acting before the person who owns the account has seen it.
 */
async function seed({ org, admin }) {
   const {
      User, UnitType, Site, AiBotConfig, LeadRoutingConfig, ReminderConfig,
   } = await import('../models/index.js');

   // The first admin. Everything else in the system is reachable from here.
   await User.updateOne(
      { email: admin.email },
      {
         $setOnInsert: {
            name: admin.name,
            email: admin.email,
            passwordHash: await bcrypt.hash(admin.password, 10),
            role: 'admin',
            // Empty means everything, for an admin — see hasPermission in the
            // client. A list here would be a list to keep up to date forever.
            permissions: [],
            isActive: true,
         },
      },
      { upsert: true },
   );

   // Somewhere to put units. One facility, named after them, renameable.
   await Site.updateOne(
      { name: org.name },
      { $setOnInsert: { name: org.name, isDefault: true } },
      { upsert: true },
   ).catch(() => { /* the Site schema differs between versions; not fatal */ });

   // The price list, so the booking screens have sizes to offer.
   const { seedUnitTypes } = await import('../routes/unitTypes.js');
   if (await UnitType.countDocuments() === 0) await seedUnitTypes();

   /* Off, all of it. A new customer's system should do nothing until they ask
      it to — most of these send messages to real people. */
   await AiBotConfig.updateOne({}, { $setOnInsert: { enabled: false, mode: 'draft' } }, { upsert: true });
   await LeadRoutingConfig.updateOne({}, { $setOnInsert: { enabled: false } }, { upsert: true });
   await ReminderConfig.updateOne({}, { $setOnInsert: {} }, { upsert: true }).catch(() => {});
   /* Two settings that were never given a model and live as raw collections.
      Same rule as the rest: created, and off. */
   const db = currentConnection().db;
   await db.collection('automationconfig')
      .updateOne({ key: 'default' }, { $setOnInsert: { key: 'default', autoSend: false } }, { upsert: true });
   await db.collection('backupconfig')
      .updateOne({ key: 'default' }, { $setOnInsert: { key: 'default', enabled: false } }, { upsert: true });
}

/**
 * Build every index the schemas declare.
 *
 * The pool runs with `autoIndex: false`, so nothing is built on the first
 * query — a customer's opening page load should not be sixty index builds.
 * They are built once, here, where somebody is already waiting for a setup to
 * finish.
 */
async function buildIndexes(connection) {
   for (const name of Object.keys(SCHEMAS)) {
      try {
         await connection.model(name).createIndexes();
      } catch (e) {
         // Reported, not fatal: a customer with a missing index is slow, and a
         // customer with no database at all is stuck.
         console.error(`[Provision] index on ${name}:`, e.message);
      }
   }
}

/**
 * Create a customer, or finish creating one that was interrupted.
 *
 * @returns { organisation, admin: { email, password }, created }
 */
export async function provisionOrganisation({ name, slug, ownerEmail, adminName, password, demo = false }) {
   const cleanName = String(name || '').trim();
   const cleanSlug = slugify(slug || cleanName);
   const email = String(ownerEmail || '').toLowerCase().trim();

   if (!cleanName) throw new Error('A customer needs a name');
   if (!cleanSlug) throw new Error('A customer needs a slug');
   if (RESERVED.has(cleanSlug)) throw new Error(`"${cleanSlug}" is reserved`);
   if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('A real email address is needed for the first admin');

   const taken = await OrgUserIndex().findOne({ emailLower: email }).lean();

   /* Resuming, or a different company that happens to sanitise the same way.
    *
    * "Acme Storage" and "ACME  storage" both reduce to acme-storage, and
    * matching on the slug alone treated the second as a re-run of the first —
    * so a second company was quietly given the first one's database. The owner
    * has to match too: same slug and same owner is the interrupted setup this
    * is meant to finish; same slug and a different owner is somebody else, and
    * they get a name of their own. */
   const bySlug = await Organisation().findOne({ slug: cleanSlug }).lean();
   const existing = bySlug && bySlug.ownerEmail === email ? bySlug : null;

   if (taken && (!existing || String(taken.organisation) !== String(existing._id))) {
      throw new Error(`${email} already belongs to another customer`);
   }

   const finalSlug = existing ? cleanSlug : await freeSlug(cleanSlug);

   const org = existing ?? (await Organisation().create({
      name: cleanName,
      slug: finalSlug,
      dbName: await databaseNameFor(finalSlug),
      ownerEmail: email,
      status: 'provisioning',
      demo,
      whatsappRouteKey: crypto.randomBytes(16).toString('hex'),
   })).toObject();

   const connection = connectionFor(org.dbName);
   const chosenPassword = password || crypto.randomBytes(9).toString('base64url');

   await runInTenant({ connection, org }, async () => {
      await buildIndexes(connection);
      await seed({
         org,
         admin: { name: adminName || cleanName, email, password: chosenPassword },
      });
   });

   await OrgUserIndex().updateOne(
      { emailLower: email },
      { $set: { emailLower: email, organisation: org._id, kind: 'staff' } },
      { upsert: true },
   );

   await Organisation().updateOne(
      { _id: org._id },
      { $set: { status: demo ? 'active' : 'trial', provisionedAt: new Date() } },
   );

   await PlatformAudit().create({
      action: existing ? 'organisation.reprovisioned' : 'organisation.created',
      organisation: org._id,
      detail: `${cleanName} (${org.slug}) → ${org.dbName}`,
   }).catch(() => {});

   return {
      organisation: await Organisation().findById(org._id).lean(),
      // Returned once, never stored: the only copy of the password is the one
      // handed to whoever ran this.
      admin: { email, password: password ? null : chosenPassword },
      created: !existing,
   };
}
