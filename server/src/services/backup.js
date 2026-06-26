import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { Readable } from 'stream';
import mongoose from 'mongoose';

const gzip = promisify(zlib.gzip);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_BACKUP_DIR = path.resolve(__dirname, '../../backups');

// ── Helpers ──────────────────────────────────────────────────────────────────

function padded(n) { return String(n).padStart(2, '0'); }

function buildFilename() {
  const d = new Date();
  const date = `${d.getFullYear()}-${padded(d.getMonth() + 1)}-${padded(d.getDate())}`;
  const time = `${padded(d.getHours())}${padded(d.getMinutes())}`;
  return `purplebox-backup-${date}-${time}.json.gz`;
}

function driveClient() {
  const hasServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_FILE &&
    fs.existsSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE);

  let auth;
  if (hasServiceAccount) {
    auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  } else {
    const clientId     = process.env.GOOGLE_DRIVE_CLIENT_ID     || process.env.GOOGLE_CONTACTS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_CONTACTS_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) return null;
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    auth = oauth2;
  }
  return google.drive({ version: 'v3', auth });
}

// Returns/creates the "PurpleBox Backups" folder inside the root Drive folder.
let backupFolderCache = null;
async function getBackupFolder(drive) {
  if (backupFolderCache) return backupFolderCache;

  // Allow an explicit override env var for the backup folder
  if (process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID) {
    backupFolderCache = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
    return backupFolderCache;
  }

  const parentId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!parentId) return null;

  const folderName = 'PurpleBox Backups';
  const q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const list = await drive.files.list({ q, fields: 'files(id)', spaces: 'drive' });
  let folderId = list.data.files?.[0]?.id;

  if (!folderId) {
    const created = await drive.files.create({
      requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
    });
    folderId = created.data.id;
  }

  backupFolderCache = folderId;
  return folderId;
}

// ── Core export ──────────────────────────────────────────────────────────────

async function exportAllCollections() {
  const db = mongoose.connection.db;
  const collectionInfos = await db.listCollections().toArray();
  const collections = {};

  for (const info of collectionInfos) {
    const docs = await db.collection(info.name).find({}).toArray();
    collections[info.name] = docs;
  }

  return collections;
}

// ── Main backup function ─────────────────────────────────────────────────────

export async function runBackup(triggeredBy = 'scheduler') {
  const startedAt = new Date();
  const filename  = buildFilename();

  console.log(`[Backup] Starting backup: ${filename} (triggered by: ${triggeredBy})`);

  // Dump all collections
  const collections = await exportAllCollections();
  const collectionNames = Object.keys(collections);
  const totalDocs = collectionNames.reduce((s, k) => s + collections[k].length, 0);

  const payload = {
    name:        'PurpleBox',
    backedUpAt:  startedAt.toISOString(),
    triggeredBy,
    version:     '1.0',
    collections,
  };

  const jsonBuffer = Buffer.from(JSON.stringify(payload));
  const compressed = await gzip(jsonBuffer);
  const sizeKb = Math.round(compressed.length / 1024);

  let storage = 'local';
  let driveFileId = '';
  let driveUrl = '';

  // Try Google Drive first
  const drive = driveClient();
  const driveReady = drive && (process.env.GOOGLE_DRIVE_FOLDER_ID || process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID);

  if (driveReady) {
    try {
      const folderId = await getBackupFolder(drive);
      if (folderId) {
        const { data } = await drive.files.create({
          requestBody: {
            name:    filename,
            parents: [folderId],
          },
          media: {
            mimeType: 'application/gzip',
            body: Readable.from(compressed),
          },
          fields: 'id, webViewLink',
          supportsAllDrives: true,
        });
        driveFileId = data.id;
        driveUrl    = data.webViewLink;
        storage     = 'drive';
        console.log(`[Backup] Uploaded to Drive: ${driveUrl}`);
      }
    } catch (err) {
      console.error('[Backup] Drive upload failed, falling back to local:', err.message);
    }
  }

  // Local fallback (also keep a local copy always for quick restore)
  fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
  const localPath = path.join(LOCAL_BACKUP_DIR, filename);
  fs.writeFileSync(localPath, compressed);

  const durationMs = Date.now() - startedAt.getTime();
  const result = {
    filename,
    backedUpAt: startedAt.toISOString(),
    triggeredBy,
    storage,
    driveFileId,
    driveUrl,
    localPath: localPath,
    sizeKb,
    collections: collectionNames.length,
    documents: totalDocs,
    durationMs,
  };

  console.log(`[Backup] Done in ${durationMs}ms — ${collectionNames.length} collections, ${totalDocs} docs, ${sizeKb} KB`);
  return result;
}

// ── List local backups ───────────────────────────────────────────────────────

export function listLocalBackups() {
  if (!fs.existsSync(LOCAL_BACKUP_DIR)) return [];
  return fs.readdirSync(LOCAL_BACKUP_DIR)
    .filter(f => f.startsWith('purplebox-backup-') && f.endsWith('.json.gz'))
    .sort()
    .reverse()
    .map(filename => {
      const stat = fs.statSync(path.join(LOCAL_BACKUP_DIR, filename));
      return {
        filename,
        sizeKb: Math.round(stat.size / 1024),
        createdAt: stat.mtime.toISOString(),
      };
    });
}

// ── List Drive backups ───────────────────────────────────────────────────────

export async function listDriveBackups() {
  const drive = driveClient();
  if (!drive) return [];
  try {
    const folderId = await getBackupFolder(drive);
    if (!folderId) return [];
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, size, createdTime, webViewLink)',
      orderBy: 'createdTime desc',
      pageSize: 50,
      spaces: 'drive',
    });
    return (res.data.files || []).map(f => ({
      filename:    f.name,
      sizeKb:      Math.round(Number(f.size || 0) / 1024),
      createdAt:   f.createdTime,
      driveFileId: f.id,
      driveUrl:    f.webViewLink,
    }));
  } catch (err) {
    console.error('[Backup] listDriveBackups error:', err.message);
    return [];
  }
}
