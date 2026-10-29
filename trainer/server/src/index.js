import 'dotenv/config';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import * as models from './models.js';
import { purgeExpired } from './service.js';

/**
 * AI Trainer API. Its own process and its own database (TRAINER_DB_NAME on
 * TRAINER_MONGODB_URI), so it shares nothing with any customer's system but
 * the machine it may run on.
 */

const PORT = Number(process.env.PORT || 5020);
const uri = process.env.TRAINER_MONGODB_URI || process.env.MONGODB_URI;
if (!uri) { console.error('Set TRAINER_MONGODB_URI'); process.exit(1); }
if (!process.env.TRAINER_SECRET || process.env.TRAINER_SECRET.length < 16) { console.error('Set TRAINER_SECRET (16+ random characters)'); process.exit(1); }

await mongoose.connect(uri, { dbName: process.env.TRAINER_DB_NAME || 'ai_trainer', serverSelectionTimeoutMS: 30_000 });
await Promise.all(Object.values(models).filter((m) => m?.syncIndexes).map((m) => m.syncIndexes().catch(() => null)));
createApp().listen(PORT, '127.0.0.1', () => console.log(`[trainer] listening on 127.0.0.1:${PORT}`));

// Retention: each organisation's imported conversations past its retention period, daily.
setInterval(() => purgeExpired(models).then((n) => { if (n) console.log(`[trainer] ${n} expired question(s) deleted`); }).catch((e) => console.error('[trainer] purge', e.message)), 24 * 3600_000);
