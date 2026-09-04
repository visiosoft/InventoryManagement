import { Unit, Contract, Quote } from '../models/index.js';
import { HOLDING_STATUSES } from '../utils/unitStatus.js';

/**
 * Which units are taken over a date window, and by what.
 *
 * A unit is unavailable if an active or pending-signature contract overlaps the
 * window, or if an open quote holds it — a quotation is a promise we have
 * already made, so treating it as free would let us sell it twice.
 *
 * Which quote statuses count is decided once, in utils/unitStatus.js, and
 * imported here. The two used to disagree: this asked for 'sent' or 'accepted'
 * and no quote on production has ever been marked sent, because the team
 * downloads the PDF and sends it by hand. So the picker offered units that had
 * been quoted to somebody — F2-64 was offered as free while a quotation for it
 * sat with a customer.
 *
 * Extracted from GET /quotes/available-units so the availability answer the AI
 * assistant gives a customer is computed by the same code that the booking
 * screens use, rather than a second copy that can drift.
 */
export async function computeUnitAvailability({ from = null, to = null, includeAll = false } = {}) {
    const unitFilter = includeAll ? {} : { status: { $in: ['available', 'reserved'] } };
    const allUnits = await Unit.find(unitFilter).sort({ unitNumber: 1 }).lean();

    const bookedUnitIds = new Set();
    // unitId -> booking details, for hover tooltips in the unit picker
    const bookingMap = new Map();
    const addBooking = (unitId, entry) => {
        const key = String(unitId);
        if (!bookingMap.has(key)) bookingMap.set(key, []);
        bookingMap.get(key).push(entry);
    };

    const openContracts = await Contract.find({ status: { $in: ['active', 'pending_signature'] } })
        .select('contractNo customer unit units startDate endDate status')
        .populate('customer', 'fullName')
        .lean();

    for (const c of openContracts) {
        const unitIds = [c.unit, ...(c.units || [])].filter(Boolean).map(String);
        const overlaps = from && to && new Date(c.startDate) <= to && new Date(c.endDate) >= from;
        for (const uid of new Set(unitIds)) {
            if (overlaps) {
                bookedUnitIds.add(uid);
                addBooking(uid, { kind: 'contract', ref: c.contractNo, customer: c.customer?.fullName || '', startDate: c.startDate, endDate: c.endDate, status: c.status });
            } else if (includeAll) {
                // Current tenancy that does not clash with the requested period
                addBooking(uid, { kind: 'current', ref: c.contractNo, customer: c.customer?.fullName || '', startDate: c.startDate, endDate: c.endDate, status: c.status });
            }
        }
    }

    if (from && to) {
        const openQuotes = await Quote.find({
            status: { $in: HOLDING_STATUSES },
            // A quote nobody can accept any more is not a promise being kept.
            expiryDate: { $gte: new Date() },
            'units.startDate': { $lte: to },
            'units.endDate': { $gte: from },
        })
            .select('quoteNo customer units status contract')
            .populate('customer', 'fullName')
            .lean();

        // A quote that has already become a contract is not a hold of its own:
        // the contract decides. Once that contract ends or is cancelled, the
        // unit is free — but the quote stays "accepted" forever, so counting it
        // separately kept the unit blocked for good. F2-37 was still showing as
        // taken until 28 August on a quote whose contract ended on the 27th.
        //
        // A quote whose contract row has since been deleted is treated the same
        // way: there is nothing left to honour.
        const contractIds = openQuotes.map((q) => q.contract).filter(Boolean);
        const liveContracts = contractIds.length
            ? await Contract.find({
                _id: { $in: contractIds },
                status: { $nin: ['ended', 'cancelled'] },
            }).select('_id').lean()
            : [];
        const stillLive = new Set(liveContracts.map((c) => String(c._id)));
        const holdsUnit = (q) => !q.contract || stillLive.has(String(q.contract));

        for (const q of openQuotes.filter(holdsUnit)) {
            for (const u of q.units || []) {
                if (new Date(u.startDate) <= to && new Date(u.endDate) >= from) {
                    const uid = String(u.unit);
                    bookedUnitIds.add(uid);
                    addBooking(uid, { kind: 'quote', ref: q.quoteNo, customer: q.customer?.fullName || '', startDate: u.startDate, endDate: u.endDate, status: q.status });
                }
            }
        }
    }

    return { allUnits, bookedUnitIds, bookingMap };
}

/**
 * The shape GET /quotes/available-units returns: every unit flagged when
 * `includeAll`, otherwise only the ones free across the window.
 */
export async function availableUnitsResponse({ from, to, includeAll }) {
    const { allUnits, bookedUnitIds, bookingMap } = await computeUnitAvailability({ from, to, includeAll });

    if (includeAll) {
        return allUnits.map((u) => ({
            ...u,
            bookedInPeriod: bookedUnitIds.has(u._id.toString()),
            bookings: bookingMap.get(u._id.toString()) || [],
        }));
    }

    if (!from || !to) return allUnits;
    return allUnits.filter((u) => !bookedUnitIds.has(u._id.toString()));
}
