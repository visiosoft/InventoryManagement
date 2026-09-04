import { Unit, Contract, Quote } from '../models/index.js';

/**
 * A quotation holds the unit it was written for.
 *
 * A unit quoted to somebody read as Available right up until they signed, so
 * the same unit could be quoted to two people and promised to both. The one
 * that made it obvious: F2-64 was quoted to a customer, and the Book Unit page
 * still offered it as free.
 *
 * Which quotes hold a unit, and why each test is here:
 *
 *   not rejected       a quote the customer turned down is over.
 *   not yet expired    every quote carries an expiry date and nothing ever
 *                      swept them, so one written in June still reads as live.
 *                      This is also what stops an abandoned quote holding a
 *                      unit for good: the hold lapses on its own.
 *   no contract yet    once it converts, the contract decides — occupied while
 *                      it runs, reserved while it is a draft.
 *
 * Note what is *not* tested: whether the quote was marked as sent. Both send
 * actions set that status, and on production not one quote of 57 has ever
 * carried it — the team downloads the PDF and sends it by hand over WhatsApp,
 * so every real quotation sits in 'draft' for ever. A rule keyed on 'sent'
 * would be tidy and would hold nothing at all. Writing a quotation for a named
 * customer against a named unit is the commitment here, and that is what is
 * honoured.
 */
export const HOLDING_STATUSES = ['draft', 'sent', 'accepted'];

export function heldByQuoteFilter(unitId, at = new Date()) {
   return {
      'units.unit': unitId,
      status: { $in: HOLDING_STATUSES },
      expiryDate: { $gte: at },
      contract: { $in: [null, undefined] },
   };
}

/**
 * Recompute one unit's status from the contracts and quotations that
 * actually reference it.
 *
 * This used to be copy-pasted into four route files that had drifted apart —
 * one of them wrote 'rented', which is not even a valid status. Three of them
 * matched only `contract.unit` and ignored `contract.units`, so every unit
 * after the first on a multi-unit contract kept a stale status forever.
 *
 * Maintenance is never overwritten: a unit out of service stays out of service
 * regardless of what contracts or quotes say about it.
 */
export async function statusForUnit(unitId) {
  if (!unitId) return null;
  const unit = await Unit.findById(unitId).select('status').lean();
  if (!unit) return null;
  // A unit out of service stays out of service, whatever the paperwork says.
  if (unit.status === 'maintenance') return 'maintenance';

  const onUnit = { $or: [{ unit: unitId }, { units: unitId }], archived: { $ne: true } };

  const active = await Contract.findOne({ ...onUnit, status: 'active' }).select('_id').lean();
  if (active) return 'occupied';

  const upcoming = await Contract.findOne({ ...onUnit, status: { $in: ['draft', 'pending_signature'] } })
    .sort({ startDate: 1 })
    .select('_id')
    .lean();
  if (upcoming) return 'reserved';

  /* A live quotation holds it too. Checked after contracts, because a contract
     is the stronger claim and says more about the unit than a quote does. */
  const quoted = await Quote.findOne(heldByQuoteFilter(unitId)).select('_id').lean();
  return quoted ? 'reserved' : 'available';
}

export async function syncUnitStatus(unitId) {
  const next = await statusForUnit(unitId);
  if (!next || next === 'maintenance') return;
  const unit = await Unit.findById(unitId).select('status').lean();
  if (unit && unit.status !== next) await Unit.updateOne({ _id: unitId }, { status: next });
}

/**
 * Let go of anything whose hold has lapsed.
 *
 * A quotation expires by its date and nothing ever swept them, so without this
 * a unit quoted in June stays reserved for good. Only units currently reserved
 * are looked at: they are the only ones a lapse can free, and there are a
 * handful of them against 364 units.
 *
 * Nothing here can make a unit reserved — that happens where a quote or a
 * contract is written. This only releases.
 *
 * @returns the units that were freed
 */
export async function releaseLapsedHolds() {
   const held = await Unit.find({ status: 'reserved' }).select('unitNumber').lean();
   const freed = [];
   for (const u of held) {
      await syncUnitStatus(u._id);
      const after = await Unit.findById(u._id).select('status').lean();
      if (after?.status === 'available') freed.push(u.unitNumber);
   }
   return freed;
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
