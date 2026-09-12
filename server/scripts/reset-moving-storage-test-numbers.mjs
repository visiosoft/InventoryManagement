/**
 * Clear a number's MovingStorageFlowThread record so its next message opens
 * the Moving/Storage menu again from the start, and (unless --no-enable is
 * given) turns the movingStorageFlowEnabled setting on so there's something
 * to test in the first place.
 *
 * Numbers are hardcoded below rather than read from argv — this is a one-off
 * for the two numbers asked for, not a general tool; edit NUMBERS to reuse it
 * for someone else's test number.
 *
 *   node scripts/reset-moving-storage-test-numbers.mjs             # dry run, writes nothing
 *   node scripts/reset-moving-storage-test-numbers.mjs --write
 *   node scripts/reset-moving-storage-test-numbers.mjs --write --no-enable  # clear only, leave the setting as it is
 */

import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);
import 'dotenv/config';
import mongoose from 'mongoose';

const NUMBERS = ['+971569420950', '+923005744441'];
const WRITE = process.argv.includes('--write');
const ENABLE_SETTING = !process.argv.includes('--no-enable');

const normalize = (n) => String(n || '').replace(/\D/g, '');

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
const { MovingStorageFlowThread, AiBotConfig } = await import('../src/models/index.js');

console.log(WRITE ? 'Writing.\n' : 'Dry run — nothing will be written.\n');

for (const raw of NUMBERS) {
    const phoneNormalized = normalize(raw);
    const existing = await MovingStorageFlowThread.findOne({ phoneNormalized }).lean();
    if (!existing) {
        console.log(`${raw} (${phoneNormalized}) — no flow record on file, nothing to clear.`);
        continue;
    }
    console.log(`${raw} (${phoneNormalized}) — found: step=${existing.step}, service=${existing.service || '(none)'}, size=${existing.size || '(none)'}`);
    if (WRITE) {
        await MovingStorageFlowThread.deleteOne({ phoneNormalized });
        console.log(`  deleted.`);
    }
}

const config = await AiBotConfig.findOne();
console.log(`\nmovingStorageFlowEnabled is currently: ${Boolean(config?.movingStorageFlowEnabled)}`);
if (ENABLE_SETTING && !config?.movingStorageFlowEnabled) {
    console.log('Would turn it on.' + (WRITE ? '' : ' (dry run — not written)'));
    if (WRITE) {
        const c = config || await AiBotConfig.create({});
        c.movingStorageFlowEnabled = true;
        await c.save();
        console.log('  done — movingStorageFlowEnabled is now true.');
    }
}

await mongoose.disconnect();
