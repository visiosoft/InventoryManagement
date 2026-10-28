import { Unit, Contract, Payment, Quote } from '../models/index.js';
import { QUOTE_HOLD_DAYS, issuedQuoteFilter } from '../utils/unitStatus.js';
import { hiddenSiteIds } from '../utils/siteScope.js';

/**
 * A day's unit movement by floor, the sheet operations keep by hand:
 *
 *   Morning      units free at the start of the day
 *   Booked       units whose contract was signed that day
 *   Check Out    units whose contract ended that day and nobody follows on
 *   Reserved     units a quotation was issued for that day, or a contract
 *                made with no quotation before it
 *   Cancelled    reservations let go that day: a contract cancelled, a
 *                quotation rejected or expired, or its two-day hold lapsed
 *   EOD          units free at the end of the day
 *   Not paid     units held at the end of the day by a contract not moved in
 *                yet (or not signed) with no payment received
 *
 * There is no history of unit statuses, so the day is rebuilt from the
 * contracts: a contract holds its units from when it was made (or its
 * check-in, if made later) to the end of its check-out day, or until it was
 * cancelled. An issued quotation holds its units from when it was made for
 * two days after it was last worked on (QUOTE_HOLD_DAYS), until its contract
 * is made, or until it is rejected or expires. Units in maintenance or in a
 * hidden facility are left out, as they are of every count of free units.
 */

const DUBAI = 4 * 3_600_000;
const DAY = 86_400_000;
/** "2026-10-27" for an instant, in Dubai. Pure. */
export const dubaiDay = (d) => new Date(new Date(d).getTime() + DUBAI).toISOString().slice(0, 10);
/** The first instant of a Dubai day. Pure. */
export const dayStart = (day) => new Date(`${day}T00:00:00.000+04:00`);

const unitIdsOf = (c) => [...new Set([c.unit, ...(c.units || []), ...(c.unitLines || []).map((l) => l?.unit)].filter(Boolean).map(String))];
const signedAt = (c) => (c.timeline || []).find((t) => /signed|approved and activated/i.test(t.text || ''))?.at || null;
const cancelledAt = (c) => (c.status === 'cancelled'
   ? (c.timeline || []).filter((t) => /cancel/i.test(t.text || '')).map((t) => t.at).pop() || c.updatedAt
   : null);

/** When a contract starts and stops holding its units. Pure. */
export function holdSpan(c) {
   const made = new Date(c.importedAt ? c.startDate : Math.min(new Date(c.createdAt || c.startDate), new Date(c.startDate)));
   let until = new Date(dayStart(dubaiDay(c.endDate)).getTime() + DAY - 1); // free by the end of the check-out day
   const cancel = cancelledAt(c);
   if (cancel && new Date(cancel) < until) until = new Date(cancel);
   return { from: made, until };
}

/** When an issued quotation holds its units. Pure. */
export function quoteSpan(q, contractMadeAt = null) {
   const from = new Date(q.createdAt || q.quoteDate);
   const ends = [new Date(new Date(q.updatedAt || from).getTime() + QUOTE_HOLD_DAYS * DAY), new Date(dayStart(dubaiDay(q.expiryDate)).getTime() + DAY - 1)];
   if (contractMadeAt) ends.push(new Date(contractMadeAt));
   if (['rejected', 'expired'].includes(q.status)) ends.push(new Date(q.updatedAt));
   return { from, until: new Date(Math.min(...ends)), released: contractMadeAt && new Date(contractMadeAt) <= Math.min(...ends.slice(0, 2)) ? 'converted' : 'released' };
}

/**
 * The sheet for one Dubai day. Pure.
 * @param units      [{ _id, unitNumber, floor }] — rentable units only
 * @param contracts  every contract touching those units
 * @param quotes     issued quotations touching those units
 * @param paidContractIds  Set of contract ids with a payment received by the end of the day
 */
export function unitMovement({ units, contracts, quotes = [], paidContractIds = new Set(), day }) {
   const S = dayStart(day);
   const E = new Date(S.getTime() + DAY - 1);
   const inDay = (t) => t && new Date(t) >= S && new Date(t) <= E;
   const floorOf = new Map(units.map((u) => [String(u._id), u.floor || '—']));
   const numberOf = new Map(units.map((u) => [String(u._id), u.unitNumber]));
   const spans = contracts.map((c) => ({ c, ...holdSpan(c), ids: unitIdsOf(c).filter((id) => floorOf.has(id)) })).filter((x) => x.ids.length);
   // A contract made from a quotation takes its hold over; it is not a new reservation.
   const contractOfQuote = new Map(contracts.filter((c) => c.quote).map((c) => [String(c.quote), c]));
   const quoteIds = new Set(quotes.map((q) => String(q._id)));
   const qspans = quotes.map((q) => {
      const c = contractOfQuote.get(String(q._id));
      const ids = [...new Set((q.units || []).map((u) => String(u.unit)))].filter((id) => floorOf.has(id));
      return { c: { ...q, contractNo: q.quoteNo, isQuote: true }, ...quoteSpan(q, c?.createdAt), ids };
   }).filter((x) => x.ids.length && x.until > x.from);
   const heldAt = (t) => {
      const m = new Map();
      for (const x of qspans) if (x.from <= t && t < x.until) for (const id of x.ids) m.set(id, x.c);
      for (const x of spans) if (x.from <= t && t < x.until) for (const id of x.ids) m.set(id, x.c);
      return m;
   };
   const morning = heldAt(S);
   const eod = heldAt(E);

   const lists = { booked: [], checkOut: [], reserved: [], cancelled: [], notPaid: [] };
   const add = (key, id, c) => lists[key].push({ unit: numberOf.get(id), floor: floorOf.get(id), contractNo: c.contractNo || '' });
   for (const { c, ids } of spans) {
      const cancel = cancelledAt(c);
      for (const id of ids) {
         if (inDay(signedAt(c))) add('booked', id, c);
         if (!c.importedAt && inDay(c.createdAt) && !(c.quote && quoteIds.has(String(c.quote)))) add('reserved', id, c);
         if (inDay(cancel)) add('cancelled', id, c);
         if (c.status !== 'cancelled' && dubaiDay(c.endDate) === day && !eod.has(id)) add('checkOut', id, c);
      }
   }
   for (const { c, ids, from, until, released } of qspans) {
      for (const id of ids) {
         if (inDay(from)) add('reserved', id, c);
         if (released === 'released' && inDay(until) && !eod.has(id)) add('cancelled', id, c);
      }
   }
   for (const [id, c] of eod) {
      if (c.isQuote) { add('notPaid', id, c); continue; }
      const notIn = dubaiDay(c.startDate) > day || ['draft', 'pending_signature'].includes(c.status);
      if (notIn && !c.paymentGate?.verified && !paidContractIds.has(String(c._id))) add('notPaid', id, c);
   }

   const floors = [...new Set(units.map((u) => u.floor || '—'))].sort();
   const count = (list, f) => list.filter((x) => !f || x.floor === f).length;
   const freeAt = (held, f) => units.filter((u) => (!f || (u.floor || '—') === f) && !held.has(String(u._id))).length;
   const row = (f) => ({
      floor: f || 'Total', morning: freeAt(morning, f), booked: count(lists.booked, f), checkOut: count(lists.checkOut, f),
      reserved: count(lists.reserved, f), cancelled: count(lists.cancelled, f), eod: freeAt(eod, f), notPaid: count(lists.notPaid, f),
   });
   return { day, rows: [...floors.map(row), row(null)], lists };
}

export const MOVEMENT_COLUMNS = ['Floor', 'Morning', 'Booked', 'Check Out', 'Reserved', 'Reservation Cancelled', 'EOD', 'Reserved Not Paid'];

/** The sheet for a day, from the database. Read-only. */
export async function unitMovementFor({ day, scope = null }) {
   const hidden = await hiddenSiteIds();
   const units = await Unit.find({ ...(scope ? scope.unitFilter : {}), status: { $ne: 'maintenance' }, decommissioned: { $ne: true }, ...(hidden.length ? { site: { $nin: hidden } } : {}) })
      .select('unitNumber floor').lean();
   const ids = units.map((u) => u._id);
   const S = dayStart(day);
   const quotes = await Quote.find({
      'units.unit': { $in: ids },
      // Issued, or since turned down / expired (a reservation let go).
      $or: [...issuedQuoteFilter().$or, { status: { $in: ['rejected', 'expired'] } }],
      createdAt: { $lte: new Date(S.getTime() + DAY) }, updatedAt: { $gte: new Date(S.getTime() - (QUOTE_HOLD_DAYS + 1) * DAY) },
   }).select('quoteNo units createdAt quoteDate updatedAt expiryDate status').lean();
   const contracts = await Contract.find({
      $or: [{ unit: { $in: ids } }, { units: { $in: ids } }, { 'unitLines.unit': { $in: ids } }],
      endDate: { $gte: new Date(S.getTime() - 2 * DAY) },
   }).select('contractNo quote unit units unitLines startDate endDate status createdAt updatedAt importedAt timeline paymentGate').lean();
   const paid = await Payment.distinct('contract', { contract: { $in: contracts.map((c) => c._id) }, status: 'paid', paidDate: { $lte: new Date(S.getTime() + DAY) } });
   return unitMovement({ units, contracts, quotes, paidContractIds: new Set(paid.map(String)), day });
}
