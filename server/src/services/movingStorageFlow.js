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
 */

import { Lead, MovingStorageFlowThread } from '../models/index.js';
import { isButtonReply, interactiveReplyId } from './renewalReply.js';
import { sendWhatsAppInteractiveButtons, sendWhatsAppInteractiveList, sendWhatsAppText, whatsappSendConfigured } from './whatsapp.js';

/* Adjust to the real price list — this is exactly the placeholder the
 * request asked for. */
export const STORAGE_PRICES = { 10: 'AED 350/mo', 25: 'AED 600/mo', 35: 'AED 900/mo', 50: 'AED 1400/mo' };
const SIZES = Object.keys(STORAGE_PRICES);

/** The size out of a "size_35"-shaped list-row id, or '' if it isn't one. */
export function sizeFromListId(id) {
    const m = /^size_(\d+)$/.exec(String(id || ''));
    return m ? m[1] : '';
}

/** The size out of a "reserve_35" / "price_35"-shaped button id. */
export function sizeFromActionId(prefix, id) {
    const m = new RegExp(`^${prefix}_(\\d+)$`).exec(String(id || ''));
    return m ? m[1] : '';
}

/** The price for a size, or '' if it isn't one of the listed ones. */
export function priceFor(size) {
    return STORAGE_PRICES[size] || '';
}

// ── The messages each step sends — pure builders, no I/O, so the wording
//    can be unit-tested without a phone number or a mock server. ──────────

export function serviceMenu() {
    return {
        bodyText: 'Hi! Are you looking for Moving or Storage services?',
        buttons: [
            { id: 'svc_moving', title: 'Moving' },
            { id: 'svc_storage', title: 'Storage' },
        ],
    };
}

export function sizeMenu() {
    return {
        bodyText: 'What size storage are you looking for?',
        buttonLabel: 'View Sizes',
        rows: [
            ...SIZES.map((s) => ({ id: `size_${s}`, title: `${s} sqft` })),
            { id: 'size_help', title: 'Need Help Choosing' },
        ],
    };
}

export function reserveOrPriceMenu(size) {
    return {
        bodyText: `Great, a ${size} sqft unit — would you like to reserve it or know the pricing first?`,
        buttons: [
            { id: `reserve_${size}`, title: 'Reserve' },
            { id: `price_${size}`, title: 'Pricing' },
        ],
    };
}

/** Sent when a rep or a colleague should pick this up from here — the
 *  Moving branch and "Need Help Choosing" are both a handoff for now. */
function handoffMessage() {
    return "Thanks! A member of our team will follow up shortly to help with this.";
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
                const { bodyText, buttonLabel, rows } = sizeMenu();
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
            if (size && SIZES.includes(size)) {
                thread.size = size;
                thread.step = 'awaiting_size_or_reserve';
                await thread.save();
                const { bodyText, buttons } = reserveOrPriceMenu(size);
                await sendWhatsAppInteractiveButtons({ to, bodyText, buttons });
                return { handled: true, step: thread.step };
            }
            const { bodyText, buttonLabel, rows } = sizeMenu();
            await sendWhatsAppInteractiveList({ to, bodyText, buttonLabel, rows });
            return { handled: true, step: thread.step };
        }

        if (thread.step === 'awaiting_size_or_reserve') {
            const reserveSize = sizeFromActionId('reserve', replyId);
            if (reserveSize) {
                thread.step = 'awaiting_name';
                await thread.save();
                await sendWhatsAppText({ to, body: "Great! Let's get your reservation started — what's your full name?" });
                return { handled: true, step: thread.step };
            }
            const priceSize = sizeFromActionId('price', replyId);
            if (priceSize) {
                const price = priceFor(priceSize) || 'to be confirmed by our team';
                thread.step = 'done';
                thread.completedAt = new Date();
                await thread.save();
                await sendWhatsAppText({ to, body: `A ${priceSize} sqft unit is ${price}. Just message us any time if you'd like to reserve it.` });
                return { handled: true, step: thread.step };
            }
            const { bodyText, buttons } = reserveOrPriceMenu(thread.size);
            await sendWhatsAppInteractiveButtons({ to, bodyText, buttons });
            return { handled: true, step: thread.step };
        }

        /* The reservation collection: name, then a contact number, then a
         * move-in date — one question at a time, each a plain text answer
         * rather than a button, so it takes whatever they type. */
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
            thread.step = 'awaiting_move_in_date';
            await thread.save();
            await sendWhatsAppText({ to, body: 'Got it — what move-in date works for you?' });
            return { handled: true, step: thread.step };
        }

        if (thread.step === 'awaiting_move_in_date') {
            const moveInDate = String(text || '').trim();
            if (!moveInDate) {
                await sendWhatsAppText({ to, body: 'What move-in date works for you?' });
                return { handled: true, step: thread.step };
            }
            thread.reservation.moveInDate = moveInDate;
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
                    lead.timeline.push({
                        type: 'note',
                        text: `WhatsApp reservation request: ${thread.size} sqft, move-in ${moveInDate}, name ${thread.reservation.name}, contact ${thread.reservation.contactPhone}`,
                    });
                    await lead.save();
                }
            } catch (e) {
                console.error('[MovingStorageFlow] could not update the lead:', e.message);
            }

            await sendWhatsAppText({
                to,
                body: `You're all set, ${thread.reservation.name}! We've noted your reservation for a ${thread.size} sqft unit, moving in ${moveInDate}. Our team will confirm shortly.`,
            });
            return { handled: true, step: thread.step };
        }

        return { handled: false };
    } catch (e) {
        console.error('[MovingStorageFlow]', e.message);
        return { handled: false, error: e.message };
    }
}
