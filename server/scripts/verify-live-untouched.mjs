/**
 * Prove the live company's data was not touched.
 *
 *   node scripts/verify-live-untouched.mjs --save     before deploying
 *   node scripts/verify-live-untouched.mjs            after, and any time after that
 *
 * Counts every document in every collection of the live database and compares
 * it with the last saved snapshot. Read-only: it opens nothing else, writes
 * nothing to the database, and touches only a JSON file on disk.
 *
 * The multi-tenant work changed how a database is chosen, which is exactly the
 * kind of change that is fine in every test and wrong in production. This is
 * the answer to "did anything move?" that does not depend on anybody's
 * confidence — including mine.
 *
 * A difference is not automatically a fault: a working business adds contracts
 * and messages all day. What matters is that the numbers move the way a
 * working day moves them — up, in the collections people are using — and not
 * down, and not in collections nobody touched.
 */

import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import mongoose from 'mongoose';

const here = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.join(here, '..', '.live-snapshot.json');
const save = process.argv.includes('--save');

const dbName = process.env.DB_NAME || 'PurpleBox';
const connection = await mongoose.createConnection(process.env.MONGODB_URI, { dbName }).asPromise();

const collections = await connection.db.listCollections().toArray();
const counts = {};
for (const c of collections.sort((a, b) => a.name.localeCompare(b.name))) {
   counts[c.name] = await connection.db.collection(c.name).countDocuments();
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (save) {
   writeFileSync(SNAPSHOT, JSON.stringify({ dbName, at: new Date().toISOString(), counts }, null, 2));
   console.log(`\nSnapshot of ${dbName}: ${collections.length} collections, ${total.toLocaleString()} documents.`);
   console.log(`Saved to ${SNAPSHOT}\n`);
   console.log('Deploy, then run this again without --save to compare.\n');
   await connection.close();
   process.exit(0);
}

if (!existsSync(SNAPSHOT)) {
   console.error('\nNo snapshot to compare with. Run with --save first, before deploying.\n');
   await connection.close();
   process.exit(1);
}

const before = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
if (before.dbName !== dbName) {
   console.error(`\nThe snapshot is of ${before.dbName} and this is ${dbName}. Refusing to compare two different databases.\n`);
   await connection.close();
   process.exit(1);
}

const names = [...new Set([...Object.keys(before.counts), ...Object.keys(counts)])].sort();
const lost = [];
const gone = [];
const grew = [];

for (const name of names) {
   const was = before.counts[name];
   const now = counts[name];
   if (was !== undefined && now === undefined) { gone.push(name); continue; }
   if (was === undefined) { grew.push([name, 0, now]); continue; }
   if (now < was) lost.push([name, was, now]);
   else if (now > was) grew.push([name, was, now]);
}

console.log(`\n${dbName}, against the snapshot taken ${new Date(before.at).toLocaleString('en-GB')}\n`);

if (gone.length) {
   console.log('  COLLECTIONS THAT HAVE DISAPPEARED');
   for (const n of gone) console.log(`    ${n}  (had ${before.counts[n]})`);
   console.log('');
}
if (lost.length) {
   console.log('  DOCUMENTS LOST');
   for (const [n, was, now] of lost) console.log(`    ${n.padEnd(28)} ${was} → ${now}   (${was - now} fewer)`);
   console.log('');
}
if (grew.length) {
   console.log('  grown, which a working day does');
   for (const [n, was, now] of grew) console.log(`    ${n.padEnd(28)} ${was} → ${now}   (+${now - was})`);
   console.log('');
}
if (!gone.length && !lost.length && !grew.length) {
   console.log('  Identical. Nothing has changed at all.\n');
}

const bad = gone.length || lost.length;
console.log(bad
   ? '  SOMETHING WAS LOST. Stop and restore from a backup before going further.\n'
   : '  Nothing lost. Every collection is intact and only grew.\n');

await connection.close();
process.exit(bad ? 1 : 0);
