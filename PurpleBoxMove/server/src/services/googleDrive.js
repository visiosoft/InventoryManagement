const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

let driveClient = null;

function getDrive() {
  if (driveClient) return driveClient;

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
    || path.join(__dirname, '..', '..', 'google-service-account.json');

  if (!fs.existsSync(keyPath)) {
    console.warn('⚠ Google Drive: service account key not found at', keyPath);
    console.warn('  Media will be saved to local disk as fallback.');
    return null;
  }

  const auth = new google.auth.GoogleAuth({ keyFile: keyPath, scopes: SCOPES });
  driveClient = google.drive({ version: 'v3', auth });
  console.log('✓ Google Drive client initialized');
  return driveClient;
}

const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || null;

async function getOrCreateLeadFolder(drive, leadReference) {
  const folderName = `Lead-${leadReference}`;

  const query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    + (PARENT_FOLDER_ID ? ` and '${PARENT_FOLDER_ID}' in parents` : '');

  const existing = await drive.files.list({ q: query, fields: 'files(id, name)', spaces: 'drive' });
  if (existing.data.files.length > 0) return existing.data.files[0].id;

  const folderMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    ...(PARENT_FOLDER_ID ? { parents: [PARENT_FOLDER_ID] } : {}),
  };
  const folder = await drive.files.create({
    resource: folderMetadata,
    fields: 'id',
  });
  return folder.data.id;
}

async function uploadFileToDrive(localFilePath, fileName, mimeType, leadReference) {
  const drive = getDrive();
  if (!drive) return null;

  try {
    const folderId = await getOrCreateLeadFolder(drive, leadReference);

    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = { mimeType, body: fs.createReadStream(localFilePath) };

    const response = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id, webViewLink, webContentLink',
    });

    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: { role: 'reader', type: 'anyone' },
    });

    const fileData = await drive.files.get({
      fileId: response.data.id,
      fields: 'id, webViewLink, webContentLink',
    });

    fs.unlink(localFilePath, () => {});

    return {
      fileId: fileData.data.id,
      url: fileData.data.webContentLink || fileData.data.webViewLink,
      folderId,
    };
  } catch (err) {
    console.error('Google Drive upload error:', err.message);
    return null;
  }
}

module.exports = { uploadFileToDrive, getDrive };
