import nodemailer from 'nodemailer';
import { Resend } from 'resend';

function useResend() {
  return !!process.env.RESEND_API_KEY;
}

export function emailConfigured() {
  if (useResend()) return true;
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  );
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export async function sendEmail({ to, subject, text, html, attachments }) {
  if (!emailConfigured()) throw new Error('Email not configured');

  if (useResend()) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM || 'PurpleBox <onboarding@resend.dev>';
    const payload = { from, to: Array.isArray(to) ? to : [to], subject };
    if (html) payload.html = html;
    else if (text) payload.html = text.replace(/\n/g, '<br/>');
    if (attachments?.length) {
      payload.attachments = attachments.map(a => ({
        filename: a.filename,
        content: a.content,
      }));
    }
    const { error } = await resend.emails.send(payload);
    if (error) throw new Error(error.message);
    return;
  }

  const transporter = createTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text,
    html,
    attachments,
  });
}
