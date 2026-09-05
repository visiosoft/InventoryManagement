import crypto from 'crypto';

export function whatsappConfigured() {
    return Boolean(
        process.env.WHATSAPP_PHONE_NUMBER_ID &&
        process.env.WHATSAPP_ACCESS_TOKEN &&
        process.env.WHATSAPP_VERIFY_TOKEN &&
        process.env.WHATSAPP_APP_SECRET
    );
}

export function whatsappSendConfigured() {
    return Boolean(
        process.env.WHATSAPP_PHONE_NUMBER_ID &&
        process.env.WHATSAPP_ACCESS_TOKEN
    );
}

export function whatsappSendMissing() {
    const missing = [];
    if (!process.env.WHATSAPP_PHONE_NUMBER_ID) missing.push('WHATSAPP_PHONE_NUMBER_ID');
    if (!process.env.WHATSAPP_ACCESS_TOKEN) missing.push('WHATSAPP_ACCESS_TOKEN');
    return missing;
}

export function whatsappMissing() {
    const missing = [];
    if (!process.env.WHATSAPP_PHONE_NUMBER_ID) missing.push('WHATSAPP_PHONE_NUMBER_ID');
    if (!process.env.WHATSAPP_ACCESS_TOKEN) missing.push('WHATSAPP_ACCESS_TOKEN');
    if (!process.env.WHATSAPP_VERIFY_TOKEN) missing.push('WHATSAPP_VERIFY_TOKEN');
    if (!process.env.WHATSAPP_APP_SECRET) missing.push('WHATSAPP_APP_SECRET');
    return missing;
}

export function verifyWebhookChallenge(query) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (mode !== 'subscribe') return { ok: false, status: 400, message: 'Invalid mode' };
    if (token !== process.env.WHATSAPP_VERIFY_TOKEN) return { ok: false, status: 403, message: 'Forbidden' };
    return { ok: true, challenge: String(challenge || '') };
}

export function verifyWhatsAppSignature(signatureHeader, rawBodyBuffer) {
    if (!process.env.WHATSAPP_APP_SECRET) return false;
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
    const incoming = signatureHeader.slice('sha256='.length);
    const expected = crypto
        .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
        .update(rawBodyBuffer)
        .digest('hex');

    try {
        return crypto.timingSafeEqual(Buffer.from(incoming, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
        return false;
    }
}

function normalizeRecipientPhone(input) {
    return String(input || '').replace(/\D/g, '');
}

// Confirms a phone number ID + access token pair actually works before we
// save it, and returns the business name so the UI can show which number
// is connected. Throws with Meta's own message so the user sees the real
// reason (expired token, wrong ID, missing permission) rather than a generic
// failure.
// Meta's answer about our own token, cached — it changes daily at most and
// the Settings page asks for it on every render.
let tokenCache = { at: 0, data: null };

/**
 * What kind of access token is configured and when it dies.
 *
 * Worth surfacing because the two token types behave very differently: the one
 * on Meta's API Setup page is temporary and expires within 24 hours, while a
 * System User token can be set never to expire. Without this the difference
 * only shows up as sending mysteriously stopping.
 */
export async function inspectWhatsAppToken({ force = false } = {}) {
    const token = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
    if (!token) return { configured: false };
    if (!force && tokenCache.data && Date.now() - tokenCache.at < 10 * 60 * 1000) return tokenCache.data;

    let data;
    try {
        const r = await fetch(
            `https://graph.facebook.com/v20.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
        );
        const body = await r.json().catch(() => ({}));
        const d = body?.data;
        if (!r.ok || !d) {
            data = { configured: true, valid: false, error: body?.error?.message || `HTTP ${r.status}` };
        } else {
            // Meta reports a token that never expires as 0, not as absent.
            const expiresAt = d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null;
            data = {
                configured: true,
                valid: Boolean(d.is_valid),
                type: d.type || '',
                appName: d.application || '',
                neverExpires: d.expires_at === 0,
                expiresAt,
                expiresInHours: expiresAt ? Math.round((new Date(expiresAt) - Date.now()) / 3600_000) : null,
                error: d.is_valid ? '' : (d.error?.message || 'The token is no longer valid'),
            };
        }
    } catch (e) {
        data = { configured: true, valid: null, error: `Could not reach Meta: ${e.message}` };
    }

    tokenCache = { at: Date.now(), data };
    return data;
}

export async function verifyWhatsAppCredentials({ phoneNumberId, accessToken }) {
    const endpoint = `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`;
    const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
    }
    return {
        displayPhoneNumber: payload.display_phone_number || '',
        verifiedName: payload.verified_name || '',
    };
}

// Outbound media is two calls: upload the bytes to get an id, then send a
// message referencing that id. The id is reusable for 30 days but we do not
// cache it — the same file sent twice is rare, and a stale id fails silently.
export async function uploadWhatsAppMedia({ buffer, mimeType, filename }) {
    if (!whatsappSendConfigured()) throw new Error('WhatsApp is not configured');
    if (!buffer?.length) throw new Error('The file is empty');

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType || 'application/octet-stream');
    form.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), filename || 'file');

    const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
        body: form,
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok || !json?.id) throw new Error(json?.error?.message || `Upload failed (HTTP ${r.status})`);
    return json.id;
}

/** Which WhatsApp message type a file becomes. */
export function whatsappMediaKind(mimeType) {
    const m = String(mimeType || '').toLowerCase();
    if (m.startsWith('image/')) return m.includes('webp') ? 'sticker' : 'image';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    return 'document';
}

/**
 * Send a file, either by media id (something we uploaded) or by `link`.
 *
 * The link form has Meta fetch the file itself, which is what makes a canned
 * reply like the facility tour practical: the video is already served by the
 * app, so there is nothing to upload and no media id to keep alive — uploaded
 * ids expire after 30 days and would quietly stop working.
 *
 * The URL must be publicly reachable and within Meta's size limits: 16 MB for
 * video and audio, 5 MB for images, 100 MB for documents. Over that, Meta
 * rejects the message rather than truncating it.
 */
export async function sendWhatsAppMedia({ to, mediaId, link, kind, caption, filename }) {
    if (!whatsappSendConfigured()) throw new Error('WhatsApp is not configured');
    const normalizedTo = normalizeRecipientPhone(to);
    if (!normalizedTo) throw new Error('Recipient phone number is required');
    if (!mediaId && !link) throw new Error('Either an uploaded file or a link is required');

    // Only image, video and document accept a caption; audio and sticker do
    // not, and Meta rejects the whole message if one is sent.
    const node = mediaId ? { id: mediaId } : { link };
    if (caption && ['image', 'video', 'document'].includes(kind)) node.caption = caption;
    if (kind === 'document' && filename) node.filename = filename;

    const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: normalizedTo, type: kind, [kind]: node }),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json?.error?.message || `Send failed (HTTP ${r.status})`);
    return json;
}

/**
 * Send WhatsApp's native location pin.
 *
 * This is the point of it over a Google Maps link: tapping a Maps search
 * result drops the customer into a page that also lists every storage place
 * nearby, while a native location message opens the map app pinned on exactly
 * these coordinates and nothing else.
 */
export async function sendWhatsAppLocation({ to, latitude, longitude, name, address }) {
    if (!whatsappSendConfigured()) throw new Error('WhatsApp is not configured');
    const normalizedTo = normalizeRecipientPhone(to);
    if (!normalizedTo) throw new Error('Recipient phone number is required');
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('A valid latitude and longitude are required');

    const location = { latitude: lat, longitude: lng };
    if (name) location.name = String(name);
    if (address) location.address = String(address);

    const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: normalizedTo, type: 'location', location }),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json?.error?.message || `Send failed (HTTP ${r.status})`);
    return json;
}

/* Which Business Account this number belongs to.
 *
 * Templates are held against the account, not the number, so listing them
 * needs an id that nothing else in the system uses — which is why it was never
 * set here, and why the templates panel came up empty on an installation that
 * was otherwise working perfectly.
 *
 * Meta knows the answer already, so it is asked before anybody is sent looking
 * through Business Manager for it. The configured value still wins: an account
 * with more than one number is a thing, and a stated answer beats a derived
 * one. Cached for the life of the process — a number does not move between
 * business accounts.
 */
let derivedWabaId = '';

export async function resolveWabaId() {
    const set = String(process.env.WHATSAPP_WABA_ID || '').trim();
    if (set) return set;
    if (derivedWabaId) return derivedWabaId;

    const token = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
    const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
    if (!token || !phoneId) return '';

    try {
        const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneId)}?fields=whatsapp_business_account`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const body = await r.json().catch(() => ({}));
        // Not an error worth raising: the token may simply lack the permission
        // to read the account, and the caller has a clear message for that.
        if (!r.ok) return '';
        derivedWabaId = String(body?.whatsapp_business_account?.id || '').trim();
        return derivedWabaId;
    } catch {
        return '';
    }
}

/** After the credentials change, so a new number is not read off the old one. */
export function forgetWabaId() {
    derivedWabaId = '';
}

// Approved templates change rarely and the composer asks on every render.
let templateCache = { at: 0, data: null };

/**
 * The message templates Meta holds for this account.
 *
 * Marketing cannot go out as free-form text: WhatsApp only permits that inside
 * 24 hours of the person's last message to us. Anything else must be a template
 * Meta has approved in advance, so the composer can only offer what this returns
 * with status APPROVED.
 */
export async function listWhatsAppTemplates({ force = false } = {}) {
    const token = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
    if (!token) return { configured: false, error: 'WhatsApp is not configured', templates: [] };
    const waba = await resolveWabaId();
    if (!waba) {
        return {
            configured: false,
            templates: [],
            error: 'The WhatsApp Business Account ID is not set, and Meta would not say which account this number belongs to. Add it under Settings → Integrations → WhatsApp; it is the "WhatsApp Business Account ID" in Meta → WhatsApp → API Setup.',
        };
    }
    if (!force && templateCache.data && Date.now() - templateCache.at < 10 * 60 * 1000) return templateCache.data;

    const url = `https://graph.facebook.com/v20.0/${waba}/message_templates?limit=200`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
        return { configured: true, error: body?.error?.message || `HTTP ${r.status}`, templates: [] };
    }

    const templates = (body.data || []).map((t) => ({
        name: t.name,
        language: t.language,
        status: t.status,
        category: t.category,
        components: t.components || [],
        // {{1}}, {{2}} … in the body, which the campaign has to supply values for.
        variableCount: countTemplateVariables(t.components || []),
        bodyText: (t.components || []).find((c) => c.type === 'BODY')?.text || '',
    }));

    const data = { configured: true, error: '', templates };
    templateCache = { at: Date.now(), data };
    return data;
}

function countTemplateVariables(components) {
    const body = components.find((c) => c.type === 'BODY')?.text || '';
    const found = new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]));
    return found.size;
}

/**
 * Send one approved template.
 *
 * `variables` fill {{1}}, {{2}} … in order. Passing the wrong number of them is
 * rejected by Meta rather than silently truncated, so the caller checks first.
 */
export async function sendWhatsAppTemplate({ to, name, language = 'en', variables = [] }) {
    if (!whatsappSendConfigured()) throw new Error('WhatsApp is not configured');
    const normalizedTo = normalizeRecipientPhone(to);
    if (!normalizedTo) throw new Error('Recipient phone number is required');
    if (!name) throw new Error('A template name is required');

    const components = variables.length
        ? [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: String(v ?? '') })) }]
        : [];

    const endpoint = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: normalizedTo,
            type: 'template',
            template: { name, language: { code: language }, ...(components.length ? { components } : {}) },
        }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
        throw new Error(`WhatsApp template send failed: ${detail}`);
    }
    return payload;
}

/**
 * Send a text message.
 *
 * `replyTo` is the id of a message this one quotes. Meta calls it a contextual
 * reply, and it is the only way to attach a new message to an earlier one —
 * there is no edit or unsend for anything a business has already sent, so a
 * correction has to arrive as a reply to the message it corrects.
 */
export async function sendWhatsAppText({ to, body, replyTo }) {
    if (!whatsappSendConfigured()) {
        throw new Error('WhatsApp is not configured');
    }

    const normalizedTo = normalizeRecipientPhone(to);
    if (!normalizedTo) {
        throw new Error('Recipient phone number is required');
    }

    const endpoint = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: normalizedTo,
            type: 'text',
            text: { body: String(body || '').trim() },
            ...(replyTo ? { context: { message_id: String(replyTo) } } : {}),
        }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
        throw new Error(`WhatsApp send failed: ${detail}`);
    }

    return payload;
}
