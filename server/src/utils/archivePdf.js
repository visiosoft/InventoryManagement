import { Document } from '../models/index.js';
import { uploadFile } from '../services/drive.js';

/**
 * Store a generated PDF (invoice / quotation) in the Documents section.
 * First generation creates the document; later generations refresh the stored
 * copy only when the source record changed after the last archive.
 * Never throws — archiving must not break the PDF response.
 */
export async function archivePdf({ buffer, name, customerId, customerName, contractId, sourceUpdatedAt }) {
  try {
    const existing = await Document.findOne({ name });
    if (existing) {
      const fresh = !sourceUpdatedAt || new Date(existing.updatedAt) >= new Date(sourceUpdatedAt);
      if (fresh) return existing;
      const stored = await uploadFile({ buffer, filename: name, mimeType: 'application/pdf', customerName });
      existing.set({
        ...stored,
        ...(contractId ? { contract: contractId } : {}),
        ...(customerId ? { customer: customerId } : {}),
      });
      await existing.save();
      return existing;
    }
    const stored = await uploadFile({ buffer, filename: name, mimeType: 'application/pdf', customerName });
    return await Document.create({
      contract: contractId || undefined,
      customer: customerId || undefined,
      name,
      type: 'other',
      ...stored,
    });
  } catch (e) {
    console.error(`[archivePdf] ${name}: ${e.message}`);
    return null;
  }
}
