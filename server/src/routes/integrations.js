import { Router } from 'express';
import { google } from 'googleapis';
import { requireAdmin } from '../middleware/auth.js';
import { driveConfigured } from '../services/drive.js';
import { zohoConfigured } from '../services/zoho.js';
import { whatsappConfigured, whatsappMissing, verifyWebhookChallenge, verifyWhatsAppSignature } from '../services/whatsapp.js';
import { googleContactsConfigured, googleContactsMissing } from '../services/googleContacts.js';
import { runGoogleContactsSync, syncState } from '../services/syncContacts.js';
import { getWhatsAppLabelSyncStatus, processWhatsAppWebhookPayload, runWhatsAppLabelReconciliation } from '../services/whatsappLeadSync.js';
import { updateEnvFile } from '../utils/env.js';

const router = Router();

router.get('/status', (_req, res) => {
    res.json({
        zoho: { configured: zohoConfigured() },
        drive: { configured: driveConfigured() },
        whatsapp: { configured: whatsappConfigured(), missing: whatsappMissing() },
        whatsappLabelSync: getWhatsAppLabelSyncStatus(),
        googleContacts: { configured: googleContactsConfigured(), missing: googleContactsMissing() },
    });
});

router.post('/google-contacts/sync', async (req, res) => {
    if (!googleContactsConfigured()) {
        return res.json({ ok: true, configured: false, summary: { created: 0, updated: 0, skipped: 0, errors: 0 } });
    }
    const summary = await runGoogleContactsSync();
    res.json({ ok: true, configured: true, summary });
});

router.get('/google-contacts/last-sync', (_req, res) => {
    res.json(syncState);
});

router.post('/whatsapp/reconcile', requireAdmin, async (_req, res) => {
    const summary = await runWhatsAppLabelReconciliation();
    res.json({ ok: true, summary });
});

router.get('/whatsapp/last-sync', requireAdmin, (_req, res) => {
    res.json(getWhatsAppLabelSyncStatus());
});

// ── Google Contacts OAuth ─────────────────────────────────────────────────────

function contactsOAuthClient() {
    const callbackUrl = `${process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5010}`}/api/integrations/google/callback`;
    return new google.auth.OAuth2(
        process.env.GOOGLE_CONTACTS_CLIENT_ID,
        process.env.GOOGLE_CONTACTS_CLIENT_SECRET,
        callbackUrl
    );
}

router.get('/contacts/connect', (_req, res) => {
    if (!process.env.GOOGLE_CONTACTS_CLIENT_ID || !process.env.GOOGLE_CONTACTS_CLIENT_SECRET) {
        return res.status(400).json({ error: 'Google OAuth credentials not configured.' });
    }
    const url = contactsOAuthClient().generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        // Request both scopes so one connect covers Contacts + Drive
        scope: [
            'https://www.googleapis.com/auth/contacts.readonly',
            'https://www.googleapis.com/auth/drive',
        ],
    });
    res.json({ url });
});

router.get('/google/callback', async (req, res) => {
    const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
    if (req.query.error) {
        return res.redirect(`${clientOrigin}/settings?contactsError=${encodeURIComponent(req.query.error)}`);
    }
    try {
        const oauth2 = contactsOAuthClient();
        const { tokens } = await oauth2.getToken(String(req.query.code || ''));
        if (!tokens.refresh_token) {
            return res.redirect(`${clientOrigin}/settings?contactsError=${encodeURIComponent('No refresh token — revoke access at myaccount.google.com and try again.')}`);
        }

        // Save contacts token
        updateEnvFile({ GOOGLE_CONTACTS_REFRESH_TOKEN: tokens.refresh_token });
        process.env.GOOGLE_CONTACTS_REFRESH_TOKEN = tokens.refresh_token;

        // Also set up Drive with the same token
        oauth2.setCredentials(tokens);
        const drive = google.drive({ version: 'v3', auth: oauth2 });

        const list = await drive.files.list({
            q: "name='PurpleBox Documents' and mimeType='application/vnd.google-apps.folder' and trashed=false",
            fields: 'files(id)',
            spaces: 'drive',
        });
        let folderId = list.data.files?.[0]?.id;
        if (!folderId) {
            const folder = await drive.files.create({
                requestBody: { name: 'PurpleBox Documents', mimeType: 'application/vnd.google-apps.folder' },
                fields: 'id',
            });
            folderId = folder.data.id;
        }

        updateEnvFile({
            GOOGLE_DRIVE_REFRESH_TOKEN: tokens.refresh_token,
            GOOGLE_DRIVE_FOLDER_ID: folderId,
        });
        process.env.GOOGLE_DRIVE_REFRESH_TOKEN = tokens.refresh_token;
        process.env.GOOGLE_DRIVE_FOLDER_ID = folderId;

        res.redirect(`${clientOrigin}/settings?contactsConnected=1`);
    } catch (err) {
        res.redirect(`${clientOrigin}/settings?contactsError=${encodeURIComponent(err?.message || 'Unknown error')}`);
    }
});

// ── Google Drive OAuth ────────────────────────────────────────────────────────

function driveOAuthClient() {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CONTACTS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
    const callbackUrl = `${process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5010}`}/api/integrations/drive/callback`;
    return new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
}

// Returns the Google consent URL for the frontend to redirect the user to
router.get('/drive/connect', (_req, res) => {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CONTACTS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        return res.status(400).json({ error: 'Google OAuth credentials not configured. Set GOOGLE_CONTACTS_CLIENT_ID and GOOGLE_CONTACTS_CLIENT_SECRET in .env' });
    }
    const url = driveOAuthClient().generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/drive'],
    });
    res.json({ url });
});

// Google redirects here after user consents — exchange code, create folder, save to .env
router.get('/drive/callback', async (req, res) => {
    const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
    if (req.query.error) {
        return res.redirect(`${clientOrigin}/settings?driveError=${encodeURIComponent(req.query.error)}`);
    }
    try {
        const oauth2 = driveOAuthClient();
        const { tokens } = await oauth2.getToken(String(req.query.code || ''));
        if (!tokens.refresh_token) {
            return res.redirect(`${clientOrigin}/settings?driveError=${encodeURIComponent('No refresh token returned. Revoke access at myaccount.google.com and try again.')}`);
        }
        oauth2.setCredentials(tokens);
        const drive = google.drive({ version: 'v3', auth: oauth2 });

        // Reuse existing folder if one was already created
        const list = await drive.files.list({
            q: "name='PurpleBox Documents' and mimeType='application/vnd.google-apps.folder' and trashed=false",
            fields: 'files(id)',
            spaces: 'drive',
        });
        let folderId = list.data.files?.[0]?.id;
        if (!folderId) {
            const folder = await drive.files.create({
                requestBody: { name: 'PurpleBox Documents', mimeType: 'application/vnd.google-apps.folder' },
                fields: 'id',
            });
            folderId = folder.data.id;
        }

        // Persist to .env and hot-reload into process.env so uploads work immediately
        updateEnvFile({ GOOGLE_DRIVE_REFRESH_TOKEN: tokens.refresh_token, GOOGLE_DRIVE_FOLDER_ID: folderId });
        process.env.GOOGLE_DRIVE_REFRESH_TOKEN = tokens.refresh_token;
        process.env.GOOGLE_DRIVE_FOLDER_ID = folderId;

        res.redirect(`${clientOrigin}/settings?driveConnected=1`);
    } catch (err) {
        const msg = err?.message || 'Unknown error';
        res.redirect(`${clientOrigin}/settings?driveError=${encodeURIComponent(msg)}`);
    }
});

router.get('/whatsapp/webhook', (req, res) => {
    const result = verifyWebhookChallenge(req.query);
    if (!result.ok) return res.status(result.status).send(result.message);
    res.status(200).send(result.challenge);
});

router.post('/whatsapp/webhook', async (req, res) => {
    const signature = req.headers['x-hub-signature-256'];
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    if (!verifyWhatsAppSignature(String(signature || ''), rawBody)) {
        return res.status(401).json({ error: 'Invalid WhatsApp signature' });
    }
    try {
        const result = await processWhatsAppWebhookPayload(req.body || {});
        return res.json({ ok: true, received: true, result });
    } catch (err) {
        return res.status(500).json({ error: err?.message || 'Failed to process webhook payload' });
    }
});

export default router;
