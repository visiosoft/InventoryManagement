import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('hex');
const { encrypt, decrypt } = await import('./crypto.js');

test('round-trips a plaintext string', () => {
  const { ciphertext, iv, tag } = encrypt('shpat_super_secret_token');
  assert.equal(decrypt(ciphertext, iv, tag), 'shpat_super_secret_token');
});

test('two encryptions of the same plaintext use different IVs and ciphertext', () => {
  const a = encrypt('same-value');
  const b = encrypt('same-value');
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(decrypt(a.ciphertext, a.iv, a.tag), 'same-value');
  assert.equal(decrypt(b.ciphertext, b.iv, b.tag), 'same-value');
});

test('a tampered ciphertext fails the auth tag check instead of decrypting to garbage', () => {
  const { ciphertext, iv, tag } = encrypt('do-not-tamper');
  const tampered = Buffer.from(ciphertext, 'base64');
  tampered[0] ^= 0xff;
  assert.throws(() => decrypt(tampered.toString('base64'), iv, tag));
});

test('a tampered auth tag is rejected', () => {
  const { ciphertext, iv, tag } = encrypt('do-not-tamper');
  const tampered = Buffer.from(tag, 'base64');
  tampered[0] ^= 0xff;
  assert.throws(() => decrypt(ciphertext, iv, tampered.toString('base64')));
});

test('throws a clear error when the key is missing', async () => {
  const original = process.env.CREDENTIALS_ENCRYPTION_KEY;
  delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  try {
    assert.throws(() => encrypt('x'), /CREDENTIALS_ENCRYPTION_KEY/);
  } finally {
    process.env.CREDENTIALS_ENCRYPTION_KEY = original;
  }
});
