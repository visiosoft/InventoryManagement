import { Contract, Document } from '../models/index.js';
import { ID_TYPES, latestPerSlot } from './identityDocs.js';

/**
 * A customer's ID is uploaded once, in the app, and belongs on every contract they hold. These helpers copy the current
 * file in each slot onto a contract as its own Document (pointing at the same stored file), so the office sees the ID
 * where it looks for it, on the contract, without anyone re-uploading it.
 */

const ACTIVE = ['draft', 'pending_signature', 'active'];

export async function linkIdentityToContract(customerId, contractId) {
  const docs = await Document.find({ customer: customerId, type: { $in: ID_TYPES } }).sort({ createdAt: -1 });
  let linked = 0;
  for (const d of latestPerSlot(docs.map((x) => x.toObject()))) {
    const key = d.driveFileId ? { driveFileId: d.driveFileId } : { url: d.url };
    const exists = await Document.exists({ contract: contractId, type: d.type, side: d.side, ...key });
    if (exists) continue;
    await Document.create({
      contract: contractId, customer: customerId, name: d.name, type: d.type, side: d.side, source: d.source, mime: d.mime,
      storage: d.storage, driveFileId: d.driveFileId, url: d.url,
    });
    linked += 1;
  }
  return linked;
}

/** After an upload: put the new file on every contract the customer currently has. */
export async function linkIdentityToCustomerContracts(customerId) {
  const contracts = await Contract.find({ customer: customerId, status: { $in: ACTIVE } }).select('_id');
  let linked = 0;
  for (const c of contracts) linked += await linkIdentityToContract(customerId, c._id);
  return { contracts: contracts.length, linked };
}

/** Documents that belong to a customer: filed under them, or under any of their contracts (staff often file by contract). */
export async function customerDocumentFilter(customerId) {
  const ids = (await Contract.find({ customer: customerId }).select('_id').lean()).map((c) => c._id);
  return { $or: [{ customer: customerId }, ...(ids.length ? [{ contract: { $in: ids } }] : [])] };
}
