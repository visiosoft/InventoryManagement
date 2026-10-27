import { Router } from 'express';
import { google } from 'googleapis';
import { requireAdmin } from '../middleware/auth.js';
import { driveConfigured } from '../services/drive.js';
import { gmailConfigured } from '../services/gmail.js';
import { mailConfigured, mailFromAddress } from '../services/mail.js';
import { zohoConfigured } from '../services/zoho.js';
import { zohoBooksConfigured } from '../services/zohoBooks.js';
import { WhatsAppWebhookHit } from '../models/index.js';
import { whatsappConfigured, whatsappMissing, verifyWebhookChallenge, verifyWhatsAppSignature, verifyWhatsAppCredentials, inspectWhatsAppToken, forgetWabaId } from '../services/whatsapp.js';
import { getWhatsAppLabelSyncStatus, processWhatsAppWebhookPayload, runWhatsAppLabelReconciliation } from '../services/whatsappLeadSync.js';
import { stripeConfigured, stripeWebhookConfigured, verifyStripeKey, stripePublishableKey, stripeEmbeddedConfigured } from '../services/stripe.js';
import { updateEnvFile } from '../utils/env.js';
import { metaAdsConfigured, verifyMetaAds } from '../services/metaAds.js';
import { twilioConfigured, verifyTwilio, toE164 } from '../services/twilio.js';
import { openaiConfigured, openaiOwnModel, openaiKeyPresent, openaiKeyHint, verifyOpenAIKey, parseAvailabilityQuery, aiProvider, chosenProvider, PROVIDERS } from '../services/openai.js';
import { claudeConfigured, claudeModel, claudeKeyHint, claudeEffort, verifyClaudeKey, CLAUDE_EFFORTS } from '../services/claude.js';
import { analyticsConfigured, analyticsMissing } from '../services/googleAnalytics.js';

const router = Router();

router.get('/status', async (_req, res) => {
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
        analytics: {
            configured: analyticsConfigured(),
            propertyId: process.env.GA4_PROPERTY_ID || '',
            missing: analyticsMissing(),
            method: analyticsConfigured() ? (process.env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_FILE ? 'service_account' : 'oauth') : '',
        },
        // The key itself is never sent to the client — only a masked hint.
        openai: { configured: openaiKeyPresent(), model: openaiOwnModel(), keyHint: openaiKeyHint() },
        anthropic: { configured: claudeConfigured(), model: claudeModel(), effort: claudeEffort(), keyHint: claudeKeyHint() },
        // `chosen` is the switch; `active` is who actually answers (the other
        // provider steps in when the chosen one has no key).
        ai: { chosen: chosenProvider(), active: aiProvider(), configured: openaiConfigured() },
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
        // Read-only ad spend for the Meta ads review; the token never leaves the server.
        twilio: { configured: twilioConfigured(), from: process.env.TWILIO_FROM || '' },
        metaAds: { configured: metaAdsConfigured(), accountId: process.env.META_ADS_ACCOUNT_ID || '', accountName: process.env.META_ADS_ACCOUNT_NAME || '' },
        whatsappLabelSync: getWhatsAppLabelSyncStatus(),
        /* The publishable key is returned in full on purpose — it is designed
         * to be public and the tenant renewal page needs it to render Stripe's
         * own card form. The secret key never appears here. */
        stripe: {
            configured: stripeConfigured(),
            webhookConfigured: stripeWebhookConfigured(),
            publishableKey: stripePublishableKey(),
            embeddedConfigured: stripeEmbeddedConfigured(),
        },
    });
});

// Save (and validate) Stripe credentials. Admin only — these are payment keys.
// secretKey is optional on repeat calls — e.g. adding just the webhook secret
// after the fact doesn't need to re-send (and re-validate) the secret key.
router.post('/stripe/connect', requireAdmin, async (req, res) => {
    const { secretKey, webhookSecret, publishableKey } = req.body || {};
    if (!secretKey && !webhookSecret && !publishableKey) {
        return res.status(400).json({ error: 'Nothing to save' });
    }
    const updates = {};
    if (publishableKey) {
        /* Only a shape check. Unlike the secret key there is no call that can
         * verify a publishable key on its own, and rejecting a valid one over a
         * failed guess would be worse than storing a typo the card form then
         * reports plainly. */
        if (!/^pk_(test|live)_/.test(publishableKey)) {
            return res.status(400).json({ error: 'That doesn\'t look like a Stripe publishable key (should start with pk_test_ or pk_live_)' });
        }
        updates.STRIPE_PUBLISHABLE_KEY = publishableKey;
    }
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
    res.json({
        ok: true,
        configured: stripeConfigured(),
        webhookConfigured: stripeWebhookConfigured(),
        embeddedConfigured: stripeEmbeddedConfigured(),
    });
});

// Clears the stored Stripe keys.
// Meta's ad account, read-only (services/metaAds.js). Checked with Meta before it is kept.
router.post('/meta-ads/connect', requireAdmin, async (req, res) => {
    const { accountId, token } = req.body || {};
    if (!accountId || !token) return res.status(400).json({ error: 'Both the ad account ID and the access token are needed' });
    try {
        const acct = await verifyMetaAds(accountId, String(token).trim());
        const updates = { META_ADS_ACCOUNT_ID: acct.id, META_ADS_TOKEN: String(token).trim(), META_ADS_ACCOUNT_NAME: acct.name };
        updateEnvFile(updates);
        Object.assign(process.env, updates);
        res.json({ ok: true, configured: true, accountId: acct.id, accountName: acct.name, currency: acct.currency });
    } catch (e) {
        res.status(400).json({ error: `Meta did not accept these: ${e.message}` });
    }
});

router.post('/meta-ads/disconnect', requireAdmin, async (_req, res) => {
    const updates = { META_ADS_ACCOUNT_ID: '', META_ADS_TOKEN: '', META_ADS_ACCOUNT_NAME: '' };
    updateEnvFile(updates);
    Object.assign(process.env, updates);
    res.json({ ok: true, configured: false });
});

// Twilio for SMS, connected once. Checked with Twilio before it is kept.
router.post('/twilio/connect', requireAdmin, async (req, res) => {
    const { accountSid, authToken, from } = req.body || {};
    if (!accountSid || !authToken || !from) return res.status(400).json({ error: 'The account SID, auth token and the sending number are all needed' });
    if (!/^AC[0-9a-f]{32}$/i.test(String(accountSid).trim())) return res.status(400).json({ error: 'The account SID starts with AC and is 34 characters long' });
    const sender = /^[A-Za-z][A-Za-z0-9 ]{1,10}$/.test(String(from).trim()) ? String(from).trim() : toE164(from);
    if (!sender) return res.status(400).json({ error: 'The sending number should look like +971…, or be a sender name of up to 11 letters' });
    try {
        const acct = await verifyTwilio(String(accountSid).trim(), String(authToken).trim());
        const updates = { TWILIO_ACCOUNT_SID: String(accountSid).trim(), TWILIO_AUTH_TOKEN: String(authToken).trim(), TWILIO_FROM: sender };
        updateEnvFile(updates);
        Object.assign(process.env, updates);
        res.json({ ok: true, configured: true, accountName: acct.name, from: sender });
    } catch (e) {
        res.status(400).json({ error: `Twilio did not accept these: ${e.message}` });
    }
});

router.post('/twilio/disconnect', requireAdmin, async (_req, res) => {
    const updates = { TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_FROM: '' };
    updateEnvFile(updates);
    Object.assign(process.env, updates);
    res.json({ ok: true, configured: false });
});

router.post('/stripe/disconnect', requireAdmin, async (_req, res) => {
    updateEnvFile({ STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', STRIPE_PUBLISHABLE_KEY: '' });
    process.env.STRIPE_SECRET_KEY = '';
    process.env.STRIPE_WEBHOOK_SECRET = '';
    process.env.STRIPE_PUBLISHABLE_KEY = '';
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
    const effectiveModel = model || openaiOwnModel();

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

    res.json({ ok: true, configured: true, model: openaiOwnModel(), keyHint: openaiKeyHint() });
});

router.post('/openai/disconnect', requireAdmin, async (_req, res) => {
    const blanks = { OPENAI_API_KEY: '' };
    updateEnvFile(blanks);
    Object.assign(process.env, blanks);
    res.json({ ok: true });
});

// Save or rotate the Claude (Anthropic) key, model and effort. Validated
// before anything is written, like the OpenAI key above.
router.post('/anthropic/connect', requireAdmin, async (req, res) => {
    const apiKey = String(req.body?.apiKey || '').trim();
    const model = String(req.body?.model || '').trim();
    const effort = String(req.body?.effort || '').trim().toLowerCase();
    if (!apiKey && !model && !effort) return res.status(400).json({ error: 'Nothing to save' });
    if (model && !/^claude-[a-z0-9.-]+$/.test(model)) return res.status(400).json({ error: 'That is not a Claude model id' });
    if (effort && !CLAUDE_EFFORTS.includes(effort)) return res.status(400).json({ error: `Effort must be one of ${CLAUDE_EFFORTS.join(', ')}` });

    const effectiveKey = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!effectiveKey) return res.status(400).json({ error: 'An API key is required' });
    if (apiKey && !/^sk-ant-/.test(apiKey)) return res.status(400).json({ error: 'That doesn\'t look like an Anthropic key (should start with sk-ant-)' });
    const effectiveModel = model || claudeModel();

    if (apiKey || model) {
        try {
            await verifyClaudeKey(effectiveKey, effectiveModel);
        } catch (e) {
            return res.status(400).json({ error: e.message });
        }
    }

    const updates = {};
    if (apiKey) updates.ANTHROPIC_API_KEY = effectiveKey;
    if (model) updates.ANTHROPIC_MODEL = effectiveModel;
    if (effort) updates.ANTHROPIC_EFFORT = effort;
    // Adding a Claude key means moving to Claude: without this the provider
    // stayed on OpenAI (the default) and its dead key kept failing every reply.
    if (apiKey) updates.AI_PROVIDER = 'anthropic';
    updateEnvFile(updates);
    Object.assign(process.env, updates);

    res.json({ ok: true, configured: true, model: claudeModel(), effort: claudeEffort(), keyHint: claudeKeyHint(), active: aiProvider() });
});

router.post('/anthropic/disconnect', requireAdmin, async (_req, res) => {
    const blanks = { ANTHROPIC_API_KEY: '' };
    updateEnvFile(blanks);
    Object.assign(process.env, blanks);
    res.json({ ok: true });
});

// Switch which AI answers everywhere in the app. Takes effect on the next call.
router.post('/ai/provider', requireAdmin, async (req, res) => {
    const provider = String(req.body?.provider || '').trim();
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: `Provider must be one of ${PROVIDERS.join(', ')}` });
    const ready = provider === 'anthropic' ? claudeConfigured() : openaiKeyPresent();
    if (!ready) return res.status(400).json({ error: `Save the ${provider === 'anthropic' ? 'Claude' : 'OpenAI'} key first` });
    updateEnvFile({ AI_PROVIDER: provider });
    process.env.AI_PROVIDER = provider;
    res.json({ ok: true, chosen: chosenProvider(), active: aiProvider() });
});

// Turn a phrase into availability filters. Any signed-in user may call this —
// it reads nothing and writes nothing, it only interprets text.
router.post('/ai/parse-availability', async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Nothing to interpret' });
    if (!openaiConfigured()) return res.status(501).json({ error: 'No AI provider is configured' });

    const floors = Array.isArray(req.body?.floors) ? req.body.floors.map(String) : [];
    const sizes = Array.isArray(req.body?.sizes) ? req.body.sizes.map(Number).filter(Number.isFinite) : [];

    try {
        const result = await parseAvailabilityQuery(text, { floors, sizes });
        res.json(result);
    } catch (e) {
        const msg = e.response?.data?.error?.message || e.message;
        res.status(502).json({ error: `Could not reach ${aiProvider() === 'anthropic' ? 'Claude' : 'OpenAI'}: ${msg}` });
    }
});

router.post('/whatsapp/connect', requireAdmin, async (req, res) => {
    const { phoneNumberId, accessToken, verifyToken, appSecret, wabaId } = req.body || {};
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
    if (wabaId) {
        // Digits only, like the phone number id, and confused with it just as
        // often — so the shape is checked rather than left to fail later on a
        // call nobody makes until they open the templates panel.
        const raw = String(wabaId).trim();
        if (!/^\d+$/.test(raw)) {
            return res.status(400).json({ error: 'The WhatsApp Business Account ID should be digits only. It is shown in Meta → WhatsApp → API Setup, above the phone number.' });
        }
        updates.WHATSAPP_WABA_ID = raw;
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
    // A different number may belong to a different business account.
    forgetWabaId();
    res.json({
        ok: true,
        configured: whatsappConfigured(),
        missing: whatsappMissing(),
        displayPhoneNumber: profile.displayPhoneNumber,
        verifiedName: profile.verifiedName,
    });
});

// Whether the WhatsApp token still works, and when it stops. Separate from
// /status so a Graph call never slows the pages that only need to know which
// integrations are switched on.
router.get('/whatsapp/token', requireAdmin, async (req, res) => {
    res.json(await inspectWhatsAppToken({ force: req.query.refresh === 'true' }));
});

router.post('/whatsapp/disconnect', requireAdmin, async (_req, res) => {
    const blanks = {
        WHATSAPP_PHONE_NUMBER_ID: '',
        WHATSAPP_ACCESS_TOKEN: '',
        WHATSAPP_VERIFY_TOKEN: '',
        WHATSAPP_APP_SECRET: '',
        WHATSAPP_WABA_ID: '',
    };
    updateEnvFile(blanks);
    Object.assign(process.env, blanks);
    forgetWabaId();
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

router.get('/gmail/connect', (req, res) => {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CONTACTS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        return res.status(400).json({ error: 'Google OAuth credentials not configured.' });
    }
    const url = gmailOAuthClient().generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        // Send, and read the inbox — the executive assistant agent sorts
        // it each morning. An older connection granted send only; the
        // read helpers say so plainly and point here.
        scope: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'],
        // Where to come back to: the Bots page when connected from there.
        state: req.query.from === 'bots' ? 'bots' : 'settings',
    });
    res.json({ url });
});

router.get('/gmail/callback', async (req, res) => {
    const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
    const back = req.query.state === 'bots' ? 'bots' : 'settings';
    if (req.query.error) {
        return res.redirect(`${clientOrigin}/${back}?gmailError=${encodeURIComponent(req.query.error)}`);
    }
    try {
        const oauth2 = gmailOAuthClient();
        const { tokens } = await oauth2.getToken(String(req.query.code || ''));
        if (!tokens.refresh_token) {
            return res.redirect(`${clientOrigin}/${back}?gmailError=${encodeURIComponent('No refresh token returned. Revoke access at myaccount.google.com and try again.')}`);
        }
        updateEnvFile({ GOOGLE_GMAIL_REFRESH_TOKEN: tokens.refresh_token });
        process.env.GOOGLE_GMAIL_REFRESH_TOKEN = tokens.refresh_token;
        /* Google lets the person untick reading on its consent screen. Sending
           still works then, but bots cannot read the inbox — say so now. */
        if (tokens.scope && !/gmail\.readonly|gmail\.modify/.test(tokens.scope)) {
            return res.redirect(`${clientOrigin}/${back}?gmailError=${encodeURIComponent('Connected for sending only: reading the inbox was not allowed on Google\'s screen. Reconnect and tick "Read your email" so bots can read it.')}`);
        }
        res.redirect(`${clientOrigin}/${back}?gmailConnected=1`);
    } catch (err) {
        const msg = err?.message || 'Unknown error';
        res.redirect(`${clientOrigin}/${back}?gmailError=${encodeURIComponent(msg)}`);
    }
});

// ── Google Analytics (GA4 Data API) OAuth ───────────────────────────────────
//
// Reuses the same OAuth client Drive/Contacts already use — Google doesn't
// scope-lock a client, so this just asks for one more permission under it.
// The Google account the person signs in with here still needs Viewer
// access added directly on the GA4 property (Admin > Property Access
// Management) — being able to log in as that account and being allowed to
// read that specific property are two separate grants; this flow only
// covers the first.

function analyticsOAuthClient() {
    const clientId = process.env.GOOGLE_ANALYTICS_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CONTACTS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ANALYTICS_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
    const callbackUrl = `${process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5010}`}/api/integrations/analytics/callback`;
    return new google.auth.OAuth2(clientId, clientSecret, callbackUrl);
}

router.get('/analytics/connect', (_req, res) => {
    const clientId = process.env.GOOGLE_ANALYTICS_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CONTACTS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_ANALYTICS_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        return res.status(400).json({ error: 'Google OAuth credentials not configured. Connect Google Drive first, or set GOOGLE_ANALYTICS_CLIENT_ID/SECRET.' });
    }
    if (!process.env.GA4_PROPERTY_ID) {
        return res.status(400).json({ error: 'Set GA4_PROPERTY_ID in .env first — the GA4 property to read, from Analytics Admin > Property details.' });
    }
    const url = analyticsOAuthClient().generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/analytics.readonly'],
    });
    res.json({ url });
});

router.get('/analytics/callback', async (req, res) => {
    const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
    if (req.query.error) {
        return res.redirect(`${clientOrigin}/settings?analyticsError=${encodeURIComponent(req.query.error)}`);
    }
    try {
        const oauth2 = analyticsOAuthClient();
        const { tokens } = await oauth2.getToken(String(req.query.code || ''));
        if (!tokens.refresh_token) {
            return res.redirect(`${clientOrigin}/settings?analyticsError=${encodeURIComponent('No refresh token returned. Revoke access at myaccount.google.com and try again.')}`);
        }
        updateEnvFile({ GOOGLE_ANALYTICS_REFRESH_TOKEN: tokens.refresh_token });
        process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN = tokens.refresh_token;
        res.redirect(`${clientOrigin}/settings?analyticsConnected=1`);
    } catch (err) {
        const msg = err?.message || 'Unknown error';
        res.redirect(`${clientOrigin}/settings?analyticsError=${encodeURIComponent(msg)}`);
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


export default router;
