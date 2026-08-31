// Attaches every unit to a facility, so turning the facility switcher on does
// not make units disappear.
//
// Three facts made this necessary:
//   * No facility was marked as the default, and `siteScope` treats a unit
//     with no facility as belonging to the default one. With no default,
//     nothing claimed them.
//   * 151 units had no facility at all -- `POST /units` silently dropped the
//     field, so everything created since facilities shipped landed nowhere.
//     Five of those units are on live contracts.
//   * The one saved floor plan is stored under the key 'default', which is
//     only asked for while the selected facility IS the default. Marking a
//     default without re-keying it makes the Floor Map come back empty.
//
// Idempotent: run it twice and the second run changes nothing. Every id it
// touches is printed, so the backfill can be undone with a single updateMany.
//
//   node scripts/backfill-unit-sites.mjs --dry     # report, change nothing
//   node scripts/backfill-unit-sites.mjs           # apply
import 'dotenv/config';
import dns from 'node:dns'; dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';
import { Site, Unit, Contract } from '../src/models/index.js';

const dry = process.argv.includes('--dry');
await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || 'PurpleBox' });
const db = mongoose.connection.db;

const line = (s = '') => console.log(s);
line(dry ? '— DRY RUN, nothing will be written —\n' : '— APPLYING —\n');

/* 1. The default facility. The oldest one, which is the facility the company
      started with, unless somebody has already marked one. */
const sites = await Site.find().sort({ createdAt: 1 });
if (sites.length === 0) throw new Error('No facilities exist — create one first');
const target = sites.find((s) => s.isDefault) ?? sites[0];
line(`facilities: ${sites.map((s) => `${s.name}${s.isDefault ? ' (default)' : ''}`).join(', ')}`);
line(`default will be: ${target.name}`);

/* 2. Units with no facility. `{ site: null }` also matches documents where the
      field was never written, which is what we have. */
const orphans = await Unit.find({ site: null }).select('unitNumber floor status').lean();
line(`\nunits with no facility: ${orphans.length}`);
if (orphans.length) {
  const byFloor = {};
  for (const u of orphans) byFloor[u.floor || '-'] = (byFloor[u.floor || '-'] || 0) + 1;
  line(`  by floor: ${Object.entries(byFloor).map(([k, v]) => `${k}:${v}`).join('  ')}`);

  const live = await Contract.countDocuments({
    status: { $in: ['active', 'pending_signature', 'draft'] },
    $or: [{ unit: { $in: orphans.map((u) => u._id) } }, { units: { $in: orphans.map((u) => u._id) } }],
  });
  line(`  on live contracts: ${live}`);
  // Printed so the change can be reversed exactly.
  line(`  ids: ${orphans.map((u) => u._id).join(',')}`);
}

/* 3. The floor plan key follows the same default rule, so it moves with it. */
const plans = await db.collection('floorplans').find({}).project({ key: 1 }).toArray();
line(`\nfloor plans: ${plans.map((p) => JSON.stringify(p.key)).join(', ') || 'none'}`);
const newKey = `site:${target._id}`;
const needsRekey = plans.some((p) => p.key === 'default');
line(needsRekey ? `  'default' will become ${JSON.stringify(newKey)}` : '  nothing to re-key');

if (dry) {
  line('\nNothing was written. Re-run without --dry to apply.');
  await mongoose.disconnect();
  process.exit(0);
}

// ── apply ───────────────────────────────────────────────────────────────────
const cleared = await Site.updateMany({ _id: { $ne: target._id } }, { $set: { isDefault: false } });
target.isDefault = true;
await target.save();
line(`\ndefault set on ${target.name} (cleared on ${cleared.modifiedCount} other)`);

const moved = await Unit.updateMany({ site: null }, { $set: { site: target._id } });
line(`units attached to ${target.name}: ${moved.modifiedCount}`);

if (needsRekey) {
  const r = await db.collection('floorplans').updateOne({ key: 'default' }, { $set: { key: newKey } });
  line(`floor plan re-keyed: ${r.modifiedCount}`);
}

// ── verify ──────────────────────────────────────────────────────────────────
const { siteScope } = await import('../src/utils/siteScope.js');
line('\n— verifying —');
const stillNull = await Unit.countDocuments({ site: null });
const total = await Unit.countDocuments();
const defaults = await Site.countDocuments({ isDefault: true });
const scoped = await siteScope(String(target._id));
line(`  units with no facility : ${stillNull}  ${stillNull === 0 ? 'ok' : 'STILL ORPHANED'}`);
line(`  facilities marked default: ${defaults}  ${defaults === 1 ? 'ok' : 'SHOULD BE EXACTLY 1'}`);
line(`  ${target.name} by filter : ${scoped.unitIds.length} of ${total} units`);
const plan = await db.collection('floorplans').findOne({ key: newKey });
line(`  floor plan reachable   : ${Boolean(plan)}  ${plan ? 'ok' : 'MISSING'}`);

await mongoose.disconnect();
