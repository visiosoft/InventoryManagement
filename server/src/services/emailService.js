// Thin wrapper kept for the legacy reminder paths — delivery goes through
// mail.js, which prefers the connected Gmail account and falls back to SMTP.
import { sendMail, mailConfigured } from './mail.js';
import { brandedEmailHtml } from './emailLayout.js';

export function emailConfigured() {
  return mailConfigured();
}

export async function sendEmail({ to, subject, text }) {
  // The standard branded shell, same as every other template-driven email —
  // a caller here only ever has plain text, so there is never a designed
  // alternative to prefer.
  return sendMail({ to, subject, text, html: brandedEmailHtml({ bodyText: text }) });
}
