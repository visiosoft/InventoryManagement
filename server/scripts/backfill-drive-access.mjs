/**
 * Make existing Drive files open directly instead of showing "Request access".
 *
 * New uploads already get "anyone with the link can view" permission, but files
 * uploaded before that was added do not, and still carry the old webViewLink
 * URL. This grants the same permission to those files and stores the direct
 * URL, so old and new documents behave identically.
 *
 *   node scripts/backfill-drive-access.mjs --dry   # report only, change nothing
 *   node scripts/backfill-drive-access.mjs         # apply
 *
 * Safe to re-run: files that already allow link access are skipped.
 */
import { connectDb } from '../src/db.js';
import { Document } from '../src/models/index.js';
import { driveClient, driveConfigured } from '../src/services/drive.js';

const DRY = process.argv.includes('--dry');

// connectDb() loads server/.env, so the Drive config check must come after it
await connectDb();

if (!driveConfigured()) {
  console.error('Google Drive is not configured — set the GOOGLE_DRIVE_* env vars first.');
  process.exit(1);
}

const drive = driveClient();

const docs = await Document.find({
  storage: 'drive',
  driveFileId: { $nin: [null, ''] },
}).select('name url driveFileId');

console.log(`${docs.length} Drive documents to check${DRY ? ' (dry run)' : ''}\n`);

let shared = 0, alreadyOpen = 0, urlsFixed = 0, missing = 0, failed = 0;

for (const doc of docs) {
  const fileId = doc.driveFileId;
  try {
    // Does this file already allow anyone with the link to read it?
    const { data } = await drive.permissions.list({
      fileId,
      fields: 'permissions(id,type,role)',
      supportsAllDrives: true,
    });
    const isOpen = (data.permissions || []).some((p) => p.type === 'anyone' && ['reader', 'writer', 'owner'].includes(p.role));

    if (!isOpen) {
      if (!DRY) {
        await drive.permissions.create({
          fileId,
          requestBody: { role: 'reader', type: 'anyone' },
          supportsAllDrives: true,
        });
      }
      shared++;
    } else {
      alreadyOpen++;
    }

    // Match the URL format new uploads use
    const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    if (doc.url !== directUrl) {
      if (!DRY) {
        doc.url = directUrl;
        await doc.save();
      }
      urlsFixed++;
    }
  } catch (e) {
    // A file deleted from Drive but still referenced in the database
    if (e?.code === 404 || e?.response?.status === 404) {
      missing++;
      console.warn(`  missing in Drive: ${doc.name} (${fileId})`);
    } else {
      failed++;
      console.error(`  failed: ${doc.name} — ${e.message}`);
    }
  }
}

console.log(`\n${DRY ? 'would share' : 'shared'}: ${shared}`);
console.log(`already open: ${alreadyOpen}`);
console.log(`${DRY ? 'would fix' : 'fixed'} URLs: ${urlsFixed}`);
if (missing) console.log(`missing in Drive: ${missing}`);
if (failed) console.log(`failed: ${failed}`);
process.exit(0);
