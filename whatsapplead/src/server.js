import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { connectDb } from '../../server/src/db.js';
import { closeWhatsAppScraperBrowser, getSharedBrowser, scrapeWhatsAppConversations } from './services/whatsappScraper.js';
import { listLeadMessages, listWhatsAppContacts, upsertConversationBatch } from './services/leadSync.js';

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

const API_KEY = String(process.env.WHATSAPP_LEAD_API_KEY || '').trim();

function parseAllowedLabels(input) {
    if (Array.isArray(input)) {
        return Array.from(new Set(input.map((x) => String(x || '').trim()).filter(Boolean)));
    }
    if (typeof input === 'string') {
        return Array.from(
            new Set(
                input
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean)
            )
        );
    }
    return [];
}

function parseBoolean(input, fallback = false) {
    if (typeof input === 'boolean') return input;
    if (typeof input === 'string') {
        const v = input.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(v)) return true;
        if (['false', '0', 'no', 'off'].includes(v)) return false;
    }
    if (typeof input === 'number') return input !== 0;
    return fallback;
}

function requireApiKey(req, res, next) {
    if (!API_KEY) return next();
    const provided = String(req.headers['x-api-key'] || '').trim();
    if (!provided || provided !== API_KEY) {
        return res.status(401).json({ error: 'Invalid API key' });
    }
    return next();
}

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'whatsapplead' });
});

app.get('/api/contacts', async (req, res) => {
    const limit = Number(req.query.limit) || 200;
    const contacts = await listWhatsAppContacts(limit);
    res.json({
        ok: true,
        total: contacts.length,
        contacts,
    });
});

app.get('/api/contacts/:leadId/messages', async (req, res) => {
    const limit = Number(req.query.limit) || 50;
    const result = await listLeadMessages(req.params.leadId, limit);
    if (!result) return res.status(404).json({ error: 'Lead not found' });
    res.json({ ok: true, ...result });
});

// ── WhatsApp QR code & connection status ─────────────────────────────────────

let qrPageRef = null;

async function ensureWhatsAppPage() {
    const profileDir = process.env.WHATSAPP_PROFILE_DIR || '.wa-profile';
    const webUrl = process.env.WHATSAPP_WEB_URL || 'https://web.whatsapp.com';
    const browser = await getSharedBrowser({ headless: true, profileDir, webUrl });

    if (qrPageRef && !qrPageRef.isClosed()) {
        return qrPageRef;
    }

    const pages = await browser.pages();
    const existing = pages.find(p => p.url().includes('web.whatsapp.com'));
    if (existing && !existing.isClosed()) {
        qrPageRef = existing;
        return qrPageRef;
    }

    const page = await browser.newPage();
    await page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    qrPageRef = page;
    return page;
}

async function detectWhatsAppState(page) {
    return page.evaluate(() => {
        const qrCanvas = document.querySelector('canvas[aria-label="Scan this QR code to link a device!"]')
            || document.querySelector('div[data-ref] canvas')
            || document.querySelector('canvas');
        if (qrCanvas) return 'qr';

        const sidePanel = document.querySelector('#pane-side')
            || document.querySelector('[data-testid="chat-list"]')
            || document.querySelector('div[aria-label="Chat list"]');
        if (sidePanel) return 'connected';

        const loading = document.querySelector('[data-testid="intro-md-beta-logo-dark"]')
            || document.querySelector('.landing-wrapper')
            || document.querySelector('progress');
        if (loading) return 'loading';

        return 'unknown';
    });
}

app.get('/api/status', requireApiKey, async (_req, res) => {
    try {
        const page = await ensureWhatsAppPage();
        await new Promise(r => setTimeout(r, 1500));
        const state = await detectWhatsAppState(page);
        res.json({ ok: true, state });
    } catch (error) {
        res.status(500).json({ ok: false, state: 'error', error: error.message });
    }
});

app.get('/api/qr', requireApiKey, async (_req, res) => {
    try {
        const page = await ensureWhatsAppPage();

        // Wait a moment for QR to render
        await new Promise(r => setTimeout(r, 2000));

        const state = await detectWhatsAppState(page);
        if (state === 'connected') {
            return res.json({ ok: true, state: 'connected', message: 'Already connected to WhatsApp' });
        }

        const screenshot = await page.screenshot({ encoding: 'base64', type: 'png' });
        res.json({ ok: true, state, screenshot: `data:image/png;base64,${screenshot}` });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post('/api/disconnect', requireApiKey, async (_req, res) => {
    try {
        await closeWhatsAppScraperBrowser();
        qrPageRef = null;

        // Delete session profile to force re-auth
        const profileDir = path.resolve(process.cwd(), process.env.WHATSAPP_PROFILE_DIR || '.wa-profile');
        const fs = await import('fs');
        if (fs.existsSync(profileDir)) {
            fs.rmSync(profileDir, { recursive: true, force: true });
        }

        res.json({ ok: true, message: 'Disconnected and session cleared' });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post('/api/sync', requireApiKey, async (req, res) => {
    try {
        const maxChats = Number(req.body?.maxChats || process.env.WHATSAPP_MAX_CHATS || 15);
        const messagesPerChat = Number(req.body?.messagesPerChat || process.env.WHATSAPP_MESSAGES_PER_CHAT || 10);
        const maxStoreMessages = Number(req.body?.maxStoreMessages || process.env.WHATSAPP_MAX_STORE_MESSAGES || 10);

        const allowedLabels = parseAllowedLabels(req.body?.allowedLabels || process.env.WHATSAPP_ALLOWED_LABELS || '');
        const syncOnlyAllowedLabels = parseBoolean(
            req.body?.syncOnlyAllowedLabels,
            parseBoolean(process.env.WHATSAPP_SYNC_ONLY_ALLOWED_LABELS || 'false', false)
        );

        if (syncOnlyAllowedLabels && allowedLabels.length === 0) {
            return res.status(400).json({
                error: 'Sync-only label mode is enabled but no allowed labels are configured. Set labels in Settings and try again.',
            });
        }

        const scraped = await scrapeWhatsAppConversations({
            webUrl: process.env.WHATSAPP_WEB_URL || 'https://web.whatsapp.com',
            headless: String(process.env.WHATSAPP_HEADLESS || 'false').toLowerCase() === 'true',
            maxChats: Math.max(1, Math.min(maxChats, 200)),
            messagesPerChat: Math.max(1, Math.min(messagesPerChat, 20)),
            profileDir: process.env.WHATSAPP_PROFILE_DIR || '.wa-profile',
            allowedLabels,
            syncOnlyAllowedLabels,
        });

        const syncResult = await upsertConversationBatch(scraped, {
            defaultOwnerEmail: process.env.DEFAULT_LEAD_OWNER_EMAIL || '',
            maxStoreMessages,
            allowSyntheticPhone: process.env.WHATSAPP_ALLOW_SYNTHETIC_PHONE,
            allowedLabels,
            syncOnlyAllowedLabels,
        });

        res.json({
            ok: true,
            scrapedCount: scraped.length,
            ...syncResult,
        });
    } catch (error) {
        console.error('[WhatsAppLead] Manual sync failed:', error.message);
        const msg = String(error?.message || 'Unknown sync error');
        const status = msg.includes('ERR_NAME_NOT_RESOLVED') ? 502 : 500;
        res.status(status).json({ error: msg });
    }
});

app.use(express.static(publicDir));
app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = Number(process.env.PORT || 5075);
const AUTO_SYNC_INTERVAL_MS = Number(process.env.WHATSAPP_SYNC_INTERVAL_MS || 0);

let syncInProgress = false;

async function runScheduledSync() {
    if (syncInProgress) {
        console.log('[WhatsAppLead] Skipping scheduled sync because a previous run is still in progress.');
        return;
    }

    syncInProgress = true;
    try {
        const allowedLabels = parseAllowedLabels(process.env.WHATSAPP_ALLOWED_LABELS || '');
        const syncOnlyAllowedLabels = parseBoolean(process.env.WHATSAPP_SYNC_ONLY_ALLOWED_LABELS || 'false', false);

        if (syncOnlyAllowedLabels && allowedLabels.length === 0) {
            console.log('[WhatsAppLead] Scheduled sync skipped: sync-only label mode enabled but no allowed labels configured.');
            return;
        }

        const scraped = await scrapeWhatsAppConversations({
            webUrl: process.env.WHATSAPP_WEB_URL || 'https://web.whatsapp.com',
            headless: String(process.env.WHATSAPP_HEADLESS || 'false').toLowerCase() === 'true',
            maxChats: Math.max(1, Math.min(Number(process.env.WHATSAPP_MAX_CHATS || 15), 200)),
            messagesPerChat: Math.max(1, Math.min(Number(process.env.WHATSAPP_MESSAGES_PER_CHAT || 10), 20)),
            profileDir: process.env.WHATSAPP_PROFILE_DIR || '.wa-profile',
            allowedLabels,
            syncOnlyAllowedLabels,
        });

        const syncResult = await upsertConversationBatch(scraped, {
            defaultOwnerEmail: process.env.DEFAULT_LEAD_OWNER_EMAIL || '',
            maxStoreMessages: Number(process.env.WHATSAPP_MAX_STORE_MESSAGES || 10),
            allowSyntheticPhone: process.env.WHATSAPP_ALLOW_SYNTHETIC_PHONE,
            allowedLabels,
            syncOnlyAllowedLabels,
        });

        console.log(
            `[WhatsAppLead] Scheduled sync complete. Scraped: ${scraped.length}, createdLeads: ${syncResult.createdLeads}, updatedLeads: ${syncResult.updatedLeads}, savedMessages: ${syncResult.savedMessages}`
        );
    } catch (error) {
        console.error('[WhatsAppLead] Scheduled sync failed:', error.message);
    } finally {
        syncInProgress = false;
    }
}

async function listenWithPortFallback(preferredPort, maxTries = 10) {
    for (let offset = 0; offset < maxTries; offset += 1) {
        const tryPort = preferredPort + offset;

        // eslint-disable-next-line no-await-in-loop
        const boundPort = await new Promise((resolve, reject) => {
            const server = app.listen(tryPort, () => {
                resolve(tryPort);
            });

            server.on('error', (error) => {
                if (error?.code === 'EADDRINUSE') {
                    resolve(null);
                    return;
                }
                reject(error);
            });
        });

        if (boundPort) {
            return boundPort;
        }
    }

    throw new Error(`No available port found from ${preferredPort} to ${preferredPort + maxTries - 1}`);
}

async function start() {
    await connectDb();
    const boundPort = await listenWithPortFallback(PORT);
    console.log(`WhatsAppLead server running on http://localhost:${boundPort}`);

    // Auto-sync WhatsApp every minute by default.
    if (AUTO_SYNC_INTERVAL_MS > 0) {
        setTimeout(runScheduledSync, 7000);
        setInterval(runScheduledSync, AUTO_SYNC_INTERVAL_MS);
        console.log(`[WhatsAppLead] Auto-sync enabled. Interval: ${AUTO_SYNC_INTERVAL_MS}ms`);
    } else {
        console.log('[WhatsAppLead] Auto-sync disabled (WHATSAPP_SYNC_INTERVAL_MS <= 0).');
    }
}

start().catch((err) => {
    console.error('Failed to start WhatsAppLead server:', err.message);
    process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
        await closeWhatsAppScraperBrowser();
        process.exit(0);
    });
}
