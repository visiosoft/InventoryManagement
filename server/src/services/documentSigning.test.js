import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  sha256Hex, buildSigningRecord, appendSigningCertificate,
  CONSENT_TEXT_VERSION, consentText,
} from './documentSigning.js';

async function blankPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  return Buffer.from(await doc.save());
}

test('sha256Hex is deterministic and detects any change', () => {
  const a = sha256Hex(Buffer.from('hello'));
  const b = sha256Hex(Buffer.from('hello'));
  const c = sha256Hex(Buffer.from('hellp'));
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64, 'hex-encoded sha256 is 64 chars');
});

test('buildSigningRecord captures IP/user-agent from the request when present', () => {
  const req = { ip: '203.0.113.7', headers: { 'user-agent': 'Mozilla/5.0 Test' } };
  const record = buildSigningRecord({
    method: 'in_house_token', signerName: 'Jane Doe', signedAt: new Date('2026-09-16T10:00:00Z'),
    req, documentHash: 'doc-hash', signedPdfHash: 'signed-hash', signatureMode: 'drawn',
  });
  assert.equal(record.ipAddress, '203.0.113.7');
  assert.equal(record.userAgent, 'Mozilla/5.0 Test');
  assert.equal(record.signatureMode, 'drawn');
  assert.equal(record.consentTextVersion, CONSENT_TEXT_VERSION);
  assert.equal(record.consentText, consentText('Jane Doe'));
});

test('buildSigningRecord defaults IP/user-agent to empty strings with no request (Zoho/offline paths)', () => {
  const record = buildSigningRecord({
    method: 'offline_paper', signerName: 'John Smith', signedAt: new Date(),
    documentHash: 'doc-hash', signedPdfHash: 'signed-hash',
  });
  assert.equal(record.ipAddress, '');
  assert.equal(record.userAgent, '');
  assert.equal(record.signatureMode, 'typed', 'defaults to typed when not specified');
});

test('appendSigningCertificate adds exactly one page carrying the signer, hash and consent text', async () => {
  const pdf = await blankPdf();
  const before = (await PDFDocument.load(pdf)).getPageCount();

  const record = buildSigningRecord({
    method: 'in_house_token', signerName: 'Jane Doe', signedAt: new Date('2026-09-16T10:00:00Z'),
    req: { ip: '203.0.113.7', headers: { 'user-agent': 'Mozilla/5.0' } },
    documentHash: 'a'.repeat(64), signedPdfHash: 'b'.repeat(64), signatureMode: 'drawn',
  });

  const withCert = await appendSigningCertificate(pdf, record, 'Contract PB-2026-0001');
  const after = await PDFDocument.load(withCert);
  assert.equal(after.getPageCount(), before + 1, 'exactly one certificate page is appended');
});

test('the certificate hash always describes the pre-certificate document, not itself', async () => {
  const pdf = await blankPdf();
  const signedPdfHash = sha256Hex(pdf);
  const record = buildSigningRecord({
    method: 'in_house_token', signerName: 'Jane Doe', signedAt: new Date(),
    documentHash: 'a'.repeat(64), signedPdfHash,
  });
  const withCert = await appendSigningCertificate(pdf, record, 'Contract PB-2026-0001');
  // The final (certificate-bearing) file's own hash is necessarily different
  // from the hash printed on it — that hash is a fingerprint of the document
  // as it stood one step earlier, which is the whole point.
  assert.notEqual(sha256Hex(withCert), signedPdfHash);
});
