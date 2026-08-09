// Creates any schema-declared indexes that don't exist yet in Atlas.
// Run after adding an index to a schema: node scripts/sync-indexes.mjs
// (startup no longer auto-creates indexes — see AUTO_INDEX in src/index.js)
import mongoose from 'mongoose';
import { connectDb } from '../src/db.js';
import '../src/models/index.js';

await connectDb();
for (const name of mongoose.modelNames()) {
  const t = Date.now();
  await mongoose.model(name).syncIndexes();
  console.log(`${name.padEnd(24)} ${Date.now() - t} ms`);
}
console.log('All indexes in sync.');
process.exit(0);
