import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM for merchant credentials stored at rest (Merchant.adminApiAccessToken*,
// webhookSecret* in models/shopify.js). node:crypto only — no new dependency.
// A DB-stored Shopify token, unlike a .env value, is reachable by anything
// that can read the database (a backup leak, a misconfigured replica), so it
// is worth the extra field-per-secret rather than storing plaintext.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended for GCM

function getKey() {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) throw new Error('CREDENTIALS_ENCRYPTION_KEY is not set');
  // Accept hex (64 chars) or base64 — `openssl rand -hex 32` is the
  // documented way to generate this in .env.example.
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

/** Encrypts a plaintext string. Returns the three fields a schema stores it as. */
export function encrypt(plaintext) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/** Inverse of encrypt(). Throws if the auth tag doesn't match — a sign the
 *  ciphertext or key is wrong, not something to silently paper over. */
export function decrypt(ciphertext, iv, tag) {
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}
