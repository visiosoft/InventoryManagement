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

// ── Backup configuration (frequency set from the frontend) ────────────────────

const gunzip = promisify(zlib.gunzip);

const CONFIG_DEFAULTS = { enabled: true, frequency: 'daily', hour: 2 };
const FREQUENCY_HOURS = { '6h': 6, '12h': 12, daily: 24, weekly: 168 };

function configCollection() {
  return mongoose.connection.db.collection('backupconfig');
}

export async function getBackupConfig() {
  const doc = await configCollection().findOne({ key: 'default' });
  return { ...CONFIG_DEFAULTS, ...(doc || {}) };
}

export async function saveBackupConfig(patch, by = '') {
  const clean = {};
  if (patch.enabled !== undefined) clean.enabled = !!patch.enabled;
  if (patch.frequency !== undefined) {
    if (!FREQUENCY_HOURS[patch.frequency]) throw new Error('Invalid frequency');
    clean.frequency = patch.frequency;
  }
  if (patch.hour !== undefined) {
    const h = Number(patch.hour);
    if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error('Hour must be 0–23');
    clean.hour = h;
  }
  clean.updatedBy = by;
  clean.updatedAt = new Date();
  await configCollection().updateOne({ key: 'default' }, { $set: clean }, { upsert: true });
  return getBackupConfig();
}

async function markAutoRun() {
  await configCollection().updateOne({ key: 'default' }, { $set: { lastAutoAt: new Date() } }, { upsert: true });
}

// Checks once a minute whether an automatic backup is due, per the saved
// config. Survives restarts because lastAutoAt lives in the database.
export function startBackupScheduler() {
  setInterval(async () => {
    try {
      if (backupState.running || restoreState.running) return;
      const cfg = await getBackupConfig();
      if (!cfg.enabled) return;
      const periodH = FREQUENCY_HOURS[cfg.frequency] ?? 24;
      const now = new Date();
      const last = cfg.lastAutoAt ? new Date(cfg.lastAutoAt) : null;
      let due = false;
      if (periodH < 24) {
        due = !last || now - last >= periodH * 3600_000 - 30_000;
      } else {
        // Daily/weekly runs anchor on the configured hour (first 5 minutes)
        const gapOk = !last || now - last >= (periodH - 1) * 3600_000;
        due = now.getHours() === Number(cfg.hour) && now.getMinutes() < 5 && gapOk;
      }
      if (!due) return;
      await markAutoRun();
      await runBackup('scheduler');
    } catch (e) {
      console.error('[Backup] scheduler:', e.message);
    }
  }, 60_000);
  console.log('[Backup] Scheduler active — frequency comes from the Backup page settings');
}

// ── Download ──────────────────────────────────────────────────────────────────

/** The raw .json.gz for a listed backup — local copy first, Drive otherwise. */
export async function getBackupFile(filename) {
  if (!/^purplebox-backup-[\w.-]+\.json\.gz$/.test(filename)) {
    throw new Error('Invalid backup filename');
  }
  const localPath = path.join(LOCAL_BACKUP_DIR, filename);
  if (fs.existsSync(localPath)) return fs.readFileSync(localPath);

  const drive = driveClient();
  if (!drive) throw new Error('Backup not found locally and Google Drive is not configured');
  const folderId = await getBackupFolder(drive);
  const list = await drive.files.list({
    q: `'${folderId}' in parents and name='${filename.replace(/'/g, "\\'")}' and trashed=false`,
    fields: 'files(id)', spaces: 'drive',
  });
  const file = list.data.files?.[0];
  if (!file) throw new Error('Backup not found');
  const res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

// ── Restore ───────────────────────────────────────────────────────────────────

export const restoreState = {
  running: false,
  startedAt: null,
  triggeredBy: '',
  filename: '',
  logs: [],
  lastResult: null,
  lastError: '',
};

function rlog(msg, level = 'info') {
  restoreState.logs.push({ at: new Date().toISOString(), msg, level });
  console.log(`[Restore${level === 'error' ? ' ERROR' : ''}] ${msg}`);
}

// The export is plain JSON, so ObjectIds and Dates arrive as strings — revive
// them or every reference between collections breaks.
const HEX24 = /^[0-9a-f]{24}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
function revive(value, key) {
  if (typeof value === 'string') {
    // Any 24-hex string in a dump of our own data is an ObjectId
    if (HEX24.test(value)) {
      try { return new mongoose.Types.ObjectId(value); } catch { return value; }
    }
    if (ISO_DATE.test(value)) return new Date(value);
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => revive(v, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = revive(v, k);
    return out;
  }
  return value;
}

export async function runRestore({ buffer, filename = '', actor = '' }) {
  if (backupState.running) throw new Error('A backup is running — wait for it to finish');
  if (restoreState.running) throw new Error('A restore is already in progress');

  restoreState.running = true;
  restoreState.startedAt = new Date().toISOString();
  restoreState.triggeredBy = actor;
  restoreState.filename = filename;
  restoreState.logs = [];
  restoreState.lastError = '';

  try {
    rlog(`Restore requested by ${actor}${filename ? ` from ${filename}` : ' from uploaded file'}`);

    rlog('Reading backup archive…');
    const json = await gunzip(buffer);
    const payload = JSON.parse(json.toString());
    if (!payload?.collections || typeof payload.collections !== 'object') {
      throw new Error('Not a PurpleBox backup file (no collections found)');
    }
    const names = Object.keys(payload.collections);
    rlog(`Archive from ${payload.backedUpAt || 'unknown date'} — ${names.length} collections`);

    // Safety net: snapshot the current data before touching anything
    rlog('Taking a safety backup of the CURRENT data first…');
    restoreState.running = false; // let runBackup take its lock
    try {
      const safety = await runBackup(`pre-restore safety (${actor})`);
      rlog(`Safety backup saved: ${safety.filename}`, 'ok');
    } finally {
      restoreState.running = true;
    }

    const db = mongoose.connection.db;
    let restoredDocs = 0;
    for (const name of names) {
      const docs = (payload.collections[name] || []).map((d) => revive(d, ''));
      rlog(`  ${name}: replacing with ${docs.length} docs`);
      await db.collection(name).deleteMany({});
      for (let i = 0; i < docs.length; i += 500) {
        const chunk = docs.slice(i, i + 500);
        if (chunk.length) await db.collection(name).insertMany(chunk, { ordered: false });
      }
      restoredDocs += docs.length;
    }

    const result = {
      filename,
      restoredAt: new Date().toISOString(),
      collections: names.length,
      documents: restoredDocs,
      backupDate: payload.backedUpAt || null,
    };
    restoreState.lastResult = result;
    rlog(`Restore complete — ${names.length} collections, ${restoredDocs} documents`, 'ok');
    return result;
  } catch (err) {
    restoreState.lastError = err.message;
    rlog(`Restore failed: ${err.message}`, 'error');
    throw err;
  } finally {
    restoreState.running = false;
  }
}
