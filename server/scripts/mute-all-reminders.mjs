// Reminders become opt-in: mute every contract that isn't already muted.
// Enable individual clients from the contract's Reminders tab.
//   node scripts/mute-all-reminders.mjs [--dry]
import 'dotenv/config';
import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';
import { Contract } from '../src/models/index.js';

const dry = process.argv.includes('--dry');
await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || 'PurpleBox' });

const filter = { remindersMuted: { $ne: true } };
const count = await Contract.countDocuments(filter);
if (dry) {
  console.log(`Would mute reminders on ${count} contract(s).`);
} else {
  const r = await Contract.updateMany(filter, { $set: { remindersMuted: true } });
  console.log(`Muted reminders on ${r.modifiedCount} contract(s).`);
}
await mongoose.disconnect();
