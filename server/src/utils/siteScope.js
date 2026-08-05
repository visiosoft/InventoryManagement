import { Site, Unit, Contract } from '../models/index.js';

/**
 * Resolve a ?site=<id> query param into id sets for scoping queries.
 * Returns null when no site is given or it doesn't exist (= no scoping).
 * Units with no site belong to the default site.
 */
export async function siteScope(siteId) {
  if (!siteId) return null;
  const site = await Site.findById(siteId).select('isDefault').catch(() => null);
  if (!site) return null;
  const unitFilter = site.isDefault ? { $or: [{ site: site._id }, { site: null }] } : { site: site._id };
  const unitIds = (await Unit.find(unitFilter).select('_id')).map((u) => u._id);
  const contractIds = (
    await Contract.find({ $or: [{ unit: { $in: unitIds } }, { units: { $in: unitIds } }] }).select('_id')
  ).map((c) => c._id);
  return {
    unitIds,
    contractIds,
    unitFilter: { _id: { $in: unitIds } },
    contractFilter: { _id: { $in: contractIds } },
    paymentFilter: { contract: { $in: contractIds } },
  };
}
