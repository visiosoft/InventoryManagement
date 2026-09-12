/**
 * A fixed button/list menu for a moving-or-storage inquiry, in place of the
 * AI assistant's own first reply — see the movingStorageFlowEnabled setting
 * on AiBotConfig (Settings → AI Assistant). Off by default: a number either
 * gets this rigid menu or the assistant's own judgement, never both fighting
 * over who answers first.
 *
 * One document per phone number (MovingStorageFlowThread) holds a plain step
 * order, deliberately apart from AiBotThread — that one is the assistant's
 * own claim/draft/escalate lifecycle, this is a form with a fixed shape, and
 * conflating the two would mean either could clobber the other's idea of
 * what's happening on this number.
 *
 * Called from whatsappLeadSync.js in the same slot handleRenewalButtonReply
 * already occupies: checked before the assistant is told anything, and when
 * it claims the message the assistant is not told at all. Everything it
 * does not recognise — a stray button from some other template, a phone
 * with no thread at all reached from an interactive reply rather than a
 * fresh text — is left alone and falls through untouched.
 *
 * Sizes and pricing shown here are real units read live from the same
 * Unit collection the booking screens use (see sizeRowsFromUnits), not a
 * fixed table — a discount or a new unit added in the console shows up on
 * the next message without touching this file. Once a customer gives a
 * date range, the specific unit offered is picked by computeUnitAvailability
 * (services/unitAvailability.js) — the exact function the "Book Unit"
 * wizard and the AI assistant's own availability answers already use, so
 * this can't offer a unit that is actually quoted or contracted elsewhere.
 */

import { Lead, MovingStorageFlowThread, Unit } from '../models/index.js';
import { computeUnitAvailability } from './unitAvailability.js';
import { isButtonReply, interactiveReplyId, isFlowReply, flowReplyData } from './renewalReply.js';
import {
    sendWhatsAppInteractiveButtons, sendWhatsAppInteractiveList, sendWhatsAppInteractiveFlow,
    sendWhatsAppText, whatsappSendConfigured,
} from './whatsapp.js';

/** Set once the "Booking Dates" Flow (a real in-chat calendar — two
 *  DatePicker fields, from_date/to_date) is created and published in
 *  WhatsApp Manager — paste scripts/booking-dates-flow.json into its Flow
 *  JSON editor, publish, and put the flow id this env var. Until then, the
 *  awaiting_date_from/awaiting_date_to plain-text questions are used
 *  instead — the bot works either way, this only decides which. */
export function bookingDatesFlowId() {
    return String(process.env.WHATSAPP_BOOKING_DATES_FLOW_ID || '').trim();
}

// ── Pure helpers — no I/O, so they're unit-testable without a DB. ────────

/** Groups a flat unit list into per-size rows: count and price range. */
export function sizeRowsFromUnits(units) {
    const bySize = new Map();
    for (const u of units || []) {
        const size = Number(u.sizeSqf);
        if (!(size > 0)) continue;
        const row = bySize.get(size) || { size, count: 0, prices: [] };
        row.count += 1;
        if (Number(u.price) > 0) row.prices.push(Number(u.price));
        bySize.set(size, row);
    }
    return [...bySize.values()]
        .sort((a, b) => a.size - b.size)
        .map(({ size, count, prices }) => ({
            size,
            count,
            minPrice: prices.length ? Math.min(...prices) : null,
            maxPrice: prices.length ? Math.max(...prices) : null,
        }));
}

/** "AED 600/mo" or "AED 600–900/mo", or a fallback when nothing is priced. */
export function priceLabelFor(row) {
    if (!row || row.minPrice == null) return 'price on request';
    return row.minPrice === row.maxPrice ? `AED ${row.minPrice}/mo` : `AED ${row.minPrice}–${row.maxPrice}/mo`;
}

/** The size out of a "size_35"-shaped list-row id, or '' if it isn't one. */
export function sizeFromListId(id) {
    const m = /^size_(\d+)$/.exec(String(id || ''));
    return m ? m[1] : '';
}

/** A loose date parse: DD/MM/YYYY (or DD-MM-YYYY, UAE convention, day
 *  first) is read explicitly so it isn't misread as month-first; anything
 *  else — an ISO date, "20 Sep 2026" — falls back to native parsing.
 *  Returns null rather than an Invalid Date so callers can just check it. */
export function parseFlexibleDate(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
    if (dmy) {
        const day = Number(dmy[1]);
        const month = Number(dmy[2]);
        const year = Number(dmy[3]);
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
        const dt = new Date(Date.UTC(year, month - 1, day));
        return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const dt = new Date(s);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

/** "20 Sep 2026", or '' for anything that isn't a real date. */
export function formatDate(d) {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ── The messages each step sends — pure builders. ─────────────────────────

export function serviceMenu() {
    return {
        bodyText: 'Hi! Are you looking for Moving or Storage services?',
        buttons: [
            { id: 'svc_moving', title: 'Moving' },
            { id: 'svc_storage', title: 'Storage' },
        ],
    };
}

/** sizeRows is the sizeRowsFromUnits() output — real, live availability. */
export function sizeMenu(sizeRows) {
    return {
        bodyText: 'Here are our available unit sizes and pricing:',
        buttonLabel: 'View Sizes',
        rows: [
            ...(sizeRows || []).slice(0, 9).map((row) => ({
                id: `size_${row.size}`,
                title: `${row.size} sqft`,
                description: `${row.count} available · ${priceLabelFor(row)}`,
            })),
            { id: 'size_help', title: 'Need Help Choosing' },
        ],
    };
}

export function dateFromPrompt() {
    return 'What date would you like the rental to start from? (e.g. 20/09/2026)';
}

export function dateToPrompt() {
    return 'And until what date do you need it? (e.g. 20/12/2026)';
}

/** The body text shown alongside the "Choose Dates" calendar flow. */
export function datesFlowPrompt(size) {
    return `Great, a ${size} sqft unit — tap below to pick the dates you need it for.`;
}

/** The message once a live check finds a real unit free for those dates. */
export function bookingConfirmationMessage({ unitNumber, size, price, from, to }) {
    const priceText = Number(price) > 0 ? `AED ${price}/month` : 'pricing to be confirmed by our team';
    return (
        `Sure, I'll help you book unit ${unitNumber} (${size} sqft) right away! ` +
        `It's ${priceText}, available ${formatDate(from)} to ${formatDate(to)}. ` +
        `Let's get your reservation started — what's your full name?`
    );
}

/** No unit of that size is free for the dates given. */
export function noAvailabilityMessage({ size, from, to }) {
    return (
        `We don't have a ${size} sqft unit free from ${formatDate(from)} to ${formatDate(to)} right now. ` +
        `A member of our team will follow up shortly with the closest options.`
    );
}

/** Sent when a rep or a colleague should pick this up from here — the
 *  Moving branch and "Need Help Choosing" are both a handoff for now. */
function handoffMessage() {
    return "Thanks! A member of our team will follow up shortly to help with this.";
}

/** Sends the "Choose Dates" calendar flow — the one I/O step both the
 *  first offer and any resend (an ignored tap, a malformed submission)
 *  share, so the wording only lives in one place. */
async function sendDatesFlow({ to, phoneNormalized, size, flowId }) {
    await sendWhatsAppInteractiveFlow({
        to,
        bodyText: datesFlowPrompt(size),
        flowId,
        flowCta: 'Choose Dates',
        screenId: 'DATES',
        flowToken: `mvst.${phoneNormalized}`,
    });
}

/** Once both ends of a date range are in hand — from either the calendar
 *  flow or the plain-text fallback — the rest is identical: check real
 *  availability, offer the unit found (or hand off), and save it on the
 *  thread. Mutates and saves `thread`; sends exactly one message. */
async function resolveDatesAndOfferUnit({ thread, to, from, to_ }) {
    thread.reservation.startDate = from;
    thread.reservation.endDate = to_;

    const { allUnits, bookedUnitIds } = await computeUnitAvailability({ from, to: to_ });
    const candidate = allUnits.find(
        (u) => Number(u.sizeSqf) === Number(thread.size) && !bookedUnitIds.has(String(u._id))
    );

    if (!candidate) {
        thread.step = 'done';
        thread.completedAt = new Date();
        await thread.save();
        await sendWhatsAppText({ to, body: noAvailabilityMessage({ size: thread.size, from, to: to_ }) });
        return;
    }

    thread.unit = candidate._id;
    thread.unitNumber = candidate.unitNumber;
    thread.monthlyPrice = candidate.price ?? null;
    thread.step = 'awaiting_name';
    await thread.save();
    await sendWhatsAppText({
        to,
        body: bookingConfirmationMessage({ unitNumber: candidate.unitNumber, size: thread.size, price: candidate.price, from, to: to_ }),
    });
}

/**
 * One inbound message. Returns { handled: boolean } so the caller — same as
 * handleRenewalButtonReply — knows whether to tell the assistant about it at
 * all.
 *
 * Never throws: a webhook must not fail because a menu did not go out.
 */
export async function handleMovingStorageFlow({ phoneNormalized, phone, text, type, raw, config }) {
    try {
        if (!config?.movingStorageFlowEnabled) return { handled: false };
        if (!whatsappSendConfigured()) return { handled: false };
        if (!phoneNormalized) return { handled: false };

        const to = phone || phoneNormalized;
        const isReply = isButtonReply(raw, type);
        const replyId = isReply ? interactiveReplyId(raw) : '';

        let thread = await MovingStorageFlowThread.findOne({ phoneNormalized });

        /* No prior state for this number: only a fresh text message opens the
         * menu (a button tap that lands here with nothing on record belongs
         * to some other template — a renewal reminder, a quick reply — and
         * is left alone rather than guessed at). */
        if (!thread) {
            if (type !== 'text' || isReply) return { handled: false };
            thread = await MovingStorageFlowThread.create({ phoneNormalized, step: 'awaiting_service' });
            const { bodyText, buttons } = serviceMenu();
            await sendWhatsAppInteractiveButtons({ to, bodyText, buttons });
            return { handled: true, step: thread.step };
        }

        // The flow has already run its course on this number — whatever
        // comes next is a fresh conversation, for the assistant or a person.
        if (thread.step === 'done') return { handled: false };

        // From here on this number has an active flow, so every message on
        // it — a tap or a stray line of text — is answered here, never
        // handed to the assistant mid-form.

        if (thread.step === 'awaiting_service') {
            if (replyId === 'svc_storage') {
                thread.service = 'storage';
                thread.step = 'awaiting_size';
                await thread.save();
                const units = await Unit.find({ status: { $ne: 'maintenance' } }).select('sizeSqf price').lean();
                const { bodyText, buttonLabel, rows } = sizeMenu(sizeRowsFromUnits(units));
                await sendWhatsAppInteractiveList({ to, bodyText, buttonLabel, rows });
                return { handled: true, step: thread.step };
            }
            if (replyId === 'svc_moving') {
                thread.service = 'moving';
                thread.step = 'done';
                thread.completedAt = new Date();
                await thread.save();
                await sendWhatsAppText({ to, body: handoffMessage() });
                return { handled: true, step: thread.step };
            }
            const { bodyText, buttons } = serviceMenu();
            await sendWhatsAppInteractiveButtons({ to, bodyText, buttons });
            return { handled: true, step: thread.step };
        }

        if (thread.step === 'awaiting_size') {
            if (replyId === 'size_help') {
                thread.step = 'done';
                thread.completedAt = new Date();
                await thread.save();
                await sendWhatsAppText({ to, body: handoffMessage() });
                return { handled: true, step: thread.step };
            }
            const size = sizeFromListId(replyId);
            if (size) {
                thread.size = size;
                const flowId = bookingDatesFlowId();
                if (flowId) {
                    thread.step = 'awaiting_dates';
                    await thread.save();
                    await sendDatesFlow({ to, phoneNormalized, size, flowId });
                } else {
                    thread.step = 'awaiting_date_from';
                    await thread.save();
                    await sendWhatsAppText({ to, body: dateFromPrompt() });
                }
                return { handled: true, step: thread.step };
            }
            const units = await Unit.find({ status: { $ne: 'maintenance' } }).select('sizeSqf price').lean();
            const { bodyText, buttonLabel, rows } = sizeMenu(sizeRowsFromUnits(units));
            await sendWhatsAppInteractiveList({ to, bodyText, buttonLabel, rows });
            return { handled: true, step: thread.step };
        }

        /* The real calendar — a WhatsApp Flow — replies as a single
         * nfm_reply carrying both dates once submitted, not a button tap
         * or free text; anything else here is resent the same flow rather
         * than misread as an attempt to type a date. */
        if (thread.step === 'awaiting_dates') {
            const flowId = bookingDatesFlowId();
            if (!isFlowReply(raw)) {
                await sendDatesFlow({ to, phoneNormalized, size: thread.size, flowId });
                return { handled: true, step: thread.step };
            }
            const data = flowReplyData(raw);
            const from = parseFlexibleDate(data.from_date);
            const to_ = parseFlexibleDate(data.to_date);
            if (!from || !to_ || to_ <= from) {
                await sendWhatsAppText({ to, body: "Sorry, that date range didn't come through right — let's try again." });
                await sendDatesFlow({ to, phoneNormalized, size: thread.size, flowId });
                return { handled: true, step: thread.step };
            }
            await resolveDatesAndOfferUnit({ thread, to, from, to_ });
            return { handled: true, step: thread.step };
        }

        if (thread.step === 'awaiting_date_from') {
            const from = parseFlexibleDate(text);
            if (!from) {
                await sendWhatsAppText({ to, body: `Sorry, I didn't catch that date — ${dateFromPrompt()}` });
                return { handled: true, step: thread.step };
            }
            thread.reservation.startDate = from;
            thread.step = 'awaiting_date_to';
            await thread.save();
            await sendWhatsAppText({ to, body: dateToPrompt() });
            return { handled: true, step: thread.step };
        }

        if (thread.step === 'awaiting_date_to') {
            const to_ = parseFlexibleDate(text);
            const from = thread.reservation.startDate;
            if (!to_ || to_ <= from) {
                await sendWhatsAppText({ to, body: `Sorry, that needs to be a date after ${formatDate(from)} — ${dateToPrompt()}` });
                return { handled: true, step: thread.step };
            }
            await resolveDatesAndOfferUnit({ thread, to, from, to_ });
            return { handled: true, step: thread.step };
        }

        /* The reservation collection: name, then a contact number — one
         * question at a time, each a plain text answer rather than a
         * button, so it takes whatever they type. */
        if (thread.step === 'awaiting_name') {
            const name = String(text || '').trim();
            if (!name) {
                await sendWhatsAppText({ to, body: "Sorry, I didn't catch that — what's your full name?" });
                return { handled: true, step: thread.step };
            }
            thread.reservation.name = name;
            thread.step = 'awaiting_phone';
            await thread.save();
            await sendWhatsAppText({ to, body: `Thanks, ${name}! What's the best phone number to reach you on?` });
            return { handled: true, step: thread.step };
        }

        if (thread.step === 'awaiting_phone') {
            const contactPhone = String(text || '').trim();
            if (!contactPhone) {
                await sendWhatsAppText({ to, body: "What's the best phone number to reach you on?" });
                return { handled: true, step: thread.step };
            }
            thread.reservation.contactPhone = contactPhone;
            thread.step = 'done';
            thread.completedAt = new Date();
            await thread.save();

            /* Onto the actual CRM record, not just this flow's own thread —
             * every inbound WhatsApp message already has a Lead for its
             * number by the time this runs (whatsappLeadSync.js's own
             * pipeline), so this updates it rather than creating a second
             * one. Never blocks the confirmation reply if it fails. */
            try {
                const lead = await Lead.findOne({ phoneNormalized });
                if (lead) {
                    lead.storageSizeValue = Number(thread.size) || lead.storageSizeValue;
                    lead.storageSizeUnit = 'sqft';
                    lead.intendedStartDate = thread.reservation.startDate;
                    lead.bookingEndDate = thread.reservation.endDate;
                    lead.selectedUnit = thread.unit;
                    lead.timeline.push({
                        type: 'note',
                        text: `WhatsApp reservation request: unit ${thread.unitNumber} (${thread.size} sqft) at AED ${thread.monthlyPrice ?? '—'}/mo, ${formatDate(thread.reservation.startDate)} to ${formatDate(thread.reservation.endDate)}, name ${thread.reservation.name}, contact ${thread.reservation.contactPhone}`,
                    });
                    await lead.save();
                }
            } catch (e) {
                console.error('[MovingStorageFlow] could not update the lead:', e.message);
            }

            await sendWhatsAppText({
                to,
                body: `You're all set, ${thread.reservation.name}! We've noted your reservation for unit ${thread.unitNumber} (${thread.size} sqft), ${formatDate(thread.reservation.startDate)} to ${formatDate(thread.reservation.endDate)}. Our team will confirm shortly.`,
            });
            return { handled: true, step: thread.step };
        }

        return { handled: false };
    } catch (e) {
        console.error('[MovingStorageFlow]', e.message);
        return { handled: false, error: e.message };
    }
}
