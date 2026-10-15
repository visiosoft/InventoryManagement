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

/**
 * What the server is actually reading as its flow key — never the key itself,
 * only its shape — so a broken setup can be diagnosed from a browser.
 */
export function flowKeyDiagnostics() {
  const file = process.env.WHATSAPP_FLOW_PRIVATE_KEY_FILE || '';
  const out = {
    source: file ? 'WHATSAPP_FLOW_PRIVATE_KEY_FILE' : (process.env.WHATSAPP_FLOW_PRIVATE_KEY ? 'WHATSAPP_FLOW_PRIVATE_KEY' : 'none'),
    file: file || null,
    alsoSetInline: Boolean(file && process.env.WHATSAPP_FLOW_PRIVATE_KEY),
    passphraseSet: Boolean(process.env.WHATSAPP_FLOW_KEY_PASSPHRASE),
  };
  let raw = '';
  if (file) {
    out.fileExists = fs.existsSync(file);
    if (out.fileExists) {
      try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { out.fileError = e.message; }
    }
  } else {
    raw = String(process.env.WHATSAPP_FLOW_PRIVATE_KEY || '');
  }
  const pem = normalizePem(raw);
  out.characters = raw.length;
  out.beginLine = (pem.match(/-----BEGIN [A-Z0-9 ]+-----/) || [null])[0];
  out.hasEndLine = /-----END [A-Z0-9 ]+-----/.test(pem);
  out.encrypted = /ENCRYPTED/.test(pem);
  // A 2048-bit key is about 1,700 characters; a value cut off after its first
  // line is about 30.
  if (out.beginLine && !out.hasEndLine) out.problem = 'Only the start of the key is there — it was cut off (usually a multi-line value in .env). Use a key file instead.';
  return out;
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
    const where = process.env.WHATSAPP_FLOW_PRIVATE_KEY_FILE ? `the file ${process.env.WHATSAPP_FLOW_PRIVATE_KEY_FILE}` : 'WHATSAPP_FLOW_PRIVATE_KEY';
    throw new Error(`The private key could not be read (${e.message}). Check ${where} holds the whole PEM, BEGIN to END.`);
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
 *
 * Fields (CLIENT_INFO screen): full_name, phone, id_type (emirates_id |
 * passport), id_photo (PhotoPicker), authorized_name, authorized_phone.
 * The older names authorized_person / emergency_contact are still read, so a
 * flow published before this change keeps working.
 */
export function readClientInfo(data = {}) {
  const fullName = clean(data.full_name);
  const phone = normalisePhone(data.phone);
  const idType = ['emirates_id', 'passport'].includes(data.id_type) ? data.id_type : '';
  const authorizedName = clean(data.authorized_name ?? data.authorized_person);
  const authorizedPhoneRaw = clean(data.authorized_phone);
  const authorizedPhone = normalisePhone(authorizedPhoneRaw);
  const emergencyContact = normalisePhone(data.emergency_contact);
  const email = clean(data.email).toLowerCase();
  const nationality = clean(data.nationality);

  // PhotoPicker / DocumentPicker send media descriptors, not the image itself.
  const photos = Array.isArray(data.id_photo) ? data.id_photo
    : Array.isArray(data.id_document) ? data.id_document : [];

  const problems = [];
  // Name, phone, emergency phone, ID type and the ID photo are all mandatory — checked here
  // too, not only by the form, so nothing half-filled is ever saved.
  if (fullName.length < 2) problems.push('your full name');
  if (!phone) problems.push('a valid phone number');
  if (!emergencyContact) problems.push('a valid emergency phone number');
  // Somebody to call when the customer cannot be reached is no use if it is
  // the customer's own number.
  else if (phone && emergencyContact === phone) problems.push('an emergency number different from your own');
  if (data.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) problems.push('a valid email address');
  if (data.nationality !== undefined && nationality.length < 2) problems.push('your nationality');
  if (!idType) problems.push('the ID type (Emirates ID or passport)');
  if (photos.length === 0) problems.push('a photo of your Emirates ID or passport');
  if (authorizedPhoneRaw && !authorizedPhone) problems.push("a valid phone number for the authorized person");
  if (authorizedPhone && !authorizedName) problems.push("the authorized person's name");

  return {
    fields: { fullName, phone, email, nationality, idType, authorizedName, authorizedPhone, emergencyContact,
      // Kept for older callers that read these names.
      authorizedPerson: authorizedName },
    photos,
    problems,
    ok: problems.length === 0,
  };
}

const ID_LABEL = { emirates_id: 'Emirates ID', passport: 'Passport' };

/** The text the confirmation screen reads back. */
export function buildSummaryText(fields, photoCount = 0) {
  const doc = ID_LABEL[fields.idType] || 'ID document';
  return [
    `Name: ${fields.fullName}`,
    fields.phone ? `Phone: ${fields.phone}` : '',
    fields.email ? `Email: ${fields.email}` : '',
    fields.nationality ? `Nationality: ${fields.nationality}` : '',
    `${doc}: ${photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? '' : 's'} uploaded` : 'Not uploaded'}`,
    `Authorized Person: ${fields.authorizedName || '—'}${fields.authorizedPhone ? ` (${fields.authorizedPhone})` : ''}`,
    fields.emergencyContact ? `Emergency Contact: ${fields.emergencyContact}` : '',
  ].filter(Boolean).join('\n');
}

/* ── Uploaded media ──────────────────────────────────────────────────────────
   A PhotoPicker answer is a list of descriptors: Meta keeps the file on its
   CDN, encrypted, and hands us the keys. Decrypting it is Meta's documented
   recipe, checked at every step so a corrupted or tampered file is refused
   rather than stored as somebody's ID:
     1. sha256(cdn file) must equal encrypted_hash
     2. the last 10 bytes are an HMAC-SHA256 (hmac_key) over iv + ciphertext
     3. AES-256-CBC (encryption_key, iv) with PKCS7 padding
     4. sha256(plaintext) must equal plaintext_hash */

export function decryptFlowMedia(cdnFile, meta = {}) {
  const b64 = (v) => Buffer.from(String(v || ''), 'base64');
  const sha = (buf) => crypto.createHash('sha256').update(buf).digest();
  if (!sha(cdnFile).equals(b64(meta.encrypted_hash))) throw new Error('media hash mismatch');
  const ciphertext = cdnFile.subarray(0, -10);
  const mac = cdnFile.subarray(-10);
  const iv = b64(meta.iv);
  const expected = crypto.createHmac('sha256', b64(meta.hmac_key)).update(Buffer.concat([iv, ciphertext])).digest().subarray(0, 10);
  if (!crypto.timingSafeEqual(mac, expected)) throw new Error('media HMAC mismatch');
  const decipher = crypto.createDecipheriv('aes-256-cbc', b64(meta.encryption_key), iv);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (!sha(plain).equals(b64(meta.plaintext_hash))) throw new Error('media plaintext hash mismatch');
  return plain;
}

/** What a decrypted file actually is, from its first bytes. */
export function sniffMedia(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return { mimeType: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 4).toString('hex') === '89504e47') return { mimeType: 'image/png', ext: 'png' };
  if (buf.subarray(0, 4).toString() === '%PDF') return { mimeType: 'application/pdf', ext: 'pdf' };
  if (buf.subarray(8, 12).toString() === 'WEBP') return { mimeType: 'image/webp', ext: 'webp' };
  if (buf.subarray(4, 12).toString().startsWith('ftypheic') || buf.subarray(4, 12).toString().startsWith('ftypmif1')) return { mimeType: 'image/heic', ext: 'heic' };
  return { mimeType: 'application/octet-stream', ext: 'bin' };
}

/** Download one descriptor's file from Meta's CDN and decrypt it. */
export async function fetchFlowMedia(descriptor) {
  if (!descriptor?.cdn_url || !descriptor?.encryption_metadata) throw new Error('media descriptor has no cdn_url or keys');
  const r = await fetch(descriptor.cdn_url);
  if (!r.ok) throw new Error(`media download failed: HTTP ${r.status}`);
  const cdnFile = Buffer.from(await r.arrayBuffer());
  const buffer = decryptFlowMedia(cdnFile, descriptor.encryption_metadata);
  return { buffer, ...sniffMedia(buffer) };
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
