import nodemailer from 'nodemailer';

// Gmail / Google Workspace SMTP.
// Required env vars (server/.env):
//   SMTP_USER = contact@purplebox.ae
//   SMTP_PASS = <16-character Google App Password>
// Optional:
//   SMTP_HOST = smtp.gmail.com   SMTP_PORT = 465   SMTP_FROM = "PurpleBox <contact@purplebox.ae>"

let transporter = null;

export function mailConfigured() {
    return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
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
    if (!mailConfigured()) {
        throw new Error('SMTP is not configured — set SMTP_USER and SMTP_PASS in server/.env');
    }
    const from = process.env.SMTP_FROM || `PurpleBox <${process.env.SMTP_USER}>`;
    return getTransporter().sendMail({ from, to, subject, text, html, attachments });
}
