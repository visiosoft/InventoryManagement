/**
 * Set up a new customer.
 *
 *   node scripts/new-customer.mjs --name "Acme Storage" --email owner@acme.ae
 *   node scripts/new-customer.mjs --name "Acme Storage" --email owner@acme.ae --slug acme
 *   node scripts/new-customer.mjs --name "Demo" --email demo@purplebox.ae --demo
 *   node scripts/new-customer.mjs --list
 *
 * Creates their database, builds its indexes, seeds a price list and a first
 * admin, and prints the password once. Everything that sends — the assistant,
 * lead distribution, automation, backups — is created switched off, so a new
 * customer's system does nothing until they ask it to.
 *
 * Safe to run twice on the same slug: every step is an upsert, so a run that
 * failed halfway is finished rather than duplicated.
 */

import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import 'dotenv/config';
process.env.TZ = process.env.TZ || 'Asia/Dubai';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
   const a = process.argv[i];
   if (!a.startsWith('--')) continue;
   const [k, v] = a.slice(2).split('=');
   args.set(k, v ?? (process.argv[i + 1]?.startsWith('--') ? 'true' : process.argv[++i] ?? 'true'));
}

const { connectDb } = await import('../src/db.js');
const { useBaseConnection } = await import('../src/tenancy/connections.js');
const { openControl, Organisation } = await import('../src/tenancy/control.js');

const cluster = await connectDb();
useBaseConnection(cluster);
openControl(cluster);

if (args.has('list')) {
   const orgs = await Organisation().find().sort({ createdAt: 1 }).lean();
   if (!orgs.length) console.log('No customers yet.');
   for (const o of orgs) {
      console.log(
         `  ${String(o.slug).padEnd(18)} ${String(o.status).padEnd(13)} ${String(o.name).slice(0, 28).padEnd(30)} ${o.dbName}`,
      );
   }
   await cluster.close();
   process.exit(0);
}

const name = args.get('name');
const email = args.get('email');
if (!name || !email) {
   console.error('Usage: node scripts/new-customer.mjs --name "Acme Storage" --email owner@acme.ae [--slug acme] [--demo]');
   process.exit(1);
}

const { provisionOrganisation } = await import('../src/tenancy/provision.js');

try {
   const out = await provisionOrganisation({
      name,
      slug: args.get('slug'),
      ownerEmail: email,
      adminName: args.get('admin') || name,
      password: args.get('password') || undefined,
      demo: args.has('demo'),
   });

   const org = out.organisation;
   console.log(out.created ? '\nCustomer created.\n' : '\nCustomer already existed — setup completed.\n');
   console.log(`  Name       ${org.name}`);
   console.log(`  Address    https://${org.slug}.purplebox.ae`);
   console.log(`  Status     ${org.status}`);
   console.log(`  Database   ${org.dbName}`);
   console.log(`  Sign in    ${out.admin.email}`);
   if (out.admin.password) {
      console.log(`  Password   ${out.admin.password}`);
      console.log('\n  This password is shown once and is not stored anywhere. Hand it over');
      console.log('  and have them change it.');
   }
   console.log(`\n  WhatsApp webhook for their Meta app:`);
   console.log(`    https://api.purplebox.ae/api/wa/${org.whatsappRouteKey}/webhook`);
   console.log('\n  Their assistant, lead distribution, automation and backups are all off.');
   console.log('  They turn on what they want from Settings.\n');
} catch (e) {
   console.error(`\nCould not set that customer up: ${e.message}\n`);
   await cluster.close();
   process.exit(1);
}

await cluster.close();
process.exit(0);
