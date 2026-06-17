import { renderContractPdf } from './contractPdf.js';
import { fillAgreementPdf, agreementTemplateExists } from './agreementPdf.js';

export function buildContractPdf(contract, signedDate) {
  const parts = { contract, customer: contract.customer, unit: contract.unit };
  return agreementTemplateExists()
    ? fillAgreementPdf({ ...parts, signedDate })
    : renderContractPdf(parts);
}
