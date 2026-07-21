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

function buildRawEmail({ from, to, subject, text, html, attachments }) {
    const boundary = '____boundary_' + Date.now().toString(36);
    const nl = '\r\n';

    let raw = '';
    raw += `From: ${from}${nl}`;
    raw += `To: ${to}${nl}`;
    raw += `Subject: ${subject}${nl}`;
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

export async function sendGmail({ to, subject, text, html, attachments }) {
    const auth = getOAuth2Client();
    if (!auth) throw new Error('Gmail API is not configured — connect Gmail in Settings');
    const gmail = google.gmail({ version: 'v1', auth });
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'PurpleBox <contact@purplebox.ae>';
    const raw = buildRawEmail({ from, to, subject, text, html, attachments });
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
}
