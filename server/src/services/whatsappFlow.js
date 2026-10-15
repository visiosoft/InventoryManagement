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
import fs from 'node:fs';

const TAG_LENGTH = 16;

/**
 * The key itself, from a file or from the environment.
 *
 * A PEM is multi-line and a .env value is not, so pasting one inline means
 * flattening its newlines to the characters \n and hoping nothing along the way
 * mangles them. It usually does: dotenv silently keeps only the first line, and
 * the failure surfaces much later as "unsupported" from the decoder rather than
 * as anything about the file being truncated.
 *
 * So a path is the better answer and is preferred here, matching
 * GOOGLE_SERVICE_ACCOUNT_FILE elsewhere in this app. The inline form still
 * works for hosts where writing a file is awkward.
 */
function readPem() {
  const file = process.env.WHATSAPP_FLOW_PRIVATE_KEY_FILE;
  if (file) return normalizePem(fs.readFileSync(file, 'utf8'));
  return normalizePem(process.env.WHATSAPP_FLOW_PRIVATE_KEY || '');
}

/**
 * Rebuild a PEM whose line breaks were lost on the way into the environment.
 *
 * Hosting dashboards turn the newlines into spaces, into literal "\n", or
 * drop them; quotes and \r creep in. The decoder then fails with the
 * unhelpful "DECODER routines::unsupported". The content survives all of
 * that, so it is re-laid out here: the BEGIN/END lines, the Proc-Type and
 * DEK-Info headers of a passphrase-protected key, and the base64 body
 * wrapped at 64 columns. A whole PEM pasted as one base64 string is
 * accepted too.
 */
export function normalizePem(input) {
  let text = String(input || '').trim().replace(/^['"]|['"]$/g, '').replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '');
  if (!text.includes('-----BEGIN') && /^[A-Za-z0-9+/=\s]+$/.test(text)) {
    const decoded = Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8');
    if (decoded.includes('-----BEGIN')) text = decoded;
  }
  const m = text.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m) return text;
  const [, label, inner] = m;
  const headers = [];
  let body = inner;
  // Matched by shape, not up to the next space: with the line breaks dropped
  // outright, the DEK-Info IV runs straight into the base64 body. The IV is
  // 8 bytes for DES, 16 for AES — 16 or 32 hex characters.
  const proc = body.match(/Proc-Type:\s*(\d,ENCRYPTED)/);
  if (proc) { headers.push(`Proc-Type: ${proc[1]}`); body = body.replace(proc[0], ''); }
  const dek = body.match(/DEK-Info:\s*([A-Z0-9-]+),\s*/i);
  if (dek) {
    const ivLen = /^AES/i.test(dek[1]) ? 32 : 16;
    const iv = body.slice(dek.index + dek[0].length, dek.index + dek[0].length + ivLen);
    headers.push(`DEK-Info: ${dek[1]},${iv}`);
    body = body.slice(0, dek.index) + body.slice(dek.index + dek[0].length + ivLen);
  }
  const b64 = body.replace(/[^A-Za-z0-9+/=]/g, '');
  const lines = b64.match(/.{1,64}/g) || [];
  return [`-----BEGIN ${label}-----`, ...headers, ...(headers.length ? [''] : []), ...lines, `-----END ${label}-----`, ''].join('\n');
}

export function flowKeysConfigured() {
  return Boolean(process.env.WHATSAPP_FLOW_PRIVATE_KEY_FILE || process.env.WHATSAPP_FLOW_PRIVATE_KEY);
}

function privateKey() {
  const pem = readPem();
  // Caught early and named, rather than surfacing as a decoder error that
  // reads like a problem with the key rather than with how it was pasted.
  if (!pem.includes('PRIVATE KEY-----')) {
    throw new Error('The private key looks truncated — a PEM pasted into .env keeps only its first line. Use WHATSAPP_FLOW_PRIVATE_KEY_FILE instead.');
  }
  const encrypted = /ENCRYPTED/.test(pem);
  const passphrase = process.env.WHATSAPP_FLOW_KEY_PASSPHRASE || '';
  if (encrypted && !passphrase) {
    throw new Error('The private key is passphrase-protected but WHATSAPP_FLOW_KEY_PASSPHRASE is not set.');
  }
  try {
    return crypto.createPrivateKey(passphrase ? { key: pem, passphrase } : { key: pem });
  } catch (e) {
    if (encrypted && /bad decrypt/i.test(e.message)) {
      throw new Error('WHATSAPP_FLOW_KEY_PASSPHRASE does not match the private key.');
    }
    throw new Error(`The private key could not be read (${e.message}). Check WHATSAPP_FLOW_PRIVATE_KEY holds the whole PEM, BEGIN to END.`);
  }
}

/** The public half of the configured key, as PEM — what Meta's "Sign public
 *  key" step asks for. Not secret: it can only encrypt, never decrypt. */
export function publicKeyPem() {
  return crypto.createPublicKey(privateKey()).export({ type: 'spki', format: 'pem' }).toString();
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
