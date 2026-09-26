/**
 * Public booking API for the marketing website — no login, no auth token.
 *
 * Two endpoints. The first checks a size, atomically claims one free unit,
 * and writes a real Lead + Quote so staff see it immediately in the CRM —
 * exactly as if someone had booked it inside the app. The second is called
 * by the *other* system once its own Stripe checkout (a different Stripe
 * account — this app never sees the card) has actually charged the customer.
 *
 * The claim is atomic (`Unit.findOneAndUpdate` with a `status: 'available'`
 * guard) so two visitors hitting this at the same instant for the same size
 * can never be handed the same unit — the loser simply tries the next
 * candidate. The hold itself is an ordinary Quote with a short `expiryDate`,
 * which is the exact field `computeUnitAvailability`/`heldByQuoteFilter`
 * already read to decide whether a hold is live — an unpaid hold needs no
 * special-case logic anywhere else, and the existing hourly
 * `releaseLapsedHolds()` sweep (now also run every 5 minutes, see index.js)
 * puts the unit back to `available` once it lapses.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { Unit, Customer, Lead, Quote, nextQuoteNo } from '../models/index.js';
import { computeUnitAvailability } from '../services/unitAvailability.js';
import { syncUnitStatus } from '../utils/unitStatus.js';

const router = Router();

// A real visitor never notices this; a script trying to lock up every unit
// of a size by repeatedly "booking" and never paying does. No login exists
// here for it to key off, so it is per-IP.
const bookingLimiter = rateLimit({
    windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests — please wait a minute and try again.' },
    // The integration tests exercise this route far more than 10 times a
    // minute on purpose (concurrent-claim races, one request per case); the
    // limiter itself has its own dedicated test in publicBooking.test.js.
    skip: () => process.env.NODE_ENV === 'test',
});

const HOLD_MINUTES = 15;
const DEFAULT_DURATION_WEEKS = 4; // one billing cycle — see billing-28day-logic

/** Whichever units of this size are free, cheapest/lowest number first. */
function candidatesFor(available, sizeSqf) {
    return available.allUnits
        .filter((u) => Number(u.sizeSqf) === Number(sizeSqf) && !available.bookedUnitIds.has(String(u._id)) && u.status !== 'maintenance')
        .sort((a, b) => (a.unitNumber || '').localeCompare(b.unitNumber || '', undefined, { numeric: true }));
}

/**
 * Try each candidate in order until one can be atomically flipped from
 * available to reserved. Returns the claimed unit, or null if every
 * candidate was taken by someone else between the read above and here.
 */
async function claimFirstAvailable(candidates) {
    for (const c of candidates) {
        const claimed = await Unit.findOneAndUpdate({ _id: c._id, status: 'available' }, { $set: { status: 'reserved' } }, { new: true });
        if (claimed) return claimed;
    }
    return null;
}

router.post('/', bookingLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const firstName = String(b.firstName || '').trim();
        const lastName = String(b.lastName || '').trim();
        const phone = String(b.phone || '').trim();
        const sizeSqf = Number(b.sizeSqf);
        if (!firstName || !lastName || !phone) return res.status(400).json({ error: 'firstName, lastName and phone are required' });
        if (!Number.isFinite(sizeSqf) || sizeSqf <= 0) return res.status(400).json({ error: 'sizeSqf must be a positive number' });

        const from = b.startDate ? new Date(b.startDate) : new Date();
        const durationWeeks = Number(b.durationWeeks) > 0 ? Number(b.durationWeeks) : DEFAULT_DURATION_WEEKS;
        const to = new Date(from.getTime() + durationWeeks * 7 * 86_400_000);

        const available = await computeUnitAvailability({ from, to });
        const candidates = candidatesFor(available, sizeSqf);
        const unit = await claimFirstAvailable(candidates);
        if (!unit) return res.json({ available: false, message: 'No unit available for that size' });

        try {
            const fullName = `${firstName} ${lastName}`.trim();
            const email = String(b.email || '').trim();

            let customer = phone ? await Customer.findOne({ phones: phone }) : null;
            if (!customer) customer = await Customer.create({ fullName, phone, phones: [phone].filter(Boolean), email });

            let lead = phone ? await Lead.findOne({ phone }) : null;
            if (!lead) {
                lead = await Lead.create({
                    firstName, lastName, fullName, phone, phoneNormalized: phone.replace(/\D/g, ''), email,
                    status: 'new', tags: ['website_booking'],
                    timeline: [{ at: new Date(), type: 'note', text: 'Booking started on the website — unit held pending payment.' }],
                });
            }

            const token = crypto.randomBytes(24).toString('hex');
            const rate = Number(unit.price) || 0;
            const quote = await Quote.create({
                quoteNo: await nextQuoteNo(),
                expiryDate: new Date(Date.now() + HOLD_MINUTES * 60_000),
                customer: customer._id,
                lead: lead._id,
                units: [{ unit: unit._id, unitNumber: unit.unitNumber, sizeSqf: unit.sizeSqf, floor: unit.floor, startDate: from, endDate: to, rate, amount: rate }],
                subTotal: rate,
                total: rate,
                status: 'sent',
                flowStep: 3,
                notes: 'Created by the public website booking API.',
                publicBooking: { token },
            });

            return res.status(201).json({
                bookingId: quote._id,
                unitNumber: unit.unitNumber,
                sizeSqf: unit.sizeSqf,
                expiresInMinutes: HOLD_MINUTES,
                confirmToken: token,
            });
        } catch (inner) {
            // The unit was already claimed above — never leave it reserved
            // with nothing behind it because the Lead/Quote write failed.
            await Unit.updateOne({ _id: unit._id }, { $set: { status: 'available' } });
            throw inner;
        }
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/:id/confirm-payment', bookingLimiter, async (req, res) => {
    try {
        const token = String(req.body?.token || '');
        if (!token) return res.status(400).json({ error: 'token is required' });

        const quote = await Quote.findById(req.params.id);
        if (!quote || !quote.publicBooking?.token) return res.status(404).json({ error: 'No such booking' });
        if (quote.publicBooking.token !== token) return res.status(401).json({ error: 'Wrong token for this booking' });
        if (quote.publicBooking.confirmedAt) return res.json({ ok: true }); // already confirmed — safe to call twice
        if (quote.expiryDate < new Date()) return res.status(410).json({ error: 'This hold has expired' });

        quote.status = 'accepted';
        quote.publicBooking.confirmedAt = new Date();
        quote.publicBooking.externalReference = String(req.body?.externalReference || '');
        // No longer an expiring hold now that it is paid — a real quotation's
        // ordinary validity window, not the 15-minute reservation window.
        quote.expiryDate = new Date(Date.now() + 30 * 86_400_000);
        await quote.save();

        for (const u of quote.units) await syncUnitStatus(u.unit);
        res.json({ ok: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

export default router;
