/**
 * The endpoint behind a WhatsApp Flow.
 *
 * Meta does not call this like an ordinary API. Every request arrives with an
 * AES key encrypted under our RSA public key, and a body encrypted under that
 * AES key; the reply must be encrypted with the same AES key and the initial
 * vector bit-flipped, returned as a bare base64 string. Get any of that wrong
 * and the customer sees "something went wrong" with nothing in our logs, so
 * the crypto is kept here on its own and the business logic stays pure.
 *
 * Set up needs a keypair:
 *   openssl genrsa -des3 -out private.pem 2048
 *   openssl rsa -in private.pem -outform PEM -pubout -out public.pem
 * The public key goes to Meta (Flows → Endpoint → Sign public key). The private
 * key and its passphrase go in WHATSAPP_FLOW_PRIVATE_KEY and
 * WHATSAPP_FLOW_KEY_PASSPHRASE.
 */

import crypto from 'node:crypto';

const TAG_LENGTH = 16;

export function flowKeysConfigured() {
  return Boolean(process.env.WHATSAPP_FLOW_PRIVATE_KEY);
}

function privateKey() {
  // Newlines survive a .env round trip as the two characters \n, so they are
  // put back before the key is parsed.
  const pem = String(process.env.WHATSAPP_FLOW_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const passphrase = process.env.WHATSAPP_FLOW_KEY_PASSPHRASE || '';
  return crypto.createPrivateKey(passphrase ? { key: pem, passphrase } : { key: pem });
}

/** AES-128 and AES-256 are both allowed; the key length says which. */
const cipherFor = (key) => (key.length === 32 ? 'aes-256-gcm' : 'aes-128-gcm');

/**
 * @returns {{ body: object, aesKey: Buffer, iv: Buffer }}
 * @throws when the payload cannot be decrypted — the caller must answer 421 so
 *         Meta refreshes the session rather than retrying against a bad key.
 */
export function decryptRequest({ encrypted_flow_data, encrypted_aes_key, initial_vector }) {
  const aesKey = crypto.privateDecrypt(
    { key: privateKey(), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(encrypted_aes_key, 'base64'),
  );

  const flowData = Buffer.from(encrypted_flow_data, 'base64');
  const iv = Buffer.from(initial_vector, 'base64');

  const decipher = crypto.createDecipheriv(cipherFor(aesKey), aesKey, iv);
  decipher.setAuthTag(flowData.subarray(-TAG_LENGTH));
  const plain = Buffer.concat([
    decipher.update(flowData.subarray(0, -TAG_LENGTH)),
    decipher.final(),
  ]).toString('utf-8');

  return { body: JSON.parse(plain), aesKey, iv };
}

/**
 * Encrypt a reply with the same key and the initial vector inverted.
 *
 * The inversion is not decoration — reusing an IV with the same key under GCM
 * is what breaks the cipher, and Meta specifies the flip so both sides derive
 * the second IV without another exchange.
 */
export function encryptResponse(response, aesKey, iv) {
  const flipped = Buffer.from(iv.map((b) => ~b & 0xff));
  const cipher = crypto.createCipheriv(cipherFor(aesKey), aesKey, flipped);
  return Buffer.concat([
    cipher.update(JSON.stringify(response), 'utf-8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
}

/* ── Pure: what the flow sends us, and what we show back ─────────────────── */

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * A phone number as we store it.
 *
 * Kept permissive on shape — people type UAE numbers as 050…, +971 50…, 00971…
 * — but a string with too few digits to be a number at all is refused rather
 * than saved as a contact nobody can ring.
 */
export function normalisePhone(raw) {
  const digits = clean(raw).replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  // A local UAE number is stored in the same international form as the rest.
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0') && digits.length === 10) return `+971${digits.slice(1)}`;
  if (digits.startsWith('971')) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Validate what the form sent before any of it reaches a customer record.
 *
 * Returns the fields worth saving and a list of what was wrong, so the flow can
 * say so on the screen rather than silently storing a blank.
 */
export function readClientInfo(data = {}) {
  const fullName = clean(data.full_name);
  const authorizedPerson = clean(data.authorized_person);
  const emergencyContact = normalisePhone(data.emergency_contact);

  const problems = [];
  if (fullName.length < 2) problems.push('a full name');
  if (!emergencyContact) problems.push('a usable emergency contact number');

  // PhotoPicker sends an array of media descriptors, not the image itself.
  const photos = Array.isArray(data.id_photo) ? data.id_photo : [];

  return {
    fields: { fullName, authorizedPerson, emergencyContact },
    photos,
    problems,
    ok: problems.length === 0,
  };
}

/** The text the confirmation screen reads back. */
export function buildSummaryText({ fullName, authorizedPerson, emergencyContact }, photoCount = 0) {
  return [
    `Name: ${fullName}`,
    `Authorized Person: ${authorizedPerson || '—'}`,
    `ID Document: ${photoCount > 0 ? `${photoCount} uploaded` : 'Not uploaded'}`,
    `Emergency Contact: ${emergencyContact}`,
  ].join('\n');
}

/* ── Flow tokens ─────────────────────────────────────────────────────────────
   A data_exchange request carries a flow_token and nothing else identifying
   the person — the sender's number is not in the payload. So the token we mint
   when sending the flow carries the number, signed, and this reads it back. */

const SECRET = () => process.env.JWT_SECRET || 'purplebox-flow';

export function flowToken(phoneNormalized) {
  const phone = String(phoneNormalized || '').replace(/\D/g, '');
  const sig = crypto.createHmac('sha256', SECRET()).update(`flow:${phone}`).digest('hex').slice(0, 16);
  return `${phone}.${sig}`;
}

/** The number a token was minted for, or '' if it was not minted by us. */
export function phoneFromFlowToken(token) {
  const [phone, sig] = String(token || '').split('.');
  if (!phone || !sig) return '';
  const expected = flowToken(phone).split('.')[1];
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return '';
  return phone;
}
