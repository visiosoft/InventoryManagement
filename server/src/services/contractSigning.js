import { Document } from '../models/index.js';
import { syncUnitStatus } from '../utils/unitStatus.js';
import { uploadFile } from './drive.js';
import { buildContractPdf, buildSignedContractPdf } from './contractDocument.js';
import { recordSignature } from './documentSigning.js';

const SIGNABLE = ['draft', 'pending_signature', 'active'];

/**
 * Sign a contract on the tenant's behalf of their own submission: records the
 * signature, stores the signed PDF, activates the contract and updates the unit.
 * Shared by the emailed signing link (routes/signing.js) and the customer app.
 *
 * `contract` must be populated with customer, unit and units. `req` is only read
 * for the signer's IP and user agent. Throws errors carrying `.status`.
 */
export async function signContract({ contract, body, req }) {
  if (!SIGNABLE.includes(contract.status)) {
    throw Object.assign(new Error('This contract cannot be signed in its current state'), { status: 409 });
  }
  const { signerName, signatureDataUrl, signMode, initialsText, initialsDataUrl, initialsMode } = body || {};
  if (!signerName?.trim()) throw Object.assign(new Error('Signer name is required'), { status: 400 });

  const { finalPdf } = await recordSignature({
    doc: contract,
    entityType: 'Contract',
    documentLabel: `Contract ${contract.contractNo}`,
    timelineText: `Contract signed remotely by ${signerName}`,
    req,
    signerName, signatureDataUrl, signMode, initialsText, initialsDataUrl, initialsMode,
    buildUnsignedPdf: () => buildContractPdf(contract),
    buildSignedPdf: (signedAt, sig) => buildSignedContractPdf(contract, signedAt, sig),
  });

  const stored = await uploadFile({
    buffer: finalPdf,
    filename: `${contract.contractNo}-signed.pdf`,
    mimeType: 'application/pdf',
    customerName: contract.customer?.fullName,
  });

  await Document.create({
    contract: contract._id,
    customer: contract.customer._id,
    name: `${contract.contractNo} — signed contract`,
    type: 'contract',
    ...stored,
  });

  contract.status = 'active';
  contract.signedDocUrl = stored.url;
  contract.signingToken = null;
  contract.signingTokenExpiry = null;
  await contract.save();

  const unitIds = contract.units?.length ? contract.units.map((u) => u._id ?? u) : [contract.unit._id];
  await Promise.all(unitIds.map((uid) => syncUnitStatus(uid)));

  return { contractNo: contract.contractNo, signedDocUrl: stored.url };
}
