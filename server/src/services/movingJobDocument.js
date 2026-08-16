import { AgreementTemplate } from '../models/index.js';
import { mergeAgreementText, renderAgreementTextPdf, renderAgreementHtmlPdf, looksLikeHtml, movingAgreementPlaceholders } from './agreementText.js';

// The renderers print a "Contract No:" header line off contract.contractNo —
// alias jobNo onto that key so a MovingJob prints sensibly there too.
function asContractLike(job) {
  const obj = typeof job.toObject === 'function' ? job.toObject() : job;
  return { ...obj, contractNo: job.jobNo };
}

/**
 * Same priority as the storage side's buildContractPdf: per-job wording first,
 * then the default module='moving' template, so editing that template on the
 * Document Templates page changes every future moving agreement automatically.
 */
export async function buildMovingJobPdf(job, signedDate) {
  const contract = asContractLike(job);
  const renderRich = (content) => looksLikeHtml(content)
    ? renderAgreementHtmlPdf({ html: content, contract, signedDate, title: 'MOVING SERVICES AGREEMENT' })
    : renderAgreementTextPdf({ text: content, contract, signedDate, title: 'MOVING SERVICES AGREEMENT' });

  const perJob = String(job.agreementText || '').trim();
  if (perJob) return renderRich(perJob);

  const tpl = await AgreementTemplate.findOne({ module: 'moving', isDefault: true }).lean();
  if (tpl?.body?.trim()) return renderRich(mergeAgreementText(tpl.body, job, movingAgreementPlaceholders));

  return renderAgreementTextPdf({ text: 'No moving agreement template configured.', contract, signedDate });
}

export async function buildSignedMovingJobPdf(job, signedAt, sig) {
  const contract = asContractLike(job);
  const sign = {
    signerName: sig.signerName,
    signatureDataUrl: sig.signMode === 'draw' ? sig.signatureDataUrl : null,
    initialsDataUrl: sig.initialsMode === 'draw' ? sig.initialsDataUrl : null,
    initialsText: sig.initialsText,
  };
  const renderRich = (content) => looksLikeHtml(content)
    ? renderAgreementHtmlPdf({ html: content, contract, signedDate: signedAt, sign, title: 'MOVING SERVICES AGREEMENT' })
    : renderAgreementTextPdf({ text: content, contract, signedDate: signedAt, sign, title: 'MOVING SERVICES AGREEMENT' });

  const perJob = String(job.agreementText || '').trim();
  if (perJob) return renderRich(perJob);

  const tpl = await AgreementTemplate.findOne({ module: 'moving', isDefault: true }).lean();
  if (tpl?.body?.trim()) return renderRich(mergeAgreementText(tpl.body, job, movingAgreementPlaceholders));

  return renderAgreementTextPdf({ text: 'No moving agreement template configured.', contract, signedDate: signedAt, sign });
}
