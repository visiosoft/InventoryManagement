/**
 * The directory of customers.
 *
 * One small database, separate from every customer's, holding only what has to
 * be known *before* a customer's database can be opened: who exists, which
 * database is theirs, and whether they are still allowed in.
 *
 * Deliberately thin. It is tempting to keep reporting figures here so the owner
 * console can show them without opening each database — and that is how a
 * control plane slowly becomes a copy of everybody's business data, in one
 * place, outside the isolation the rest of this design is built on. It holds
 * identity and routing. Nothing else.
 *
 * Reached on its own connection, never through the tenant proxies: those
 * resolve against whichever customer is being served, and this has to answer
 * before there is one.
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

let connection = null;

/**
 * One customer.
 *
 * `dbName` is random rather than derived from the slug: a customer who renames
 * themselves should not mean a database migration, and a slug is user-chosen
 * text that has no business being a database name.
 */
const organisationSchema = new Schema({
   name: { type: String, required: true },
   slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
   dbName: { type: String, required: true, unique: true },

   /* provisioning → a database being built; login refuses until it is done, so
      a half-created customer is never half-usable.
      trial/active   → in.
      suspended      → out, with a message rather than a wrong password.
      cancelled      → out, and the data kept until somebody deletes it. */
   status: {
      type: String,
      enum: ['provisioning', 'trial', 'active', 'suspended', 'cancelled'],
      default: 'provisioning',
   },
   plan: { type: String, default: 'trial' },
   // Set once a subscription checkout completes; used to open the Stripe
   // billing portal and to match subscription webhooks back to this org.
   stripeCustomerId: { type: String, default: null },
   stripeSubscriptionId: { type: String, default: null },
   ownerEmail: { type: String, required: true, lowercase: true, trim: true },
   timezone: { type: String, default: 'Asia/Dubai' },

   /* The customer's own WhatsApp webhook address. Their Meta app posts to a URL
      carrying this, which is how the signature can be checked against their app
      secret before the body is trusted — the organisation has to be known from
      the URL, because the body cannot be. */
   whatsappRouteKey: { type: String, unique: true, sparse: true },
   /* Their number, kept here as well as in their settings so two customers
      cannot claim the same one — a uniqueness question that has to be answered
      across databases. */
   whatsappPhoneNumberId: { type: String, unique: true, sparse: true },

   demo: { type: Boolean, default: false },
   // A kill switch for one noisy customer, without touching anybody else.
   jobsEnabled: { type: Boolean, default: true },
   provisionedAt: { type: Date, default: null },
}, { timestamps: true });

/**
 * Which customer an email belongs to.
 *
 * The full user record stays in the customer's own database; this says only
 * which database to open, because login has to know that before it can check a
 * password. Unique across the platform, so one address is one customer.
 */
const orgUserIndexSchema = new Schema({
   emailLower: { type: String, required: true, unique: true, lowercase: true, trim: true },
   organisation: { type: Schema.Types.ObjectId, ref: 'Organisation', required: true },
   kind: { type: String, enum: ['staff', 'customer', 'crew'], default: 'staff' },
}, { timestamps: true });

/** What was done to a customer, and by whom. Suspensions and impersonation are
 *  the two things somebody will one day need to account for. */
const platformAuditSchema = new Schema({
   at: { type: Date, default: Date.now },
   actor: { type: String, default: '' },
   action: { type: String, required: true },
   organisation: { type: Schema.Types.ObjectId, ref: 'Organisation' },
   detail: { type: String, default: '' },
});

const SCHEMAS = {
   Organisation: organisationSchema,
   OrgUserIndex: orgUserIndexSchema,
   PlatformAudit: platformAuditSchema,
};

/**
 * Open the control database on the cluster already connected.
 *
 * Its own database, so it can be backed up and restored without touching a
 * customer's, and so a customer's database can be dropped without taking the
 * directory with it.
 */
export function openControl(cluster) {
   connection = cluster.useDb(process.env.CONTROL_DB_NAME || 'purplebox_control', { useCache: true });
   for (const [name, schema] of Object.entries(SCHEMAS)) {
      if (!connection.models[name]) connection.model(name, schema);
   }
   return connection;
}

function control() {
   if (!connection) throw new Error('The control database has not been opened');
   return connection;
}

export const Organisation = () => control().model('Organisation');
export const OrgUserIndex = () => control().model('OrgUserIndex');
export const PlatformAudit = () => control().model('PlatformAudit');

/** Whether the directory is available at all — for the health check, and for
 *  single-tenant deployments that never open it. */
export const controlReady = () => Boolean(connection);

/**
 * The customer an email signs in to, or null.
 *
 * A miss is not an error: login answers the same way for an unknown address as
 * for a wrong password, so this cannot be used to find out who has an account.
 */
export async function organisationForEmail(email) {
   const entry = await OrgUserIndex().findOne({ emailLower: String(email || '').toLowerCase().trim() }).lean();
   if (!entry) return null;
   return Organisation().findById(entry.organisation).lean();
}

/** By id, for a request carrying a token. */
export async function organisationById(id) {
   if (!id) return null;
   return Organisation().findById(id).lean();
}

/** Everybody a scheduled job should sweep. */
export async function organisationsForJobs() {
   return Organisation().find({
      status: { $in: ['trial', 'active'] },
      jobsEnabled: { $ne: false },
   }).lean();
}
