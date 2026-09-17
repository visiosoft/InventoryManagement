/**
 * Clear a number's MovingStorageFlowThread record so its next message opens
 * the active WhatsApp Flow Template's menu again from the start, and
 * (unless --no-enable is given) makes sure some template is actually
 * active so there's something to test in the first place.
 *
 * Numbers are hardcoded below rather than read from argv — this is a one-off
 * for the two numbers asked for, not a general tool; edit NUMBERS to reuse it
 * for someone else's test number.
 *
 *   node scripts/reset-moving-storage-test-numbers.mjs             # dry run, writes nothing
 *   node scripts/reset-moving-storage-test-numbers.mjs --write
 *   node scripts/reset-moving-storage-test-numbers.mjs --write --no-enable  # clear only, leave templates as they are
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
const { MovingStorageFlowThread, WhatsAppFlowTemplate } = await import('../src/models/index.js');
const { ensureDefaultFlowTemplate } = await import('../src/services/whatsappFlowTemplates.js');

console.log(WRITE ? 'Writing.\n' : 'Dry run — nothing will be written.\n');

for (const raw of NUMBERS) {
    const phoneNormalized = normalize(raw);
    const existing = await MovingStorageFlowThread.findOne({ phoneNormalized }).lean();
    if (!existing) {
        console.log(`${raw} (${phoneNormalized}) — no flow record on file, nothing to clear.`);
        continue;
    }
    console.log(`${raw} (${phoneNormalized}) — found: stepIndex=${existing.stepIndex}, size=${existing.size || '(none)'}, done=${Boolean(existing.done)}`);
    if (WRITE) {
        await MovingStorageFlowThread.deleteOne({ phoneNormalized });
        console.log(`  deleted.`);
    }
}

if (WRITE) await ensureDefaultFlowTemplate();
const active = await WhatsAppFlowTemplate.findOne({ active: true }).select('name').lean();
console.log(`\nActive flow template: ${active ? active.name : '(none — feature is off)'}`);
if (ENABLE_SETTING && !active) {
    console.log('Would activate the first available template.' + (WRITE ? '' : ' (dry run — not written)'));
    if (WRITE) {
        const first = await WhatsAppFlowTemplate.findOne().sort({ order: 1, createdAt: 1 });
        if (first) {
            first.active = true;
            await first.save();
            console.log(`  done — "${first.name}" is now active.`);
        } else {
            console.log('  no template exists to activate.');
        }
    }
}

await mongoose.disconnect();
