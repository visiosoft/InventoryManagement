// Preview what the automation engine would send right now, without sending.
//   node scripts/automation-dry-run.mjs
import 'dotenv/config';
import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';
import { runAutomationRules } from '../src/services/automationEngine.js';

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || 'PurpleBox' });
const result = await runAutomationRules({ dryRun: true });
console.log(`\nWould send ${result.planned.length} message(s); skipped ${result.skipped}\n`);
for (const p of result.planned) {
  console.log(`— [${p.channel}] ${p.rule} → ${p.customer} (${p.contract})`);
  console.log(`   ${p.message.slice(0, 140).replace(/\n/g, ' ')}\n`);
}
await mongoose.disconnect();
