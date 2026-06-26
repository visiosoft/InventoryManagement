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
const TIMEOUT_MS = 5 * 60 * 1000; // 5-minute hard timeout

// ── In-memory progress state (exported so routes can read it) ─────────────────
export const backupState = {
  running:     false,
  startedAt:   null,
  triggeredBy: '',
  logs:        [],   // [{ at: ISO, msg: string, level: 'info'|'ok'|'error' }]
  lastResult:  null, // { filename, storage, driveUrl, sizeKb, collections, documents, durationMs, backedUpAt }
  lastError:   '',
};

function log(msg, level = 'info') {
  const entry = { at: new Date().toISOString(), msg, level };
  backupState.logs.push(entry);
  const prefix = level === 'error' ? '[Backup ERROR]' : '[Backup]';
  console.log(`${prefix} ${msg}`);
}

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

let backupFolderCache = null;
async function getBackupFolder(drive) {
  if (backupFolderCache) return backupFolderCache;

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
    log(`Creating Drive folder "${folderName}"…`);
    const created = await drive.files.create({
      requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
    });
    folderId = created.data.id;
  }

  backupFolderCache = folderId;
  return folderId;
}

// ── Core backup logic ─────────────────────────────────────────────────────────

async function _doBackup(triggeredBy) {
  const startedAt = Date.now();
  const filename  = buildFilename();

  log(`Starting backup: ${filename}`);
  log(`Triggered by: ${triggeredBy}`);

  // 1. Export all collections
  const db = mongoose.connection.db;
  log('Listing database collections…');
  const collectionInfos = await db.listCollections().toArray();
  log(`Found ${collectionInfos.length} collections`);

  const collections = {};
  let totalDocs = 0;
  for (const info of collectionInfos) {
    const docs = await db.collection(info.name).find({}).toArray();
    collections[info.name] = docs;
    totalDocs += docs.length;
    log(`  ${info.name}: ${docs.length} docs`);
  }
  log(`Export complete — ${totalDocs} total documents`);

  // 2. Compress
  log('Compressing data (gzip)…');
  const payload = {
    name: 'PurpleBox', backedUpAt: new Date().toISOString(),
    triggeredBy, version: '1.0', collections,
  };
  const compressed = await gzip(Buffer.from(JSON.stringify(payload)));
  const sizeKb = Math.round(compressed.length / 1024);
  log(`Compressed: ${sizeKb} KB`);

  // 3. Save local copy first (always)
  fs.mkdirSync(LOCAL_BACKUP_DIR, { recursive: true });
  const localPath = path.join(LOCAL_BACKUP_DIR, filename);
  fs.writeFileSync(localPath, compressed);
  log(`Saved locally: ${localPath}`);

  // 4. Upload to Drive
  let storage = 'local';
  let driveFileId = '';
  let driveUrl = '';

  const drive = driveClient();
  const driveReady = drive && (process.env.GOOGLE_DRIVE_FOLDER_ID || process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID);

  if (driveReady) {
    try {
      log('Connecting to Google Drive…');
      const folderId = await getBackupFolder(drive);
      if (folderId) {
        log(`Uploading ${filename} to Drive folder…`);
        const { data } = await drive.files.create({
          requestBody: { name: filename, parents: [folderId] },
          media: { mimeType: 'application/gzip', body: Readable.from(compressed) },
          fields: 'id, webViewLink',
          supportsAllDrives: true,
        });
        driveFileId = data.id;
        driveUrl    = data.webViewLink;
        storage     = 'drive';
        log(`Uploaded to Drive: ${driveUrl}`, 'ok');
      } else {
        log('Drive folder not available — kept local only', 'error');
      }
    } catch (err) {
      log(`Drive upload failed: ${err.message} — kept local only`, 'error');
    }
  } else {
    log('Google Drive not configured — saved locally only');
  }

  const durationMs = Date.now() - startedAt;
  const result = {
    filename,
    backedUpAt: new Date(startedAt).toISOString(),
    triggeredBy,
    storage,
    driveFileId,
    driveUrl,
    sizeKb,
    collections: collectionInfos.length,
    documents: totalDocs,
    durationMs,
  };

  log(`Backup complete in ${(durationMs / 1000).toFixed(1)}s — ${collectionInfos.length} collections, ${totalDocs} docs, ${sizeKb} KB`, 'ok');
  return result;
}

// ── Public entry point (fire-and-forget safe) ─────────────────────────────────

export async function runBackup(triggeredBy = 'scheduler') {
  if (backupState.running) {
    throw new Error('A backup is already in progress');
  }

  backupState.running     = true;
  backupState.startedAt   = new Date().toISOString();
  backupState.triggeredBy = triggeredBy;
  backupState.logs        = [];
  backupState.lastError   = '';

  const timeout = setTimeout(() => {
    if (backupState.running) {
      log('Backup timed out after 5 minutes', 'error');
      backupState.running   = false;
      backupState.lastError = 'Backup timed out after 5 minutes';
    }
  }, TIMEOUT_MS);

  try {
    const result = await _doBackup(triggeredBy);
    backupState.lastResult = result;
    backupState.lastError  = '';
    return result;
  } catch (err) {
    log(`Backup failed: ${err.message}`, 'error');
    backupState.lastError = err.message;
    throw err;
  } finally {
    clearTimeout(timeout);
    backupState.running = false;
  }
}

// ── List helpers ──────────────────────────────────────────────────────────────

export function listLocalBackups() {
  if (!fs.existsSync(LOCAL_BACKUP_DIR)) return [];
  return fs.readdirSync(LOCAL_BACKUP_DIR)
    .filter(f => f.startsWith('purplebox-backup-') && f.endsWith('.json.gz'))
    .sort().reverse()
    .map(filename => {
      const stat = fs.statSync(path.join(LOCAL_BACKUP_DIR, filename));
      return { filename, sizeKb: Math.round(stat.size / 1024), createdAt: stat.mtime.toISOString() };
    });
}

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
    log(`listDriveBackups error: ${err.message}`, 'error');
    return [];
  }
}
