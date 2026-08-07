import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { Readable } from 'stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');

function hasServiceAccountConfig() {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE &&
    fs.existsSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE) &&
    process.env.GOOGLE_DRIVE_FOLDER_ID
  );
}

function hasOAuthConfig() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CONTACTS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_CONTACTS_REFRESH_TOKEN;
  return Boolean(clientId && clientSecret && refreshToken && process.env.GOOGLE_DRIVE_FOLDER_ID);
}

export function driveConfigured() {
  return hasServiceAccountConfig() || hasOAuthConfig();
}

function requireDrive() {
  if (!driveConfigured()) throw new Error('Google Drive is not configured. Set GOOGLE_DRIVE_* env vars.');
}

export function driveClient() {
  let auth;
  if (hasServiceAccountConfig()) {
    auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
  } else {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CONTACTS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_CONTACTS_REFRESH_TOKEN;
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    auth = oauth2Client;
  }
  return google.drive({ version: 'v3', auth });
}

const folderCache = new Map();

function safeFolderName(name) {
  return String(name || 'Unknown').replace(/[/\\?%*:|"<>]/g, '-').trim() || 'Unknown';
}

async function getOrCreateFolder(drive, name, parentId) {
  const key = `${parentId}::${name}`;
  if (folderCache.has(key)) return folderCache.get(key);

  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const list = await drive.files.list({ q, fields: 'files(id)', spaces: 'drive' });
  let folderId = list.data.files?.[0]?.id;

  if (!folderId) {
    const folder = await drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
    });
    folderId = folder.data.id;
  }

  folderCache.set(key, folderId);
  return folderId;
}

async function getOrCreateCustomerFolder(drive, customerName) {
  const key = safeFolderName(customerName);
  return getOrCreateFolder(drive, key, process.env.GOOGLE_DRIVE_FOLDER_ID);
}

async function getOrCreateVendorFolder(drive, vendorName) {
  const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const vendorRootId = await getOrCreateFolder(drive, 'Vendors', rootId);
  const safeVendor = safeFolderName(vendorName || 'Unknown');
  return getOrCreateFolder(drive, safeVendor, vendorRootId);
}

export async function uploadPublicImage({ buffer, stream, filename, mimeType, customerName }) {
  requireDrive();
  const drive = driveClient();
  const parentId = customerName
    ? await getOrCreateCustomerFolder(drive, customerName)
    : process.env.GOOGLE_DRIVE_FOLDER_ID;

  const { data } = await drive.files.create({
    requestBody: { name: filename, parents: [parentId] },
    media: { mimeType, body: stream || Readable.from(buffer) },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });

  await drive.permissions.create({
    fileId: data.id,
    requestBody: { role: 'reader', type: 'anyone' },
    supportsAllDrives: true,
  });

  const url = `https://drive.google.com/thumbnail?id=${data.id}&sz=w800`;
  return { storage: 'drive', driveFileId: data.id, url, viewUrl: data.webViewLink };
}

export async function uploadFile({ buffer, filename, mimeType, customerName }) {
  requireDrive();
  const drive = driveClient();
  const parentId = customerName
    ? await getOrCreateCustomerFolder(drive, customerName)
    : process.env.GOOGLE_DRIVE_FOLDER_ID;

  const { data } = await drive.files.create({
    requestBody: { name: filename, parents: [parentId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });

  await drive.permissions.create({
    fileId: data.id,
    requestBody: { role: 'reader', type: 'anyone' },
    supportsAllDrives: true,
  });

  return { storage: 'drive', driveFileId: data.id, url: data.webViewLink };
}

export async function uploadToVendorFolder({ buffer, filename, mimeType, vendorName }) {
  requireDrive();
  const drive = driveClient();
  const parentId = await getOrCreateVendorFolder(drive, vendorName || 'Unknown');

  const { data } = await drive.files.create({
    requestBody: { name: filename, parents: [parentId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });

  await drive.permissions.create({
    fileId: data.id,
    requestBody: { role: 'reader', type: 'anyone' },
    supportsAllDrives: true,
  });

  return { storage: 'drive', driveFileId: data.id, url: data.webViewLink, viewUrl: data.webViewLink };
}
