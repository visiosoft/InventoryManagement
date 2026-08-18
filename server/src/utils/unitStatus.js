import { Unit, Contract } from '../models/index.js';

/**
 * Recompute one unit's status from the contracts that actually reference it.
 *
 * This used to be copy-pasted into four route files that had drifted apart —
 * one of them wrote 'rented', which is not even a valid status. Three of them
 * matched only `contract.unit` and ignored `contract.units`, so every unit
 * after the first on a multi-unit contract kept a stale status forever.
 *
 * Maintenance is never overwritten: a unit out of service stays out of service
 * regardless of what contracts say about it.
 */
export async function syncUnitStatus(unitId) {
  if (!unitId) return;
  const unit = await Unit.findById(unitId).select('status');
  if (!unit) return;
  if (unit.status === 'maintenance') return;

  const onUnit = { $or: [{ unit: unitId }, { units: unitId }], archived: { $ne: true } };

  const active = await Contract.findOne({ ...onUnit, status: 'active' }).select('_id').lean();
  if (active) {
    if (unit.status !== 'occupied') await Unit.updateOne({ _id: unitId }, { status: 'occupied' });
    return;
  }

  const upcoming = await Contract.findOne({ ...onUnit, status: { $in: ['draft', 'pending_signature'] } })
    .sort({ startDate: 1 })
    .select('_id')
    .lean();
  const next = upcoming ? 'reserved' : 'available';
  if (unit.status !== next) await Unit.updateOne({ _id: unitId }, { status: next });
}

/** Recompute every unit. Returns the units whose status actually changed. */
export async function syncAllUnitStatuses() {
  const units = await Unit.find().select('unitNumber status').lean();
  const changed = [];
  for (const u of units) {
    const before = u.status;
    await syncUnitStatus(u._id);
    const after = (await Unit.findById(u._id).select('status').lean())?.status;
    if (before !== after) changed.push({ unitNumber: u.unitNumber, before, after });
  }
  return changed;
}
