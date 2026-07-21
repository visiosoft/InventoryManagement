import nodemailer from 'nodemailer';
import { gmailConfigured, sendGmail } from './gmail.js';

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

export async function sendMail({ to, subject, text, html, attachments }) {
    if (gmailConfigured()) {
        return sendGmail({ to, subject, text, html, attachments });
    }
    if (!smtpConfigured()) {
        throw new Error('Email is not configured — connect Gmail in Settings');
    }
    const from = process.env.SMTP_FROM || `PurpleBox <${process.env.SMTP_USER}>`;
    return getTransporter().sendMail({ from, to, subject, text, html, attachments });
}
