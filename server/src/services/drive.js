import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { Readable } from 'stream';

// Google Drive integration. If a service account is not configured, runs in
// LOCAL mode: files are stored under server/uploads and served at /uploads.

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

function driveClient() {
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

// Uploads a file buffer. Returns { storage, driveFileId, url }.
export async function uploadFile({ buffer, filename, mimeType }) {
  if (driveConfigured()) {
    const drive = driveClient();
    const { data } = await drive.files.create({
      requestBody: {
        name: filename,
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
      },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    });
    return { storage: 'drive', driveFileId: data.id, url: data.webViewLink };
  }

  // Local fallback
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, safeName), buffer);
  return { storage: 'local', driveFileId: '', url: `/uploads/${safeName}` };
}
