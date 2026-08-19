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

export async function sendWhatsAppMedia({ to, mediaId, kind, caption, filename }) {
    if (!whatsappSendConfigured()) throw new Error('WhatsApp is not configured');
    const normalizedTo = normalizeRecipientPhone(to);
    if (!normalizedTo) throw new Error('Recipient phone number is required');

    // Only image, video and document accept a caption; audio and sticker do
    // not, and Meta rejects the whole message if one is sent.
    const node = { id: mediaId };
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

export async function sendWhatsAppText({ to, body }) {
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
        }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
        throw new Error(`WhatsApp send failed: ${detail}`);
    }

    return payload;
}
