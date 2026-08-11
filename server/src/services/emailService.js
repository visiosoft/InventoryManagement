// Thin wrapper kept for the legacy reminder paths — delivery goes through
// mail.js, which prefers the connected Gmail account and falls back to SMTP.
import { sendMail, mailConfigured } from './mail.js';

export function emailConfigured() {
  return mailConfigured();
}

export async function sendEmail({ to, subject, text }) {
  return sendMail({ to, subject, text });
}
