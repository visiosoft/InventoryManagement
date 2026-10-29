import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

/**
 * Secrets at rest and sessions.
 *
 * AI keys, connector tokens and WhatsApp app secrets are stored encrypted
 * (AES-256-GCM) under TRAINER_SECRET, and only ever shown back as a hint.
 * API keys and invite tokens are stored as SHA-256 hashes and shown once.
 */

const secret = () => {
   const s = process.env.TRAINER_SECRET;
   if (!s || s.length < 16) throw new Error('TRAINER_SECRET is not set (16+ characters)');
   return s;
};
const key = () => crypto.createHash('sha256').update(`enc:${secret()}`).digest();

export function encrypt(plain) {
   if (!plain) return '';
   const iv = crypto.randomBytes(12);
   const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
   const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
   return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${body.toString('base64')}`;
}

export function decrypt(enc) {
   if (!enc) return '';
   const [v, iv, tag, body] = String(enc).split(':');
   if (v !== 'v1') return '';
   const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
   d.setAuthTag(Buffer.from(tag, 'base64'));
   return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
}

export const hint = (s) => (s ? `…${String(s).slice(-4)}` : '');
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

/** Constant-time comparison of two hex digests. */
export function sameHash(a, b) {
   const x = Buffer.from(String(a), 'hex'); const y = Buffer.from(String(b), 'hex');
   return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

const jwtSecret = () => crypto.createHash('sha256').update(`jwt:${secret()}`).digest('hex');
export const signSession = (userId) => jwt.sign({ uid: String(userId) }, jwtSecret(), { expiresIn: '14d' });
export function readSession(header) {
   const m = /^Bearer\s+(.+)$/.exec(String(header || ''));
   if (!m || m[1].startsWith('tq_')) return null;
   try { return jwt.verify(m[1], jwtSecret()).uid; } catch { return null; }
}

/** A password good enough to protect a business's conversations. Pure. */
export function passwordProblem(p) {
   const s = String(p || '');
   if (s.length < 10) return 'Use at least 10 characters';
   if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'Use letters and numbers';
   return '';
}
