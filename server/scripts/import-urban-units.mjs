// Adds the Urban Storage (DIP-1) units from the Zoho "Available Units Urban
// Box" report.
//
// The report carries a unit number, a size and a status — no price. Units are
// therefore created without one, which is a real state in this system (`price`
// defaults to null) and is what the Unit Pricing page's bulk "set price for
// every unit of this floor and size" exists to fill in. Inventing prices would
// be worse than leaving them blank: a wrong rate reaches a customer.
//
// The W2 / W3 prefix is kept as the `floor` value. It is a free-text field
// already holding F1/F2/F3 for Al Quoz, so the two facilities stay legible
// side by side and the floor filter keeps working.
//
// Idempotent: a unit that already exists is skipped, never duplicated.
//
//   node scripts/import-urban-units.mjs --dry
//   node scripts/import-urban-units.mjs
import 'dotenv/config';
import dns from 'node:dns'; dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';
import fs from 'node:fs';
import { Unit, Site } from '../src/models/index.js';

const dry = process.argv.includes('--dry');
const file = process.argv.find((a) => a.endsWith('.json')) ?? 'urban-units.json';
await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || 'PurpleBox' });

const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
const site = await Site.findOne({ name: /Urban Storage/i });
if (!site) throw new Error('The Urban Storage facility does not exist');

console.log(dry ? '— DRY RUN —\n' : '— IMPORTING —\n');
console.log(`facility: ${site.name} (${site.code || 'no code'})`);
console.log(`report  : ${rows.length} units\n`);

const existing = new Set(
  (await Unit.find({ unitNumber: { $in: rows.map((r) => r.unitNumber) } }).select('unitNumber').lean())
    .map((u) => u.unitNumber),
);

const toCreate = rows.filter((r) => !existing.has(r.unitNumber)).map((r) => ({
  unitNumber: r.unitNumber,
  site: site._id,
  floor: r.unitNumber.split('/')[0],   // W2 / W3
  sizeSqf: r.sizeSqf,
  status: 'available',                 // every row in the report reads Available
  price: null,                         // not in the report — set in bulk afterwards
}));

console.log(`already present, skipping: ${existing.size}`);
console.log(`to create                : ${toCreate.length}`);
const byFloor = {};
for (const u of toCreate) byFloor[u.floor] = (byFloor[u.floor] || 0) + 1;
console.log(`  by floor: ${Object.entries(byFloor).map(([k, v]) => `${k}:${v}`).join('  ')}`);
const bySize = {};
for (const u of toCreate) bySize[u.sizeSqf] = (bySize[u.sizeSqf] || 0) + 1;
console.log(`  by size : ${Object.entries(bySize).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}sqft:${v}`).join('  ')}`);

if (dry) {
  console.log('\nNothing written. Re-run without --dry to import.');
  await mongoose.disconnect();
  process.exit(0);
}

const made = toCreate.length ? await Unit.insertMany(toCreate) : [];
console.log(`\ncreated: ${made.length}`);

// ── verify ──────────────────────────────────────────────────────────────────
const { siteScope } = await import('../src/utils/siteScope.js');
const scope = await siteScope(String(site._id));
console.log('\n— verifying —');
console.log(`  units in ${site.name}: ${await Unit.countDocuments({ site: site._id })}`);
console.log(`  reachable when that facility is selected: ${scope.unitIds.length}`);
console.log(`  units with no facility anywhere: ${await Unit.countDocuments({ site: null })}`);
console.log(`  units in the company total: ${await Unit.countDocuments()}`);
const missing = rows.filter(async () => false);
const stored = new Set((await Unit.find({ site: site._id }).select('unitNumber').lean()).map((u) => u.unitNumber));
const absent = rows.map((r) => r.unitNumber).filter((n) => !stored.has(n));
console.log(`  every reported unit present: ${absent.length === 0 ? 'yes' : 'NO — missing ' + absent.join(', ')}`);
console.log(`  awaiting a price: ${await Unit.countDocuments({ site: site._id, price: null })}`);
void missing;

await mongoose.disconnect();
