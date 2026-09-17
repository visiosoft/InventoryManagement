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
 *   worked on lately   the hold lasts QUOTE_HOLD_DAYS and then lets go by
 *                      itself, signed or not.
 *   no contract yet    once it converts, the contract decides — occupied while
 *                      it runs, reserved while it is a draft.
 *
 * Note what is *not* tested: whether the quote was marked as sent. Both send
 * actions set that status, and on production not one quote of 57 has ever
 * carried it — the team downloads the PDF and sends it by hand over WhatsApp,
 * so every real quotation sits in 'draft' for ever. A rule keyed on 'sent'
 * would be tidy and would hold nothing at all.
 *
 * So a draft counts — but only once it is actually a quotation. The booking
 * wizard writes the quote row at the start and keeps `flowStep` as it moves,
 * so a booking somebody opened and walked away from looks exactly like a real
 * quotation to a query that only reads `status`. That is not theoretical:
 * F2-64 was held by QT-000150, opened for Eldon lemuel, abandoned on the Units
 * step, while the genuine quotation for that unit belonged to somebody else.
 * Of ten drafts, five sit at step 2 or below and five have reached the
 * quotation itself — the step is what separates a promise from a false start.
 */

/** The wizard's steps: 0 customer, 1 units, 2 quotation, 3 contract. A quote
 *  that has reached the contract step has been produced and priced; anything
 *  earlier is still being written. */
export const QUOTE_ISSUED_STEP = 3;

/**
 * How long a quotation holds a unit.
 *
 * Two days, counted from when the quotation was last worked on. The expiry
 * date is no use for this: quotes are written with a month on them, so a unit
 * quoted to somebody who never replied would sit out of the inventory for four
 * weeks. Two days is long enough for a customer to think about it over a
 * weekend and short enough that an unanswered quotation costs nothing.
 *
 * Revising the quote starts the two days again, which is right: working on it
 * is evidence the conversation is alive.
 *
 * Nothing has to run for a hold to lapse — the rule is a date comparison, so a
 * unit is free the moment it should be, whether or not a job has swept it. The
 * hourly sweep only exists to bring the stored status into line.
 */
export const QUOTE_HOLD_DAYS = 2;

export const HOLDING_STATUSES = ['sent', 'accepted'];

/**
 * Was this quotation really issued?
 *
 * The half of the hold rule that is about the quotation itself rather than
 * about how long a unit may be held for — the paragraphs above explain why it
 * cannot simply read `status`, and why `flowStep` is what separates a real
 * quotation from a booking somebody abandoned on the Units step.
 *
 * Pulled out because the recovery agents ask a different question of the same
 * fact: which quotations were issued and never signed, *however old*. They
 * must not reuse `heldByQuoteFilter`, whose expiry and two-day clauses exist
 * to let a unit go — those would exclude precisely the stale quotations a
 * missed-lead sweep is looking for. One statement of "really issued", two
 * callers with different windows around it.
 */
export function issuedQuoteFilter() {
   return {
      $or: [
         { status: { $in: HOLDING_STATUSES } },
         { status: 'draft', flowStep: { $gte: QUOTE_ISSUED_STEP } },
      ],
   };
}

export function heldByQuoteFilter(unitId, at = new Date()) {
   const heldSince = new Date(new Date(at).getTime() - QUOTE_HOLD_DAYS * 864e5);
   return {
      'units.unit': unitId,
      expiryDate: { $gte: at },
      contract: { $in: [null, undefined] },
      // Worked on within the hold window. `updatedAt` is the same field the
      // card reads for "quoted 4 days ago", so the label and the hold can
      // never disagree about how old a quotation is.
      updatedAt: { $gte: heldSince },
      ...issuedQuoteFilter(),
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
