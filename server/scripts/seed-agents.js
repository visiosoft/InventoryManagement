// Creates or updates the starter team (Aisha, Omar, Layla, Sam) in the
// database the server is configured for. Safe to run again.
//
//   node --env-file=.env scripts/seed-agents.js            # keep any edited instructions
//   node --env-file=.env scripts/seed-agents.js --force    # reset instructions to the starter text
import mongoose from 'mongoose';
import { connectDb } from '../src/db.js';
import { seedStarterTeam } from '../src/agents/seed.js';

const force = process.argv.includes('--force');
await connectDb();
const out = await seedStarterTeam({ force });
for (const row of out) console.log(`${row.result.padEnd(8)} ${row.name}${row.escalateTo ? '' : '   (no hand-over person found — set one on the agent)'}`);
await mongoose.disconnect();
