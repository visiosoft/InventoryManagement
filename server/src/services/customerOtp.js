import crypto from 'node:crypto';
import { CustomerOtp } from '../models/index.js';
import { sendWhatsAppTemplate, whatsappSendConfigured } from './whatsapp.js';
import { mailConfigured, sendMail } from './mail.js';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const fail = (status, message) => Object.assign(new Error(message), { status });

const generateOtp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

const hashOtp = (key, code) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${key}:${code}`).digest('hex');

// "+971 50 123 4567", "0501234567" and "971501234567" are one person. Stored
// customers have whatever was typed at the time, so lookups try each spelling.
// The country code can also arrive twice ("+971 +971 55…", typed over a
// prefilled +971) or with the trunk 0 kept ("+971 055…"); both are one number.
export function normalizePhone(input) {
  let d = String(input || '').trim().replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  while (d.startsWith('971971')) d = d.slice(3);
  if (d.startsWith('9710')) d = `971${d.slice(4)}`;
  if (d.startsWith('0') && d.length === 10) d = `971${d.slice(1)}`;
  if (d.startsWith('5') && d.length === 9) d = `971${d}`;
  return d;
}

export function phoneVariants(input) {
  const d = normalizePhone(input);
  const variants = new Set([String(input || '').trim(), d, `+${d}`]);
  if (d.startsWith('971')) variants.add(`0${d.slice(3)}`);
  return [...variants].filter(Boolean);
}

async function deliver(phone, code, email) {
  if (email) {
    if (mailConfigured()) {
      await sendMail({
        to: email,
        subject: `${code} is your PurpleBox code`,
        text: `Your PurpleBox verification code is ${code}. It expires in 5 minutes.

If you didn't ask for this, you can ignore this email.`,
        context: { kind: 'auth', label: 'App verification code' },
      });
      return {};
    }
    if (process.env.NODE_ENV === 'production') throw fail(503, 'Email codes are not available right now. Please contact support.');
    return { devCode: code };
  }
  const template = process.env.WHATSAPP_OTP_TEMPLATE;
  if (template && whatsappSendConfigured()) {
    await sendWhatsAppTemplate({
      to: phone, name: template, language: process.env.WHATSAPP_OTP_TEMPLATE_LANG || 'en',
      variables: [code], urlButtonText: code,
    });
    return {};
  }
  // No delivery channel. Handing the code back is only acceptable off
  // production; on production it would let anyone log in as any phone number.
  if (process.env.NODE_ENV === 'production') throw fail(503, 'Login codes are not available right now. Please contact support.');
  return { devCode: code };
}

/**
 * Create a code under `key` and send it to `phone` (WhatsApp) or, when given,
 * `email`. `key` is what the code is checked against later: the phone itself
 * for login, or a scoped string for other flows so two flows can't answer each
 * other's codes.
 */
export async function issueOtp({ key, phone, email }) {
  const existing = await CustomerOtp.findOne({ phone: key }).lean();
  if (existing && Date.now() - new Date(existing.updatedAt).getTime() < OTP_RESEND_MS) {
    throw fail(429, 'A code was just sent. Please wait a few seconds before requesting another.');
  }
  const code = generateOtp();
  await CustomerOtp.findOneAndUpdate(
    { phone: key },
    { codeHash: hashOtp(key, code), attempts: 0, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    { upsert: true },
  );
  return deliver(phone, code, email);
}

/** Throws unless `code` is the live code for `key`; a correct code is spent. */
export async function checkOtp({ key, code }) {
  const stored = await CustomerOtp.findOne({ phone: key });
  if (!stored || stored.expiresAt.getTime() < Date.now()) throw fail(401, 'Code expired — request a new one');
  if (stored.attempts >= OTP_MAX_ATTEMPTS) {
    await stored.deleteOne();
    throw fail(429, 'Too many wrong attempts — request a new code');
  }
  const expected = Buffer.from(stored.codeHash);
  const given = Buffer.from(hashOtp(key, String(code || '').trim()));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    stored.attempts += 1;
    await stored.save();
    throw fail(401, 'Invalid code');
  }
  await stored.deleteOne();
}
