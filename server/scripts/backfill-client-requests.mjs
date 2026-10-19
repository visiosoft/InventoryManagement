/**
 * Open Client Requests for everything customers asked for in the app before
 * the staff inbox existed: pending check-out changes and deposit refunds, open
 * valet jobs, paid bookings flagged for staff, unchecked IDs from the last 30
 * days and app sign-ups from the last 14.
 *
 * Idempotent — the same function as POST /api/client-requests/backfill, and
 * every row is keyed on its source, so a second run opens nothing.
 *
 *   node scripts/backfill-client-requests.mjs
 */

import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import 'dotenv/config';
process.env.TZ = 'Asia/Dubai';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
const { backfillClientRequests } = await import('../src/services/clientRequests.js');

const out = await backfillClientRequests();
console.log('opened:', out.created);
console.log('total :', out.total);
await mongoose.disconnect();
