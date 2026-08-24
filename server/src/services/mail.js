import nodemailer from 'nodemailer';
import { gmailConfigured, sendGmail } from './gmail.js';
import { SentEmail } from '../models/index.js';

// SMTP fallback (only used if Gmail API is not configured)
let transporter = null;

function smtpConfigured() {
    return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function mailConfigured() {
    return gmailConfigured() || smtpConfigured();
}

function getTransporter() {
    if (!transporter) {
        const port = Number(process.env.SMTP_PORT || 465);
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port,
            secure: port === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }
    return transporter;
}

/** The address mail actually goes out as, for display and for BCC-only sends. */
export function mailFromAddress() {
    return process.env.SMTP_FROM
        || (process.env.SMTP_USER ? `PurpleBox <${process.env.SMTP_USER}>` : 'PurpleBox <contact@purplebox.ae>');
}

/**
 * Record what went out, or what failed trying.
 *
 * Written here rather than by each of the eleven callers, so nothing can be
 * sent without being logged — including the transactional mail that previously
 * left no trace anywhere. A logging failure must never turn a delivered email
 * into a reported failure, hence the silent catch.
 *
 * `context` is optional and additive: callers that pass it get a more useful
 * row, callers that do not are unaffected.
 */
async function record({ to, bcc, subject, attachments, context = {}, status, error }) {
    try {
        const recipients = bcc ? String(bcc).split(',').filter((x) => x.trim()).length : 1;
        await SentEmail.create({
            to: String(to || ''),
            bcc: String(bcc || ''),
            recipientCount: recipients,
            subject: String(subject || ''),
            status,
            error: error ? String(error).slice(0, 500) : '',
            hasAttachments: Boolean(attachments?.length),
            kind: context.kind || 'other',
            label: context.label || '',
            customer: context.customer || null,
            contract: context.contract || null,
            sentBy: context.sentBy || '',
        });
    } catch { /* the log is a record, not a gate */ }
}

export async function sendMail({ to, subject, text, html, attachments, bcc, context }) {
    if (!gmailConfigured() && !smtpConfigured()) {
        // Not logged: nothing was attempted, and a row here would read as a
        // delivery failure rather than a missing configuration.
        throw new Error('Email is not configured — connect Gmail in Settings');
    }

    try {
        const result = gmailConfigured()
            ? await sendGmail({ to, subject, text, html, attachments, bcc })
            : await getTransporter().sendMail({
                from: process.env.SMTP_FROM || `PurpleBox <${process.env.SMTP_USER}>`,
                to, subject, text, html, attachments, bcc,
            });
        await record({ to, bcc, subject, attachments, context, status: 'sent' });
        return result;
    } catch (err) {
        await record({ to, bcc, subject, attachments, context, status: 'failed', error: err?.message });
        throw err;
    }
}
