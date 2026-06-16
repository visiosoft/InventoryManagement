import 'dotenv/config';
import { connectDb } from '../src/db.js';
import mongoose from 'mongoose';

await connectDb();

const col = mongoose.connection.collection('contracts');

try {
    await col.dropIndex('externalId_1');
    console.log('index dropped');
} catch (e) {
    console.log('drop skipped:', e.message);
}

// Unset externalId on docs with null or empty string — partial index skips missing fields only
const result = await col.updateMany(
    { $or: [{ externalId: null }, { externalId: '' }] },
    { $unset: { externalId: '' } }
);
console.log('unset externalId on docs:', result.modifiedCount);

await mongoose.disconnect();
process.exit(0);
