import { Router } from 'express';
import { google } from 'googleapis';
import { requireAdmin } from '../middleware/auth.js';
import { driveConfigured } from '../services/drive.js';
import { gmailConfigured } from '../services/gmail.js';
import { mailConfigured, mailFromAddress } from '../services/mail.js';
import { zohoConfigured } from '../services/zoho.js';
import { zohoBooksConfigured, listAllZohoContacts } from '../services/zohoBooks.js';
import { Customer, Contract, WhatsAppWebhookHit } from '../models/index.js';
import { whatsappConfigured, whatsappMissing, verifyWebhookChallenge, verifyWhatsAppSignature, verifyWhatsAppCredentials } from '../services/whatsapp.js';
import { getWhatsAppLabelSyncStatus, processWhatsAppWebhookPayload, runWhatsAppLabelReconciliation } from '../services/whatsappLeadSync.js';
import { stripeConfigured, stripeWebhookConfigured, verifyStripeKey } from '../services/stripe.js';
import { updateEnvFile } from '../utils/env.js';
import { openaiConfigured, openaiModel, openaiKeyHint, verifyOpenAIKey, parseAvailabilityQuery } from '../services/openai.js';

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
        // The key itself is never sent to the client — only a masked hint.
        openai: { configured: openaiConfigured(), model: openaiModel(), keyHint: openaiKeyHint() },
        // Deep link into Zoho Books' own invoice composer, so staff who raise
        // invoices there can jump straight to it. Data-centre specific, hence
        // the env override.
        zohoBooks: {
            configured: zohoBooksConfigured(),
            newInvoiceUrl: zohoBooksConfigured()
                ? `${process.env.ZOHO_BOOKS_APP_BASE || 'https://books.zoho.com'}/app/${process.env.ZOHO_BOOKS_ORG_ID}#/invoices/new`
                : '',
        },
        // `from` is what mail actually goes out as, so the UI can show the real
        // sender rather than guessing.
        email: { configured: mailConfigured(), from: mailFromAddress() },
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
// Save or rotate the OpenAI key and model. Rotating is the same call with a
// new key: it is validated before anything is written, so a bad paste cannot
// knock the working key out.
router.post('/openai/connect', requireAdmin, async (req, res) => {
    const apiKey = String(req.body?.apiKey || '').trim();
    const model = String(req.body?.model || '').trim();
    if (!apiKey && !model) return res.status(400).json({ error: 'Nothing to save' });

    const effectiveKey = apiKey || process.env.OPENAI_API_KEY;
    if (!effectiveKey) return res.status(400).json({ error: 'An API key is required' });
    const effectiveModel = model || openaiModel();

    try {
        await verifyOpenAIKey(effectiveKey, effectiveModel);
    } catch (e) {
        const msg = e.response?.status === 401
            ? 'OpenAI rejected that key'
            : e.response?.data?.error?.message || e.message;
        return res.status(400).json({ error: msg });
    }

    const updates = {};
    if (apiKey) updates.OPENAI_API_KEY = effectiveKey;
    if (model) updates.OPENAI_MODEL = effectiveModel;
    updateEnvFile(updates);
    Object.assign(process.env, updates);

    res.json({ ok: true, configured: true, model: openaiModel(), keyHint: openaiKeyHint() });
});

router.post('/openai/disconnect', requireAdmin, async (_req, res) => {
    const blanks = { OPENAI_API_KEY: '' };
    updateEnvFile(blanks);
    Object.assign(process.env, blanks);
    res.json({ ok: true });
});

// Turn a phrase into availability filters. Any signed-in user may call this —
// it reads nothing and writes nothing, it only interprets text.
router.post('/ai/parse-availability', async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Nothing to interpret' });
    if (!openaiConfigured()) return res.status(501).json({ error: 'OpenAI is not configured' });

    const floors = Array.isArray(req.body?.floors) ? req.body.floors.map(String) : [];
    const sizes = Array.isArray(req.body?.sizes) ? req.body.sizes.map(Number).filter(Number.isFinite) : [];

    try {
        const result = await parseAvailabilityQuery(text, { floors, sizes });
        res.json(result);
    } catch (e) {
        const msg = e.response?.data?.error?.message || e.message;
        res.status(502).json({ error: `Could not reach OpenAI: ${msg}` });
    }
});

router.post('/whatsapp/connect', requireAdmin, async (req, res) => {
    const { phoneNumberId, accessToken, verifyToken, appSecret } = req.body || {};
    const updates = {};
    if (phoneNumberId) {
        const raw = String(phoneNumberId).trim();
        // The commonest mistake here is pasting the WhatsApp phone number
        // instead of Meta's Phone number ID. Meta answers that with
        // "Object with ID ... does not exist", which explains nothing, so
        // catch the unambiguous shapes first: a leading +, or separators.
        if (/^\+/.test(raw) || /[\s()\-]/.test(raw.replace(/^\+/, ''))) {
            return res.status(400).json({
                error: `"${raw}" looks like a phone number, not a Phone number ID. The ID is a long digits-only value in Meta → WhatsApp → API Setup, under the number itself.`,
            });
        }
        if (!/^\d+$/.test(raw)) {
            return res.status(400).json({ error: 'The Phone number ID should be digits only.' });
        }
        updates.WHATSAPP_PHONE_NUMBER_ID = raw;
    }
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
            // A short digits-only value is most likely a phone number too, but
            // not certainly, so this only adds a hint to Meta's own message.
            const looksLikeNumber = /^\d{7,14}$/.test(String(effectiveId || ''));
            let hint = looksLikeNumber
                ? ' — that value looks like a phone number; the Phone number ID is a separate, longer id shown in Meta → WhatsApp → API Setup.'
                : '';
            // The token field starts blank, so saving without it validates
            // against the stored one. When that is what expired, say so —
            // otherwise the error looks like the new token was rejected.
            if (!accessToken && /expire/i.test(e.message || '')) {
                hint = ' — this is the token already saved here, not one you just entered. Paste the new token into the Access token field and save again.';
            }
            return res.status(400).json({ error: `Meta rejected these credentials: ${e.message}${hint}` });
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

    // Summarise the payload for the hit log — never the message text.
    const change = req.body?.entry?.[0]?.changes?.[0];
    const value = change?.value || {};
    const hit = {
        hasSignature: Boolean(signature),
        field: change?.field || '',
        messageCount: (value.messages || []).length,
        statusCount: (value.statuses || []).length,
        from: value.messages?.[0]?.from || '',
    };
    const record = async (ok, reason) => {
        try {
            await WhatsAppWebhookHit.create({ ...hit, ok, reason });
            // Keep it bounded — this is a diagnostic, not an archive.
            const cutoff = await WhatsAppWebhookHit.find().sort({ at: -1 }).skip(200).select('_id').lean();
            if (cutoff.length) await WhatsAppWebhookHit.deleteMany({ _id: { $in: cutoff.map((d) => d._id) } });
        } catch { /* logging must never break delivery */ }
    };

    if (!verifyWhatsAppSignature(String(signature || ''), rawBody)) {
        await record(false, signature ? 'signature did not match WHATSAPP_APP_SECRET' : 'no x-hub-signature-256 header');
        return res.status(401).json({ error: 'Invalid WhatsApp signature' });
    }
    try {
        const result = await processWhatsAppWebhookPayload(req.body || {});
        await record(true, 'processed');
        return res.json({ ok: true, received: true, result });
    } catch (err) {
        await record(false, `processing failed: ${err?.message || 'unknown'}`);
        return res.status(500).json({ error: err?.message || 'Failed to process webhook payload' });
    }
});

// What Meta has actually sent us lately — the answer to "are replies arriving".
router.get('/whatsapp/webhook-hits', requireAdmin, async (_req, res) => {
    const hits = await WhatsAppWebhookHit.find().sort({ at: -1 }).limit(30).lean();
    res.json({ hits });
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
