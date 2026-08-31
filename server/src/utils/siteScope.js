import { Site, Unit, Contract } from '../models/index.js';

/**
 * Resolve a ?site=<id> query param into id sets for scoping queries.
 *
 * No id at all means no scoping — that is how background jobs and any caller
 * that genuinely wants the whole company ask.
 *
 * An id that does not resolve is different, and used to mean the same thing:
 * it fell through to no scoping, so a browser holding a facility that had
 * since been renamed away, deleted, or simply never existed was quietly shown
 * every facility's units while its own switcher displayed one. That looks
 * exactly like the scoping being broken, and is worse than an error because
 * the numbers are plausible. An unknown facility now falls back to the default
 * one — the narrowest safe answer — rather than to everything.
 */
export async function siteScope(siteId) {
  if (!siteId) return null;
  let site = await Site.findById(siteId).select('isDefault').catch(() => null);
  if (!site) {
    site = await Site.findOne({ isDefault: true }).select('isDefault')
      ?? await Site.findOne().sort({ createdAt: 1 }).select('isDefault');
  }
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
