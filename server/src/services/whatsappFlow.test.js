import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  decryptRequest, encryptResponse, readClientInfo, buildSummaryText, decryptFlowMedia, sniffMedia,
  normalisePhone, flowToken, phoneFromFlowToken,
} from './whatsappFlow.js';

/* The crypto is the part that fails silently in production — a wrong padding
   or a reused IV shows the customer "something went wrong" and logs a 200. So
   it is exercised here end to end against a real keypair, standing in for
   Meta. */

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/** Encrypt a request exactly as Meta does, so decryptRequest is tested for real. */
function encryptLikeMeta(payload, aesKey, iv) {
  const encAes = crypto.publicEncrypt(
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    aesKey,
  );
  const cipher = crypto.createCipheriv(aesKey.length === 32 ? 'aes-256-gcm' : 'aes-128-gcm', aesKey, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf-8'), cipher.final()]);
  return {
    encrypted_aes_key: encAes.toString('base64'),
    encrypted_flow_data: Buffer.concat([body, cipher.getAuthTag()]).toString('base64'),
    initial_vector: iv.toString('base64'),
  };
}

const withKey = (fn) => {
  const prev = process.env.WHATSAPP_FLOW_PRIVATE_KEY;
  process.env.WHATSAPP_FLOW_PRIVATE_KEY = privateKey;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.WHATSAPP_FLOW_PRIVATE_KEY;
    else process.env.WHATSAPP_FLOW_PRIVATE_KEY = prev;
  }
};

for (const bits of [16, 32]) {
  test(`a request encrypted with an AES-${bits * 8} key round-trips`, () => {
    withKey(() => {
      const aesKey = crypto.randomBytes(bits);
      const iv = crypto.randomBytes(16);
      const sent = { version: '3.0', action: 'data_exchange', screen: 'CLIENT_INFO', data: { full_name: 'Fatima Ahmed' } };

      const { body, aesKey: gotKey, iv: gotIv } = decryptRequest(encryptLikeMeta(sent, aesKey, iv));
      assert.deepEqual(body, sent);
      assert.deepEqual(gotKey, aesKey);
      assert.deepEqual(gotIv, iv);
    });
  });
}

test('the reply is encrypted with the initial vector inverted', () => {
  withKey(() => {
    const aesKey = crypto.randomBytes(16);
    const iv = crypto.randomBytes(16);
    const response = { screen: 'SUMMARY', data: { summary: 'Name: Fatima Ahmed' } };

    const encrypted = Buffer.from(encryptResponse(response, aesKey, iv), 'base64');

    // Decrypt the way the client does: same key, every bit of the IV flipped.
    const flipped = Buffer.from(iv.map((b) => ~b & 0xff));
    const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, flipped);
    decipher.setAuthTag(encrypted.subarray(-16));
    const plain = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf-8');

    assert.deepEqual(JSON.parse(plain), response);
  });
});

test('a tampered body fails rather than decrypting to something', () => {
  withKey(() => {
    const aesKey = crypto.randomBytes(16);
    const iv = crypto.randomBytes(16);
    const req = encryptLikeMeta({ action: 'ping' }, aesKey, iv);

    const bytes = Buffer.from(req.encrypted_flow_data, 'base64');
    bytes[2] ^= 0xff;
    req.encrypted_flow_data = bytes.toString('base64');

    assert.throws(() => decryptRequest(req));
  });
});

/* The form's own rules. */

test('a filled form is accepted and normalised', () => {
  const r = readClientInfo({
    full_name: '  Fatima   Ahmed ',
    phone: '050 123 4567',
    id_type: 'emirates_id',
    id_photo: [{ media_id: 'abc' }, { media_id: 'def' }],
    authorized_name: 'Ali Ahmed',
    authorized_phone: '+971 55 765 4321',
  });
  assert.equal(r.ok, true);
  assert.equal(r.fields.fullName, 'Fatima Ahmed');
  assert.equal(r.fields.phone, '+971501234567');
  assert.equal(r.fields.idType, 'emirates_id');
  assert.equal(r.fields.authorizedName, 'Ali Ahmed');
  assert.equal(r.fields.authorizedPhone, '+971557654321');
  assert.equal(r.photos.length, 2);
});

test('missing name, bad phone and no ID photo are each reported', () => {
  const r = readClientInfo({ full_name: '', phone: '123', id_photo: [] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, ['your full name', 'a valid phone number', 'a photo of your Emirates ID or passport']);
});

test('an authorized phone without a name is refused; both are optional together', () => {
  assert.deepEqual(readClientInfo({ full_name: 'Sara K', authorized_phone: '0501234567' }).problems, ["the authorized person's name"]);
  assert.equal(readClientInfo({ full_name: 'Sara K' }).ok, true);
});

test('the older field names still work', () => {
  const r = readClientInfo({ full_name: 'Sara K', authorized_person: 'Omar', emergency_contact: '0501234567' });
  assert.equal(r.fields.authorizedName, 'Omar');
  assert.equal(r.fields.emergencyContact, '+971501234567');
});

test('UAE numbers reach the same stored form however they are typed', () => {
  for (const typed of ['0501234567', '+971501234567', '00971501234567', '971 50 123 4567']) {
    assert.equal(normalisePhone(typed), '+971501234567', `wrong for ${typed}`);
  }
});

test('something too short to be a number is refused', () => {
  for (const bad of ['', '123', 'not a phone', '0']) {
    assert.equal(normalisePhone(bad), '');
  }
});

test('the summary says what was uploaded and names the document', () => {
  const fields = { fullName: 'Fatima Ahmed', phone: '+971501234567', idType: 'passport', authorizedName: '', authorizedPhone: '', emergencyContact: '' };
  assert.match(buildSummaryText(fields, 0), /Passport: Not uploaded/);
  assert.match(buildSummaryText(fields, 1), /Passport: 1 photo uploaded/);
  assert.match(buildSummaryText({ ...fields, idType: 'emirates_id' }, 2), /Emirates ID: 2 photos uploaded/);
  assert.match(buildSummaryText(fields, 0), /Authorized Person: —/);
  assert.match(buildSummaryText({ ...fields, authorizedName: 'Ali', authorizedPhone: '+971557654321' }, 0), /Authorized Person: Ali \(\+971557654321\)/);
});

/* Media from a PhotoPicker, encrypted the way Meta documents it. */

function encryptMediaLikeMeta(plain) {
  const key = crypto.randomBytes(32);
  const hmacKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', key, iv);
  const ciphertext = Buffer.concat([c.update(plain), c.final()]);
  const mac = crypto.createHmac('sha256', hmacKey).update(Buffer.concat([iv, ciphertext])).digest().subarray(0, 10);
  const cdnFile = Buffer.concat([ciphertext, mac]);
  const sha = (b) => crypto.createHash('sha256').update(b).digest('base64');
  return {
    cdnFile,
    meta: {
      encryption_key: key.toString('base64'), hmac_key: hmacKey.toString('base64'), iv: iv.toString('base64'),
      encrypted_hash: sha(cdnFile), plaintext_hash: sha(plain),
    },
  };
}

test('an uploaded photo decrypts and is recognised as a JPEG', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(500)]);
  const { cdnFile, meta } = encryptMediaLikeMeta(jpeg);
  const out = decryptFlowMedia(cdnFile, meta);
  assert.ok(out.equals(jpeg));
  assert.equal(sniffMedia(out).mimeType, 'image/jpeg');
});

test('a tampered upload is refused, not stored', () => {
  const { cdnFile, meta } = encryptMediaLikeMeta(Buffer.from('%PDF-1.4 hello'));
  const bad = Buffer.from(cdnFile); bad[3] ^= 0xff;
  assert.throws(() => decryptFlowMedia(bad, meta), /hash mismatch/);
  assert.throws(() => decryptFlowMedia(bad, { ...meta, encrypted_hash: crypto.createHash('sha256').update(bad).digest('base64') }), /HMAC mismatch/);
});

/* The token is the only thing tying a submission to a person — the sender's
   number is not in the payload. */

test('a token we minted gives back the number', () => {
  assert.equal(phoneFromFlowToken(flowToken('971501234567')), '971501234567');
});

test('a token we did not mint gives back nothing', () => {
  for (const bad of ['', 'nonsense', '971501234567.deadbeefdeadbeef', '971501234567', flowToken('971501234567') + 'x']) {
    assert.equal(phoneFromFlowToken(bad), '', `accepted: ${bad}`);
  }
});

test('a token cannot be edited to point at someone else', () => {
  const mine = flowToken('971501234567');
  const swapped = `971509999999.${mine.split('.')[1]}`;
  assert.equal(phoneFromFlowToken(swapped), '');
});

test('a PEM with its line breaks lost is rebuilt', async () => {
  const crypto = await import('node:crypto');
  const { normalizePem } = await import('./whatsappFlow.js');
  const pem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  for (const mangled of [pem.replace(/\n/g, ' '), pem.replace(/\n/g, ''), pem.replace(/\n/g, '\\n'), Buffer.from(pem).toString('base64')]) {
    assert.doesNotThrow(() => crypto.createPrivateKey(normalizePem(mangled)));
  }
});
