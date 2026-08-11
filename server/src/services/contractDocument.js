import { AgreementTemplate } from '../models/index.js';
import { fillAgreementPdf, agreementTemplateExists } from './agreementPdf.js';
import { renderContractPdf } from './contractPdf.js';
import { mergeAgreementText, renderAgreementTextPdf, renderAgreementHtmlPdf, looksLikeHtml } from './agreementText.js';
import { stampSignature } from './stampSignature.js';

/**
 * The single source for a contract's agreement document — used by the contract
 * page, the signing flow and the signed-copy archive alike, so editing the
 * default template on the Document Templates page changes it everywhere.
 *
 * Priority:
 *   1. wording saved on this contract (agreementText, already merged)
 *   2. the default template designed in the app, placeholders resolved
 *   3. the legacy PDF-file template, then the generated fallback
 */
export async function buildContractPdf(contract, signedDate) {
  const renderRich = (content) => looksLikeHtml(content)
    ? renderAgreementHtmlPdf({ html: content, contract, signedDate })
    : renderAgreementTextPdf({ text: content, contract, signedDate });

  const perContract = String(contract.agreementText || '').trim();
  if (perContract) return renderRich(perContract);

  const tpl = await AgreementTemplate.findOne({ $or: [{ isDefault: true }, { key: 'default' }] })
    .sort({ isDefault: -1 }).lean();
  if (tpl?.body?.trim()) {
    return renderRich(mergeAgreementText(tpl.body, contract));
  }

  const parts = { contract, customer: contract.customer, unit: contract.unit };
  return agreementTemplateExists()
    ? fillAgreementPdf({ ...parts, signedDate })
    : renderContractPdf(parts);
}

/**
 * The signed document. Template-based renders draw the captured signature
 * directly on the signature line (and initials on earlier pages); the legacy
 * file template keeps the old coordinate stamping.
 */
export async function buildSignedContractPdf(contract, signedAt, sig) {
  const sign = {
    signerName: sig.signerName,
    signatureDataUrl: sig.signMode === 'draw' ? sig.signatureDataUrl : null,
    initialsDataUrl: sig.initialsMode === 'draw' ? sig.initialsDataUrl : null,
    initialsText: sig.initialsText,
  };
  const renderRich = (content) => looksLikeHtml(content)
    ? renderAgreementHtmlPdf({ html: content, contract, signedDate: signedAt, sign })
    : renderAgreementTextPdf({ text: content, contract, signedDate: signedAt, sign });

  const perContract = String(contract.agreementText || '').trim();
  if (perContract) return renderRich(perContract);

  const tpl = await AgreementTemplate.findOne({ $or: [{ isDefault: true }, { key: 'default' }] })
    .sort({ isDefault: -1 }).lean();
  if (tpl?.body?.trim()) return renderRich(mergeAgreementText(tpl.body, contract));

  // Legacy paths: render then coordinate-stamp as before
  const pdf = await buildContractPdf(contract, signedAt);
  return stampSignature(pdf, { ...sig, signedAt });
}
