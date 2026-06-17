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
