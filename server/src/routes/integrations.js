import { Router } from 'express';
import { google } from 'googleapis';
import { driveConfigured } from '../services/drive.js';
import { zohoConfigured } from '../services/zoho.js';
import { whatsappConfigured, whatsappMissing, verifyWebhookChallenge, verifyWhatsAppSignature } from '../services/whatsapp.js';
import { fetchGoogleContacts, googleContactsConfigured, googleContactsMissing } from '../services/googleContacts.js';
import { Lead } from '../models/index.js';
import { normalizeLeadPhone } from './leads.js';
import { updateEnvFile } from '../utils/env.js';

const router = Router();

router.get('/status', (_req, res) => {
    res.json({
        zoho: { configured: zohoConfigured() },
        drive: { configured: driveConfigured() },
        whatsapp: { configured: whatsappConfigured(), missing: whatsappMissing() },
        googleContacts: { configured: googleContactsConfigured(), missing: googleContactsMissing() },
    });
});

router.post('/google-contacts/sync', async (req, res) => {
    const ownerId = req.body?.owner || req.user?.id;
    if (!ownerId) return res.status(400).json({ error: 'Owner is required for sync' });

    const { contacts, note } = await fetchGoogleContacts();
    if (!googleContactsConfigured()) {
        return res.json({
            ok: true,
            configured: false,
            note,
            summary: { created: 0, updated: 0, skipped: 0, errors: 0 },
        });
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const c of contacts) {
        try {
            const phoneNormalized = normalizeLeadPhone(c.phone);
            if (!phoneNormalized) {
                skipped += 1;
                continue;
            }

            const existing = await Lead.findOne({ phoneNormalized });
            if (!existing) {
                await Lead.create({
                    fullName: c.name || 'Unknown Contact',
                    email: c.email || '',
                    phone: c.phone,
                    phoneNormalized,
                    status: 'new',
                    source: 'google_contacts',
                    leadDateTime: new Date(),
                    storageSizeValue: 25,
                    storageSizeUnit: 'sqft',
                    durationValue: 1,
                    durationUnit: 'month',
                    owner: ownerId,
                    unitsNeeded: 1,
                    notes: c.notes || '',
                    timeline: [{ type: 'google_contacts_import', text: 'Lead created from Google Contacts sync' }],
                });
                created += 1;
                continue;
            }

            existing.fullName = c.name || existing.fullName;
            existing.email = c.email || existing.email;
            existing.phone = c.phone || existing.phone;
            existing.phoneNormalized = phoneNormalized;
            if (!existing.source || existing.source === 'manual') existing.source = 'google_contacts';
            if (c.notes) {
                existing.notes = existing.notes ? `${existing.notes}\n${c.notes}` : c.notes;
            }
            existing.timeline.push({ type: 'google_contacts_update', text: 'Lead updated from Google Contacts sync' });
            await existing.save();
            updated += 1;
        } catch {
            errors += 1;
        }
    }

    res.json({
        ok: true,
        configured: true,
        summary: { created, updated, skipped, errors },
        imported: contacts.length,
    });
});

// ── Google Drive OAuth ────────────────────────────────────────────────────────

function driveOAuthClient() {
    const clientId     = process.env.GOOGLE_DRIVE_CLIENT_ID     || process.env.GOOGLE_CONTACTS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
    const callbackUrl  = `${process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5010}`}/api/integrations/drive/callback`;
    return new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
}

// Returns the Google consent URL for the frontend to redirect the user to
router.get('/drive/connect', (_req, res) => {
    const clientId     = process.env.GOOGLE_DRIVE_CLIENT_ID     || process.env.GOOGLE_CONTACTS_CLIENT_ID;
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

router.post('/whatsapp/webhook', (req, res) => {
    const signature = req.headers['x-hub-signature-256'];
    const rawBody = Buffer.from(JSON.stringify(req.body || {}));
    if (!verifyWhatsAppSignature(String(signature || ''), rawBody)) {
        return res.status(401).json({ error: 'Invalid WhatsApp signature' });
    }
    // Setup-only v1: accept and acknowledge webhook payloads without processing timeline/messages.
    return res.json({ ok: true, received: true });
});

export default router;
