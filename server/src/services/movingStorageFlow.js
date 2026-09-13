/**
 * Runs whichever WhatsAppFlowTemplate is currently active (Settings →
 * WhatsApp Flow Templates), in place of the AI assistant's own first
 * reply. Off whenever no template is active: a number either gets this
 * fixed menu or the assistant's own judgement, never both fighting over
 * who answers first.
 *
 * One document per phone number (MovingStorageFlowThread) holds a plain
 * position in the template's steps, deliberately apart from AiBotThread —
 * that one is the assistant's own claim/draft/escalate lifecycle, this one
 * just walks a template in order, and conflating the two would mean either
 * could clobber the other's idea of what's happening on this number.
 *
 * Called from whatsappLeadSync.js in the same slot handleRenewalButtonReply
 * already occupies: checked before the assistant is told anything, and when
 * it claims the message the assistant is not told at all. Everything it
 * does not recognise — a stray button from some other template, a phone
 * with no thread at all reached from an interactive reply rather than a
 * fresh text — is left alone and falls through untouched.
 *
 * Every template is built from five step kinds; only two carry real
 * business logic, reused unchanged from before this became editable:
 *   - size_list reads real, live units (see sizeRowsFromUnits) — a
 *     discount or a new unit added in the console shows up on the next
 *     message without editing any template.
 *   - date_range hands the picked window to computeUnitAvailability
 *     (services/unitAvailability.js) — the exact function the "Book Unit"
 *     wizard and the AI assistant's own availability answers already use,
 *     so this can't offer a unit that is actually quoted or contracted
 *     elsewhere.
 * The other three (buttons, text_question, handoff) are just wording and
 * branching, which is what makes a template editable at all.
 */

import { Lead, MovingStorageFlowThread, Unit, WhatsAppFlowTemplate } from '../models/index.js';
import { computeUnitAvailability } from './unitAvailability.js';
import { ensureDefaultFlowTemplate, getActiveFlowTemplate, fillPlaceholders, DEFAULT_HANDOFF_TEXT } from './whatsappFlowTemplates.js';
import { isButtonReply, interactiveReplyId, isFlowReply, flowReplyData } from './renewalReply.js';
import {
    sendWhatsAppInteractiveButtons, sendWhatsAppInteractiveList, sendWhatsAppInteractiveFlow,
    sendWhatsAppText, whatsappSendConfigured,
} from './whatsapp.js';

/** Set once the "Booking Dates" Flow (a real in-chat calendar — two
 *  DatePicker fields, from_date/to_date) is created and published in
 *  WhatsApp Manager — paste scripts/booking-dates-flow.json into its Flow
 *  JSON editor, publish, and put the flow id in this env var. Until then, a
 *  date_range step falls back to two plain-text questions — the bot works
 *  either way, this only decides which. */
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

/** The option index out of an "opt_2"-shaped button id, or -1. */
export function optionIndexFromId(id) {
    const m = /^opt_(\d+)$/.exec(String(id || ''));
    return m ? Number(m[1]) : -1;
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

export function dateFromPrompt() {
    return 'What date would you like the rental to start from? (e.g. 20/09/2026)';
}

export function dateToPrompt() {
    return 'And until what date do you need it? (e.g. 20/12/2026)';
}

/** The {token} values known so far on this thread — used to fill a step's
 *  prompt/confirmation/completion/handoff text. A token with nothing to
 *  fill it drops out (see fillPlaceholders) rather than showing literally. */
function threadVars(thread) {
    return {
        size: thread.size || '',
        unitNumber: thread.unitNumber || '',
        price: Number(thread.monthlyPrice) > 0 ? `AED ${thread.monthlyPrice}/month` : '',
        from: formatDate(thread.reservation?.startDate),
        to: formatDate(thread.reservation?.endDate),
        name: thread.reservation?.name || '',
    };
}

/** Builds and sends whichever WhatsApp message a size_list step's rows are
 *  today — real units, queried fresh every time. */
async function sendSizeList({ to, step }) {
    const units = await Unit.find({ status: { $ne: 'maintenance' } }).select('sizeSqf price').lean();
    const rows = sizeRowsFromUnits(units).slice(0, 9).map((row) => ({
        id: `size_${row.size}`,
        title: `${row.size} sqft`,
        description: `${row.count} available · ${priceLabelFor(row)}`,
    }));
    if (step.helpOptionLabel) rows.push({ id: 'size_help', title: step.helpOptionLabel });
    await sendWhatsAppInteractiveList({ to, bodyText: fillPlaceholders(step.prompt, {}), buttonLabel: step.listButtonLabel || 'Choose', rows });
}

/** Sends a date_range step's opening question — a real calendar (a
 *  WhatsApp Flow) once WHATSAPP_BOOKING_DATES_FLOW_ID is configured,
 *  otherwise the first of two plain-text questions. Sets thread.dateSubStep
 *  so the next reply is read correctly; does not save the thread. */
async function startDateRange({ thread, to, phoneNormalized, step }) {
    const flowId = bookingDatesFlowId();
    if (flowId) {
        thread.dateSubStep = 'awaiting_flow';
        await sendWhatsAppInteractiveFlow({
            to,
            bodyText: fillPlaceholders(step.prompt, threadVars(thread)),
            flowId,
            flowCta: 'Choose Dates',
            screenId: 'DATES',
            flowToken: `mvst.${phoneNormalized}`,
        });
    } else {
        thread.dateSubStep = 'awaiting_from';
        await sendWhatsAppText({ to, body: dateFromPrompt() });
    }
}

/** Sends whichever message opens the step at `stepIndex` and saves the
 *  thread's new position. The one place that decides "what does entering
 *  this step look like" — reused for the very first step and for every
 *  advance afterwards. */
async function enterStep({ thread, template, to, phoneNormalized, stepIndex }) {
    thread.stepIndex = stepIndex;
    thread.dateSubStep = '';
    const step = template.steps[stepIndex];
    const v = threadVars(thread);

    if (step.kind === 'buttons') {
        await thread.save();
        await sendWhatsAppInteractiveButtons({
            to,
            bodyText: fillPlaceholders(step.prompt, v),
            buttons: (step.options || []).slice(0, 3).map((o, i) => ({ id: `opt_${i}`, title: o.label })),
        });
        return;
    }
    if (step.kind === 'size_list') {
        await thread.save();
        await sendSizeList({ to, step });
        return;
    }
    if (step.kind === 'date_range') {
        await startDateRange({ thread, to, phoneNormalized, step });
        await thread.save();
        return;
    }
    if (step.kind === 'text_question') {
        await thread.save();
        await sendWhatsAppText({ to, body: fillPlaceholders(step.prompt, v) });
        return;
    }
    // 'handoff' — an explicit end-of-flow step, not something a customer
    // answers; entering it ends the conversation immediately.
    thread.done = true;
    thread.completedAt = new Date();
    await thread.save();
    await sendWhatsAppText({ to, body: fillPlaceholders(step.prompt, v) || fillPlaceholders(template.handoffText, v) || DEFAULT_HANDOFF_TEXT });
}

/** The generic "this step is done, what's next" — the next step if there
 *  is one, otherwise the Lead is updated and the template's completion
 *  message goes out. Every step kind's success path ends here. */
async function advanceOrFinish({ thread, template, to, phoneNormalized, nextIndex }) {
    if (nextIndex < template.steps.length) {
        await enterStep({ thread, template, to, phoneNormalized, stepIndex: nextIndex });
        return;
    }

    thread.done = true;
    thread.completedAt = new Date();
    await thread.save();

    /* Onto the actual CRM record, not just this flow's own thread — every
     * inbound WhatsApp message already has a Lead for its number by the
     * time this runs (whatsappLeadSync.js's own pipeline), so this updates
     * it rather than creating a second one. Only ever sets what this
     * conversation actually collected — a template that never asks for a
     * size or dates leaves those fields alone. Never blocks the
     * confirmation reply if it fails. */
    try {
        const lead = await Lead.findOne({ phoneNormalized: thread.phoneNormalized });
        if (lead) {
            if (thread.size) {
                lead.storageSizeValue = Number(thread.size) || lead.storageSizeValue;
                lead.storageSizeUnit = 'sqft';
            }
            if (thread.reservation?.startDate) lead.intendedStartDate = thread.reservation.startDate;
            if (thread.reservation?.endDate) lead.bookingEndDate = thread.reservation.endDate;
            if (thread.unit) lead.selectedUnit = thread.unit;

            const parts = [];
            if (thread.unitNumber) parts.push(`unit ${thread.unitNumber}`);
            if (thread.size) parts.push(`(${thread.size} sqft)`);
            if (Number(thread.monthlyPrice) > 0) parts.push(`at AED ${thread.monthlyPrice}/mo`);
            if (thread.reservation?.startDate && thread.reservation?.endDate) {
                parts.push(`${formatDate(thread.reservation.startDate)} to ${formatDate(thread.reservation.endDate)}`);
            }
            if (thread.reservation?.name) parts.push(`name ${thread.reservation.name}`);
            if (thread.reservation?.contactPhone) parts.push(`contact ${thread.reservation.contactPhone}`);
            if (parts.length) lead.timeline.push({ type: 'note', text: `WhatsApp reservation request: ${parts.join(', ')}` });

            await lead.save();
        }
    } catch (e) {
        console.error('[MovingStorageFlow] could not update the lead:', e.message);
    }

    const body = fillPlaceholders(template.completionText, threadVars(thread));
    if (body) await sendWhatsAppText({ to, body });
}

/** A date_range step's reply resolved into a real from/to window — checks
 *  real availability and either offers the unit found or ends the
 *  conversation, exactly as before this became a template. */
async function resolveDateRange({ thread, template, to, phoneNormalized, from, toDate }) {
    const step = template.steps[thread.stepIndex];
    thread.reservation.startDate = from;
    thread.reservation.endDate = toDate;

    const { allUnits, bookedUnitIds } = await computeUnitAvailability({ from, to: toDate });
    const candidate = allUnits.find(
        (u) => Number(u.sizeSqf) === Number(thread.size) && !bookedUnitIds.has(String(u._id))
    );

    if (!candidate) {
        thread.done = true;
        thread.completedAt = new Date();
        thread.dateSubStep = '';
        await thread.save();
        await sendWhatsAppText({ to, body: fillPlaceholders(step.noAvailabilityText, threadVars(thread)) });
        return;
    }

    thread.unit = candidate._id;
    thread.unitNumber = candidate.unitNumber;
    thread.monthlyPrice = candidate.price ?? null;
    thread.dateSubStep = '';
    await thread.save();

    const confirmationBody = fillPlaceholders(step.confirmationText, threadVars(thread));
    if (confirmationBody) await sendWhatsAppText({ to, body: confirmationBody });

    await advanceOrFinish({ thread, template, to, phoneNormalized, nextIndex: thread.stepIndex + 1 });
}

/**
 * One inbound message. Returns { handled: boolean } so the caller — same as
 * handleRenewalButtonReply — knows whether to tell the assistant about it at
 * all.
 *
 * Never throws: a webhook must not fail because a menu did not go out.
 */
export async function handleMovingStorageFlow({ phoneNormalized, phone, text, type, raw }) {
    try {
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
            // Self-healing: the migration off the old movingStorageFlowEnabled
            // checkbox only needs to run once, but it must run before the
            // first real message arrives, not only once someone opens the
            // new settings page.
            await ensureDefaultFlowTemplate();
            const template = await getActiveFlowTemplate();
            if (!template || !template.steps.length) return { handled: false };
            thread = await MovingStorageFlowThread.create({ phoneNormalized, templateId: template._id, stepIndex: 0 });
            await enterStep({ thread, template, to, phoneNormalized, stepIndex: 0 });
            return { handled: true, step: thread.stepIndex };
        }

        // The flow has already run its course on this number — whatever
        // comes next is a fresh conversation, for the assistant or a person.
        if (thread.done) return { handled: false };

        // The template a thread started on is snapshotted at creation, not
        // re-read as "whichever is active now" — an admin editing the live
        // template mid-conversation should not yank someone out from under it.
        const template = await WhatsAppFlowTemplate.findById(thread.templateId);
        const step = template?.steps?.[thread.stepIndex];
        if (!template || !step) {
            thread.done = true;
            thread.completedAt = new Date();
            await thread.save();
            await sendWhatsAppText({ to, body: DEFAULT_HANDOFF_TEXT });
            return { handled: true, step: -1 };
        }

        // From here on this number has an active flow, so every message on
        // it — a tap or a stray line of text — is answered here, never
        // handed to the assistant mid-form.

        if (step.kind === 'buttons') {
            const idx = optionIndexFromId(replyId);
            const option = idx >= 0 ? step.options[idx] : null;
            if (!option) {
                await enterStep({ thread, template, to, phoneNormalized, stepIndex: thread.stepIndex });
                return { handled: true, step: thread.stepIndex };
            }
            if (option.action === 'handoff') {
                thread.done = true;
                thread.completedAt = new Date();
                await thread.save();
                await sendWhatsAppText({ to, body: fillPlaceholders(template.handoffText, threadVars(thread)) || DEFAULT_HANDOFF_TEXT });
                return { handled: true, step: thread.stepIndex };
            }
            await advanceOrFinish({ thread, template, to, phoneNormalized, nextIndex: thread.stepIndex + 1 });
            return { handled: true, step: thread.stepIndex };
        }

        if (step.kind === 'size_list') {
            if (replyId === 'size_help' && step.helpOptionLabel) {
                thread.done = true;
                thread.completedAt = new Date();
                await thread.save();
                await sendWhatsAppText({ to, body: fillPlaceholders(template.handoffText, threadVars(thread)) || DEFAULT_HANDOFF_TEXT });
                return { handled: true, step: thread.stepIndex };
            }
            const size = sizeFromListId(replyId);
            if (!size) {
                await sendSizeList({ to, step });
                return { handled: true, step: thread.stepIndex };
            }
            thread.size = size;
            await advanceOrFinish({ thread, template, to, phoneNormalized, nextIndex: thread.stepIndex + 1 });
            return { handled: true, step: thread.stepIndex };
        }

        if (step.kind === 'date_range') {
            if (thread.dateSubStep === 'awaiting_flow') {
                if (!isFlowReply(raw)) {
                    await startDateRange({ thread, to, phoneNormalized, step });
                    await thread.save();
                    return { handled: true, step: thread.stepIndex };
                }
                const data = flowReplyData(raw);
                const from = parseFlexibleDate(data.from_date);
                const toDate = parseFlexibleDate(data.to_date);
                if (!from || !toDate || toDate <= from) {
                    await sendWhatsAppText({ to, body: "Sorry, that date range didn't come through right — let's try again." });
                    await startDateRange({ thread, to, phoneNormalized, step });
                    await thread.save();
                    return { handled: true, step: thread.stepIndex };
                }
                await resolveDateRange({ thread, template, to, phoneNormalized, from, toDate });
                return { handled: true, step: thread.stepIndex };
            }

            if (thread.dateSubStep === 'awaiting_from') {
                const from = parseFlexibleDate(text);
                if (!from) {
                    await sendWhatsAppText({ to, body: `Sorry, I didn't catch that date — ${dateFromPrompt()}` });
                    return { handled: true, step: thread.stepIndex };
                }
                thread.reservation.startDate = from;
                thread.dateSubStep = 'awaiting_to';
                await thread.save();
                await sendWhatsAppText({ to, body: dateToPrompt() });
                return { handled: true, step: thread.stepIndex };
            }

            if (thread.dateSubStep === 'awaiting_to') {
                const toDate = parseFlexibleDate(text);
                const from = thread.reservation.startDate;
                if (!toDate || toDate <= from) {
                    await sendWhatsAppText({ to, body: `Sorry, that needs to be a date after ${formatDate(from)} — ${dateToPrompt()}` });
                    return { handled: true, step: thread.stepIndex };
                }
                await resolveDateRange({ thread, template, to, phoneNormalized, from, toDate });
                return { handled: true, step: thread.stepIndex };
            }

            // No sub-step recorded (shouldn't normally happen) — (re)start it.
            await startDateRange({ thread, to, phoneNormalized, step });
            await thread.save();
            return { handled: true, step: thread.stepIndex };
        }

        if (step.kind === 'text_question') {
            const value = String(text || '').trim();
            if (!value) {
                await sendWhatsAppText({ to, body: fillPlaceholders(step.prompt, threadVars(thread)) });
                return { handled: true, step: thread.stepIndex };
            }
            if (step.saveField === 'contactPhone') thread.reservation.contactPhone = value;
            else thread.reservation.name = value;
            await advanceOrFinish({ thread, template, to, phoneNormalized, nextIndex: thread.stepIndex + 1 });
            return { handled: true, step: thread.stepIndex };
        }

        // 'handoff' steps end the moment they're entered (see enterStep) —
        // a reply arriving for one regardless means the thread is already
        // done, which is checked above. Nothing left to do here.
        return { handled: false };
    } catch (e) {
        console.error('[MovingStorageFlow]', e.message);
        return { handled: false, error: e.message };
    }
}
