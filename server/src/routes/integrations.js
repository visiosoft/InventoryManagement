import { Router } from 'express';
import { google } from 'googleapis';
import { requireAdmin } from '../middleware/auth.js';
import { driveConfigured } from '../services/drive.js';
import { gmailConfigured } from '../services/gmail.js';
import { zohoConfigured } from '../services/zoho.js';
import { zohoBooksConfigured, listAllZohoContacts } from '../services/zohoBooks.js';
import { Customer, Contract } from '../models/index.js';
import { whatsappConfigured, whatsappMissing, verifyWebhookChallenge, verifyWhatsAppSignature, verifyWhatsAppCredentials } from '../services/whatsapp.js';
import { getWhatsAppLabelSyncStatus, processWhatsAppWebhookPayload, runWhatsAppLabelReconciliation } from '../services/whatsappLeadSync.js';
import { stripeConfigured, stripeWebhookConfigured, verifyStripeKey } from '../services/stripe.js';
import { updateEnvFile } from '../utils/env.js';

const router = Router();

router.get('/status', (_req, res) => {
    res.json({
        zoho: { configured: zohoConfigured() },
        drive: {
            configured: driveConfigured(),
            folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
            method: driveConfigured()
                ? (process.env.GOOGLE_SERVICE_ACCOUNT_FILE ? 'service_account' : 'oauth')
                : '',
        },
        gmail: { configured: gmailConfigured() },
        whatsapp: { configured: whatsappConfigured(), missing: whatsappMissing() },
        whatsappLabelSync: getWhatsAppLabelSyncStatus(),
        stripe: { configured: stripeConfigured(), webhookConfigured: stripeWebhookConfigured() },
    });
});

// Save (and validate) Stripe credentials. Admin only — these are payment keys.
// secretKey is optional on repeat calls — e.g. adding just the webhook secret
// after the fact doesn't need to re-send (and re-validate) the secret key.
router.post('/stripe/connect', requireAdmin, async (req, res) => {
    const { secretKey, webhookSecret } = req.body || {};
    if (!secretKey && !webhookSecret) {
        return res.status(400).json({ error: 'Nothing to save' });
    }
    const updates = {};
    if (secretKey) {
        if (!/^sk_(test|live)_/.test(secretKey)) {
            return res.status(400).json({ error: 'That doesn\'t look like a Stripe secret key (should start with sk_test_ or sk_live_)' });
        }
        try {
            await verifyStripeKey(secretKey);
        } catch (e) {
            return res.status(400).json({ error: `Stripe rejected this key: ${e.message}` });
        }
        updates.STRIPE_SECRET_KEY = secretKey;
    }
    if (webhookSecret) updates.STRIPE_WEBHOOK_SECRET = webhookSecret;
    updateEnvFile(updates);
    Object.assign(process.env, updates);
    res.json({ ok: true, configured: stripeConfigured(), webhookConfigured: stripeWebhookConfigured() });
});

// Clears the stored Stripe keys.
router.post('/stripe/disconnect', requireAdmin, async (_req, res) => {
    updateEnvFile({ STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' });
    process.env.STRIPE_SECRET_KEY = '';
    process.env.STRIPE_WEBHOOK_SECRET = '';
    res.json({ ok: true });
});

// Save (and validate) WhatsApp Cloud API credentials, so the number can be
// switched between the Meta test number and the real business number without
// server access. Same shape as the Stripe flow above.
router.post('/whatsapp/connect', requireAdmin, async (req, res) => {
    const { phoneNumberId, accessToken, verifyToken, appSecret } = req.body || {};
    const updates = {};
    if (phoneNumberId) updates.WHATSAPP_PHONE_NUMBER_ID = String(phoneNumberId).trim();
    if (accessToken) updates.WHATSAPP_ACCESS_TOKEN = String(accessToken).trim();
    if (verifyToken) updates.WHATSAPP_VERIFY_TOKEN = String(verifyToken).trim();
    if (appSecret) updates.WHATSAPP_APP_SECRET = String(appSecret).trim();
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to save' });

    // Validate against Meta whenever we have both halves of the send credential
    // — either freshly supplied or already stored from a previous save.
    const effectiveId = updates.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const effectiveToken = updates.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
    let profile = { displayPhoneNumber: '', verifiedName: '' };
    if (effectiveId && effectiveToken) {
        try {
            profile = await verifyWhatsAppCredentials({ phoneNumberId: effectiveId, accessToken: effectiveToken });
        } catch (e) {
            return res.status(400).json({ error: `Meta rejected these credentials: ${e.message}` });
        }
    }

    updateEnvFile(updates);
    Object.assign(process.env, updates);
    res.json({
        ok: true,
        configured: whatsappConfigured(),
        missing: whatsappMissing(),
        displayPhoneNumber: profile.displayPhoneNumber,
        verifiedName: profile.verifiedName,
    });
});

router.post('/whatsapp/disconnect', requireAdmin, async (_req, res) => {
    const blanks = {
        WHATSAPP_PHONE_NUMBER_ID: '',
        WHATSAPP_ACCESS_TOKEN: '',
        WHATSAPP_VERIFY_TOKEN: '',
        WHATSAPP_APP_SECRET: '',
    };
    updateEnvFile(blanks);
    Object.assign(process.env, blanks);
    res.json({ ok: true });
});

router.post('/whatsapp/reconcile', requireAdmin, async (_req, res) => {
    const summary = await runWhatsAppLabelReconciliation();
    res.json({ ok: true, summary });
});

router.get('/whatsapp/last-sync', requireAdmin, (_req, res) => {
    res.json(getWhatsAppLabelSyncStatus());
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

// ── Gmail OAuth ──────────────────────────────────────────────────────────────

function gmailOAuthClient() {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CONTACTS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
    const callbackUrl = `${process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5010}`}/api/integrations/gmail/callback`;
    return new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
}

router.get('/gmail/connect', (_req, res) => {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CONTACTS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        return res.status(400).json({ error: 'Google OAuth credentials not configured.' });
    }
    const url = gmailOAuthClient().generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/gmail.send'],
    });
    res.json({ url });
});

router.get('/gmail/callback', async (req, res) => {
    const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
    if (req.query.error) {
        return res.redirect(`${clientOrigin}/settings?gmailError=${encodeURIComponent(req.query.error)}`);
    }
    try {
        const oauth2 = gmailOAuthClient();
        const { tokens } = await oauth2.getToken(String(req.query.code || ''));
        if (!tokens.refresh_token) {
            return res.redirect(`${clientOrigin}/settings?gmailError=${encodeURIComponent('No refresh token returned. Revoke access at myaccount.google.com and try again.')}`);
        }
        updateEnvFile({ GOOGLE_GMAIL_REFRESH_TOKEN: tokens.refresh_token });
        process.env.GOOGLE_GMAIL_REFRESH_TOKEN = tokens.refresh_token;
        res.redirect(`${clientOrigin}/settings?gmailConnected=1`);
    } catch (err) {
        const msg = err?.message || 'Unknown error';
        res.redirect(`${clientOrigin}/settings?gmailError=${encodeURIComponent(msg)}`);
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




// ── Zoho Books ↔ ERP customer comparison ─────────────────────────────────────
// Matches on normalised name OR phone digits (either matching counts).
const zcDigits = (v) => String(v || '').replace(/\D/g, '').replace(/^00971/, '').replace(/^971/, '').replace(/^0/, '');
const zcName = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');

router.get('/zoho-books/customer-comparison', async (req, res) => {
    try {
        if (!zohoBooksConfigured()) return res.status(501).json({ error: 'Zoho Books is not configured' });
        const [{ contacts }, customers, contractAgg] = await Promise.all([
            listAllZohoContacts({ force: req.query.refresh === 'true' }),
            Customer.find({}).select('fullName company email phone phones clientId').lean(),
            Contract.aggregate([{ $group: { _id: '$customer', n: { $sum: 1 } } }]),
        ]);
        const contractCount = new Map(contractAgg.map((a) => [String(a._id), a.n]));

        // Index ERP customers by every name and phone key they have
        const byKey = new Map();
        const addKey = (k, c) => { if (!k) return; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(c); };
        for (const c of customers) {
            addKey(`n:${zcName(c.fullName)}`, c);
            if (c.company) addKey(`n:${zcName(c.company)}`, c);
            const phones = [...(c.phones || []), c.phone].filter(Boolean);
            for (const ph of phones) { const d = zcDigits(ph); if (d.length >= 7) addKey(`p:${d}`, c); }
        }

        const matchedErpIds = new Set();
        const matched = [];
        const zohoOnly = [];
        for (const z of contacts) {
            const keys = [];
            if (z.name) keys.push({ k: `n:${zcName(z.name)}`, by: 'name' });
            if (z.company && z.company !== z.name) keys.push({ k: `n:${zcName(z.company)}`, by: 'name' });
            for (const ph of [z.phone, z.mobile]) { const d = zcDigits(ph); if (d.length >= 7) keys.push({ k: `p:${d}`, by: 'phone' }); }
            let hit = null;
            for (const { k, by } of keys) {
                const found = byKey.get(k);
                if (found?.length) { hit = { erp: found[0], by }; break; }
            }
            if (hit) {
                matchedErpIds.add(String(hit.erp._id));
                matched.push({
                    zoho: z,
                    erp: {
                        _id: hit.erp._id, fullName: hit.erp.fullName, email: hit.erp.email,
                        phone: (hit.erp.phones && hit.erp.phones[0]) || hit.erp.phone || '',
                        contracts: contractCount.get(String(hit.erp._id)) || 0,
                    },
                    matchedBy: hit.by,
                });
            } else {
                zohoOnly.push(z);
            }
        }
        const erpOnly = customers
            .filter((c) => !matchedErpIds.has(String(c._id)))
            .map((c) => ({
                _id: c._id, fullName: c.fullName, email: c.email,
                phone: (c.phones && c.phones[0]) || c.phone || '',
                contracts: contractCount.get(String(c._id)) || 0,
            }));

        res.json({
            zohoTotal: contacts.length,
            erpTotal: customers.length,
            matched, zohoOnly, erpOnly,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
