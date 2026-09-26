import { google } from 'googleapis';

function getOAuth2Client() {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CONTACTS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_GMAIL_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) return null;
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    return oauth2;
}

export function gmailConfigured() {
    return Boolean(
        (process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CONTACTS_CLIENT_ID) &&
        (process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CONTACTS_CLIENT_SECRET) &&
        process.env.GOOGLE_GMAIL_REFRESH_TOKEN
    );
}

function mimeEncode(str) {
    return '=?UTF-8?B?' + Buffer.from(str, 'utf8').toString('base64') + '?=';
}

function buildRawEmail({ from, to, subject, text, html, attachments, cc, bcc }) {
    const boundary = '____boundary_' + Date.now().toString(36);
    const nl = '\r\n';

    let raw = '';
    raw += `From: ${from}${nl}`;
    raw += `To: ${to}${nl}`;
    // Cc is visible to every other recipient, unlike Bcc below.
    if (cc) raw += `Cc: ${cc}${nl}`;
    // Comma-separated list; Gmail strips this header before delivery so
    // recipients can't see each other.
    if (bcc) raw += `Bcc: ${bcc}${nl}`;
    raw += `Subject: ${mimeEncode(subject)}${nl}`;
    raw += `MIME-Version: 1.0${nl}`;

    if (attachments && attachments.length > 0) {
        raw += `Content-Type: multipart/mixed; boundary="${boundary}"${nl}${nl}`;

        // Body part
        raw += `--${boundary}${nl}`;
        if (html) {
            raw += `Content-Type: text/html; charset="UTF-8"${nl}${nl}`;
            raw += html + nl;
        } else {
            raw += `Content-Type: text/plain; charset="UTF-8"${nl}${nl}`;
            raw += text + nl;
        }

        // Attachments
        for (const att of attachments) {
            raw += `--${boundary}${nl}`;
            raw += `Content-Type: ${att.contentType || 'application/octet-stream'}; name="${att.filename}"${nl}`;
            raw += `Content-Disposition: attachment; filename="${att.filename}"${nl}`;
            raw += `Content-Transfer-Encoding: base64${nl}${nl}`;
            const buf = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
            raw += buf.toString('base64') + nl;
        }
        raw += `--${boundary}--${nl}`;
    } else {
        if (html) {
            raw += `Content-Type: text/html; charset="UTF-8"${nl}${nl}`;
            raw += html;
        } else {
            raw += `Content-Type: text/plain; charset="UTF-8"${nl}${nl}`;
            raw += text;
        }
    }

    return Buffer.from(raw).toString('base64url');
}

/* ---------- reading the inbox (the executive assistant's morning) ---------- */

const header = (msg, name) => (msg.payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

/** The text of a message: the text/plain part if there is one, else html stripped. */
function bodyOf(payload) {
    if (!payload) return '';
    const decode = (data) => Buffer.from(String(data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const walk = (p, want) => {
        if (!p) return '';
        if (p.mimeType === want && p.body?.data) return decode(p.body.data);
        for (const part of p.parts || []) { const t = walk(part, want); if (t) return t; }
        return '';
    };
    const plain = walk(payload, 'text/plain');
    if (plain) return plain;
    const html = walk(payload, 'text/html');
    return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Why a read failed, in words a person can act on. */
function explainReadError(e) {
    const msg = e?.message || String(e);
    if (/insufficient|403|scope|permission/i.test(msg)) {
        return new Error('Gmail is connected for sending only. Reconnect it in Settings → Integrations to allow reading the inbox.');
    }
    return e;
}

/**
 * Recent inbox messages, newest first — enough to sort them, not the full
 * text (read one with readGmailMessage when it matters). `hours` bounds the
 * window; unread only by default, since a morning desk sorts what is new.
 */
export async function listGmailInbox({ hours = 24, limit = 30, unreadOnly = true } = {}) {
    const auth = getOAuth2Client();
    if (!auth) throw new Error('Gmail is not connected');
    const gmail = google.gmail({ version: 'v1', auth });
    try {
        const q = `in:inbox newer_than:${Math.max(1, Math.ceil(hours / 24))}d${unreadOnly ? ' is:unread' : ''} -category:promotions -category:social`;
        const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: Math.min(50, limit) });
        const ids = list.data.messages || [];
        const out = [];
        for (const { id } of ids) {
            const m = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] });
            out.push({ id, threadId: m.data.threadId, from: header(m.data, 'From'), to: header(m.data, 'To'), subject: header(m.data, 'Subject'), date: header(m.data, 'Date'), snippet: m.data.snippet || '', unread: (m.data.labelIds || []).includes('UNREAD') });
        }
        return out;
    } catch (e) { throw explainReadError(e); }
}

export async function readGmailMessage(id) {
    const auth = getOAuth2Client();
    if (!auth) throw new Error('Gmail is not connected');
    const gmail = google.gmail({ version: 'v1', auth });
    try {
        const m = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
        return { id, threadId: m.data.threadId, from: header(m.data, 'From'), to: header(m.data, 'To'), subject: header(m.data, 'Subject'), date: header(m.data, 'Date'), messageId: header(m.data, 'Message-ID'), text: bodyOf(m.data.payload).slice(0, 6000) };
    } catch (e) { throw explainReadError(e); }
}

export async function sendGmail({ to, subject, text, html, attachments, cc, bcc }) {
    const auth = getOAuth2Client();
    if (!auth) throw new Error('Gmail API is not configured — connect Gmail in Settings');
    const gmail = google.gmail({ version: 'v1', auth });
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'PurpleBox <contact@purplebox.ae>';
    const raw = buildRawEmail({ from, to, subject, text, html, attachments, cc, bcc });
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
}
