import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  decryptRequest, encryptResponse, readClientInfo, buildSummaryText,
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
    authorized_person: 'Ali Ahmed',
    emergency_contact: '+971 50 123 4567',
    id_photo: [{ media_id: 'abc' }],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.fields, { fullName: 'Fatima Ahmed', authorizedPerson: 'Ali Ahmed', emergencyContact: '+971501234567' });
  assert.equal(r.photos.length, 1);
});

test('a missing name or unusable number is reported, not saved', () => {
  const r = readClientInfo({ full_name: '', emergency_contact: '123' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, ['a full name', 'a usable emergency contact number']);
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

test('a missing photo is said out loud on the summary', () => {
  const fields = { fullName: 'Fatima Ahmed', authorizedPerson: '', emergencyContact: '+971501234567' };
  assert.match(buildSummaryText(fields, 0), /ID Document: Not uploaded/);
  assert.match(buildSummaryText(fields, 2), /ID Document: 2 uploaded/);
  // An absent authorised person shows as a dash rather than an empty line.
  assert.match(buildSummaryText(fields, 0), /Authorized Person: —/);
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
