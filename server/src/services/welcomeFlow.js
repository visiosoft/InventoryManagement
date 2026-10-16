/**
 * The welcome form: the first thing a brand-new contact gets on WhatsApp.
 *
 * A native WhatsApp Flow (docs/whatsapp-flows/welcome-size-date.json) with two
 * screens — which unit size, then from what date. It is a static flow: no
 * data-exchange endpoint; the answers come back on the ordinary webhook as an
 * nfm_reply, and are written onto the lead (storageSizeValue, and the
 * start date as storageStartAt — the profile's "Needs storage from" — and
 * intendedStartDate) so whoever picks the chat up already knows both.
 *
 * Switched on by putting the published flow's id in WHATSAPP_WELCOME_FLOW_ID.
 * Unset, nothing here runs and new contacts get the usual first reply.
 *
 * Only for someone genuinely new: no lead existed before this message, it is
 * their first message to us, and they are not an existing tenant.
 */

import { Lead, WhatsAppMessage } from '../models/index.js';
import { sendWhatsAppInteractiveFlow, sendWhatsAppText, whatsappSendConfigured } from './whatsapp.js';
import { isFlowReply, flowReplyData } from './renewalReply.js';
import { isExistingCustomerPhone } from './customerLeads.js';
import { syncStorageStartTask } from './followUps.js';

export const WELCOME_TOKEN_PREFIX = 'welcome.';
export const WELCOME_BODY = 'Hi, welcome to PurpleBox Storage! 👋 Tell us the unit size you need and when you would like to start — it takes 10 seconds.';

export function welcomeFlowId() {
    return String(process.env.WHATSAPP_WELCOME_FLOW_ID || '').trim();
}

/** Today in Dubai as YYYY-MM-DD — the earliest date the picker allows. */
export function dubaiToday(now = new Date()) {
    return new Date(now.getTime() + 4 * 3600000).toISOString().slice(0, 10);
}

/* ── reading the answers ──────────────────────────────────────────────── */

export function isWelcomeReply(raw) {
    if (!isFlowReply(raw)) return false;
    const d = flowReplyData(raw);
    return d.flow === 'welcome'
        || String(d.flow_token || '').startsWith(WELCOME_TOKEN_PREFIX)
        || (d.size !== undefined && d.start_date !== undefined && d.to_date === undefined);
}

/** size: n sqft, -1 for "not sure", null if unreadable. startDate: a Date (Dubai midnight) or null. */
export function readWelcome(raw) {
    const d = flowReplyData(raw);
    const s = String(d.size ?? '').trim();
    const size = s === 'not_sure' ? -1 : (/^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null);
    let startDate = null;
    const v = d.start_date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) startDate = new Date(`${v}T00:00:00+04:00`);
    else if (/^\d{10,13}$/.test(String(v || ''))) startDate = new Date(Number(String(v).padEnd(13, '0')));
    if (startDate && Number.isNaN(startDate.getTime())) startDate = null;
    return { size, startDate };
}

const dayLabel = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });

/** One line for the inbox and the lead timeline. */
export function welcomeSummary(raw) {
    if (!isWelcomeReply(raw)) return '';
    const { size, startDate } = readWelcome(raw);
    const sizeText = size === -1 ? 'size: not sure' : size ? `${size} sq ft` : 'size not given';
    return `Welcome form · ${sizeText} · from ${startDate ? dayLabel(startDate) : 'date not given'}`;
}

export const ESTIMATOR_URL = 'https://purplebox.ae/estimator.html';

export function thankYouText({ size, startDate }) {
    const when = startDate ? ` from ${dayLabel(startDate)}` : '';
    // Not sure of the size: point them at the estimator, which works it out
    // from what they are storing.
    if (size === -1) {
        return `Thank you! We have noted that you need storage${when}. Not sure of the size? Our estimator works it out from what you are storing: ${ESTIMATOR_URL}\n\nTell us the size it suggests, or one of our team will reply here shortly to help.`;
    }
    const what = size ? `a ${size} sq ft unit` : 'a storage unit';
    return `Thank you! We have noted ${what}${when}. One of our team will reply here shortly with availability and prices.`;
}

/* ── sending ──────────────────────────────────────────────────────────── */

/**
 * @returns {{ sent: boolean, reason?: string }} Never throws — a webhook must
 * not fail because a welcome did not go out.
 */
export async function sendWelcomeFlow({ phoneNormalized, phone, wasNewLead }) {
    try {
        const flowId = welcomeFlowId();
        if (!flowId) return { sent: false, reason: 'no welcome flow id set' };
        if (!wasNewLead) return { sent: false, reason: 'already a lead' };
        if (!whatsappSendConfigured() || !phoneNormalized) return { sent: false, reason: 'WhatsApp is not configured' };
        const inbound = await WhatsAppMessage.countDocuments({ phoneNormalized, direction: 'inbound' });
        if (inbound !== 1) return { sent: false, reason: 'not their first message' };
        if (await isExistingCustomerPhone(phoneNormalized).catch(() => false)) return { sent: false, reason: 'existing customer' };
        if (await WhatsAppMessage.exists({ phoneNormalized, direction: 'outbound', 'raw.welcomeFlow': true })) {
            return { sent: false, reason: 'already sent' };
        }

        await sendWhatsAppInteractiveFlow({
            to: phone || phoneNormalized,
            bodyText: WELCOME_BODY,
            flowId,
            flowCta: 'Choose size',
            screenId: 'SIZE',
            flowToken: `${WELCOME_TOKEN_PREFIX}${phoneNormalized}`,
            data: { min_date: dubaiToday() },
            formName: 'Welcome form',
            // The system speaking, not a colleague: must not pause the assistant.
            sentByAi: true,
            rawExtra: { welcomeFlow: true },
        });
        return { sent: true };
    } catch (e) {
        console.error('[WelcomeFlow] send failed:', e.message);
        return { sent: false, reason: e.message };
    }
}

/* ── the answers arriving ─────────────────────────────────────────────── */

/**
 * Writes the answers onto the lead and thanks them. Only fills what nobody
 * has set: a size or date a rep already typed in is never overwritten.
 * @returns {{ handled: boolean, summary?: string }}
 */
export async function handleWelcomeReply({ phoneNormalized, phone, raw }) {
    if (!isWelcomeReply(raw)) return { handled: false };
    const answers = readWelcome(raw);
    const summary = welcomeSummary(raw);

    const lead = await Lead.findOne({ phoneNormalized });
    if (lead) {
        if (answers.size !== null && !(lead.storageSizeValue > 0)) lead.storageSizeValue = answers.size;
        if (answers.startDate && !lead.intendedStartDate) lead.intendedStartDate = answers.startDate;
        /* The profile's "Needs storage from" card reads storageStartAt, and
           setting it puts a "Needs a unit from today" task on the owner's
           board for that day — the same as a rep picking the date. */
        if (answers.startDate && !lead.storageStartAt) {
            lead.storageStartAt = answers.startDate;
            await syncStorageStartTask(lead).catch((e) => console.error('[WelcomeFlow] start-date task:', e.message));
        }
        lead.timeline.push({ type: 'note', text: summary });
        await lead.save();
    }

    try {
        const text = thankYouText(answers);
        const result = await sendWhatsAppText({ to: phone || phoneNormalized, body: text });
        await WhatsAppMessage.create({
            messageId: result?.messages?.[0]?.id || '',
            phone: phone || phoneNormalized,
            phoneNormalized,
            lead: lead?._id,
            direction: 'outbound',
            type: 'text',
            text,
            status: 'sent',
            occurredAt: new Date(),
            sentByAi: true,
            raw: result,
        });
    } catch (e) {
        console.error('[WelcomeFlow] thank-you failed:', e.message);
    }
    return { handled: true, summary };
}
