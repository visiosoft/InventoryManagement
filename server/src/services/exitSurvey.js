import { Contract, Customer, ExitSurvey, WhatsAppMessage } from '../models/index.js';
import { isFlowReply, flowReplyData } from './renewalReply.js';
import {
    sendWhatsAppInteractiveFlow, sendWhatsAppTemplate, whatsappSendConfigured, windowOpenFor,
} from './whatsapp.js';
import { normalizeLeadPhone } from '../routes/leads.js';

/**
 * The move-out exit survey — a static WhatsApp Flow (screen EXIT_SURVEY,
 * terminal, "complete" action).
 *
 * Static means there is no data endpoint to call mid-flow: the customer fills
 * the form in on their phone and the answers arrive on the ordinary webhook as
 * an nfm_reply message, same as the renewal date picker. This file recognises
 * that reply, files it against the contract, and sends the survey out.
 *
 * Set in the environment:
 *   WHATSAPP_EXIT_SURVEY_FLOW_ID   the flow's id from WhatsApp Manager (required to send)
 *   WHATSAPP_EXIT_SURVEY_TEMPLATE  an approved template with a Flow button for the same
 *                                  flow — needed when the customer has not written in
 *                                  the last 24 hours (optional)
 */

export const REASONS = {
    no_longer_need: 'No longer need storage',
    moving_abroad: 'Moving abroad',
    new_home: 'Moved to a new home',
    price: 'Price too high',
    wrong_size: 'Unit wrong size',
    service_issue: 'Service or access issue',
    cheaper_option: 'Found cheaper option',
    other: 'Other',
};
export const COME_BACK = { yes: 'Yes', maybe: 'Maybe', no: 'No' };

const TOKEN_PREFIX = 'exit_survey.';
const suffix = (p) => String(p || '').replace(/\D/g, '').slice(-9);
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

export const exitSurveyToken = (contractId) => `${TOKEN_PREFIX}${contractId || 'none'}.${Date.now()}`;

/** The contract id carried in a token we generated, or '' for any other token. */
export function contractIdFromToken(token) {
    const m = String(token || '').match(/^exit_survey\.([a-f0-9]{24})\./i);
    return m ? m[1] : '';
}

/**
 * Is this webhook message a submitted exit survey?
 *
 * Our own token says so outright. Without it (the flow sent from WhatsApp
 * Manager, or a template whose token Meta did not echo) the answers
 * themselves identify it: only this form has a reason, a rating and a
 * come-back answer together.
 */
export function isExitSurveyReply(raw) {
    if (!isFlowReply(raw)) return false;
    const d = flowReplyData(raw);
    if (String(d.flow_token || '').startsWith(TOKEN_PREFIX)) return true;
    return d.reason !== undefined && d.rating !== undefined && d.come_back !== undefined;
}

/** The answers, cleaned. Unknown ids are kept as given rather than dropped. */
export function readExitSurvey(raw) {
    const d = flowReplyData(raw);
    const rating = Number.parseInt(d.rating, 10);
    return {
        reason: clip(d.reason, 40),
        oneChange: clip(d.one_change, 300),
        rating: rating >= 1 && rating <= 5 ? rating : null,
        comeBack: clip(d.come_back, 10),
        whatWouldKeepYou: clip(d.what_would_keep_you, 300),
        flowToken: clip(d.flow_token, 120),
    };
}

/** One line for the chat inbox, which otherwise shows a flow reply as blank. '' if not a survey. */
export function exitSurveySummary(raw) {
    if (!isExitSurveyReply(raw)) return '';
    const a = readExitSurvey(raw);
    return [
        'Exit survey',
        REASONS[a.reason] || a.reason || '—',
        a.rating ? `${a.rating}/5` : '',
        a.comeBack ? `come back: ${COME_BACK[a.comeBack] || a.comeBack}` : '',
    ].filter(Boolean).join(' · ');
}

/** The contract this survey is about: the one in our token, else the number's latest contract. */
async function contractFor({ token, phoneNormalized }) {
    const id = contractIdFromToken(token);
    if (id) {
        const c = await Contract.findById(id).select('_id customer unit').lean();
        if (c) return c;
    }
    const key = suffix(phoneNormalized);
    if (key.length < 7) return null;
    const rx = new RegExp(`${key}$`);
    const customers = await Customer.find({ $or: [{ phone: rx }, { phones: rx }] }).select('_id').lean();
    if (!customers.length) return null;
    return Contract.findOne({ customer: { $in: customers.map((c) => c._id) } })
        .sort({ endDate: -1 }).select('_id customer unit').lean();
}

/**
 * Save a submitted survey. Returns { handled } so the webhook keeps the AI
 * assistant from answering a form submission as if it were a chat message.
 * Idempotent on the WhatsApp message id — Meta redelivers webhooks.
 */
export async function handleExitSurveyReply({ phoneNormalized, messageId, raw, occurredAt }) {
    if (!isExitSurveyReply(raw)) return { handled: false };

    const answers = readExitSurvey(raw);
    if (messageId && await ExitSurvey.exists({ messageId })) return { handled: true, duplicate: true };

    const contract = await contractFor({ token: answers.flowToken, phoneNormalized });

    const survey = await ExitSurvey.create({
        ...answers,
        messageId: messageId || '',
        phoneNormalized,
        contract: contract?._id || null,
        customer: contract?.customer || null,
        unit: contract?.unit || null,
        submittedAt: occurredAt || new Date(),
    });

    if (contract) {
        const parts = [
            `reason: ${REASONS[answers.reason] || answers.reason || '—'}`,
            `rating: ${answers.rating ?? '—'}/5`,
            `would come back: ${COME_BACK[answers.comeBack] || answers.comeBack || '—'}`,
        ];
        await Contract.updateOne({ _id: contract._id }, {
            $push: { timeline: { at: new Date(), author: 'Tenant (WhatsApp)', text: `Exit survey submitted — ${parts.join(', ')}` } },
        }).catch(() => { });
    }

    return { handled: true, surveyId: String(survey._id), contractId: contract ? String(contract._id) : '' };
}

/**
 * Send the survey to a contract's tenant.
 *
 * A Flow message is a free-form message, so Meta only delivers it inside the
 * 24 hours after the customer last wrote. Outside that, an approved template
 * with a Flow button is the only way — sent if one is configured, otherwise
 * the reason is returned instead of a vague Meta error.
 */
export async function sendExitSurvey({ contractId, phone }) {
    if (!whatsappSendConfigured()) throw Object.assign(new Error('WhatsApp is not configured'), { status: 400 });
    const flowId = process.env.WHATSAPP_EXIT_SURVEY_FLOW_ID;
    if (!flowId) throw Object.assign(new Error('WHATSAPP_EXIT_SURVEY_FLOW_ID is not set'), { status: 400 });

    let contract = null;
    if (contractId) {
        contract = await Contract.findById(contractId).populate('customer', 'fullName phone phones');
        if (!contract) throw Object.assign(new Error('Contract not found'), { status: 404 });
    } else if (phone) {
        // Sent from the inbox: link it to this number's latest contract now,
        // so the answers land on the right tenant even if they have two numbers.
        const found = await contractFor({ phoneNormalized: normalizeLeadPhone(phone) });
        if (found) contract = await Contract.findById(found._id).populate('customer', 'fullName phone phones');
    }
    const to = phone || contract?.customer?.phone || contract?.customer?.phones?.[0];
    if (!to) throw Object.assign(new Error('No phone number to send to'), { status: 400 });

    const lastInbound = await WhatsAppMessage.findOne({ phoneNormalized: normalizeLeadPhone(to), direction: 'inbound' })
        .sort({ occurredAt: -1 }).select('occurredAt').lean();
    const windowOpen = windowOpenFor({ lastInboundAt: lastInbound?.occurredAt || null });

    const flowToken = exitSurveyToken(contract?._id);
    const firstName = String(contract?.customer?.fullName || '').trim().split(/\s+/)[0];
    const template = process.env.WHATSAPP_EXIT_SURVEY_TEMPLATE;

    let via;
    if (windowOpen) {
        await sendWhatsAppInteractiveFlow({
            to,
            bodyText: `Hi${firstName ? ` ${firstName}` : ''}, thanks for storing with PurpleBox. Could you spare two minutes for a short feedback form?`,
            flowId,
            flowCta: 'Give feedback',
            screenId: 'EXIT_SURVEY',
            flowToken,
        });
        via = 'flow';
    } else if (template) {
        await sendWhatsAppTemplate({ to, name: template, language: process.env.WHATSAPP_EXIT_SURVEY_TEMPLATE_LANG || 'en', flowToken });
        via = 'template';
    } else {
        throw Object.assign(new Error(
            'The customer has not written in the last 24 hours, so WhatsApp only allows a template. '
            + 'Set WHATSAPP_EXIT_SURVEY_TEMPLATE to an approved template with a Flow button.',
        ), { status: 409 });
    }

    if (contract) {
        contract.timeline.push({ at: new Date(), author: 'System', text: `Exit survey sent on WhatsApp (${via})` });
        await contract.save().catch(() => { });
    }
    return { sent: true, via, to, flowToken, contractId: contract ? String(contract._id) : '', contractNo: contract?.contractNo || '' };
}

/** Totals for a list of surveys: by reason, average rating, come-back split. */
export function summarise(surveys) {
    const byReason = {};
    const comeBack = { yes: 0, maybe: 0, no: 0 };
    let ratingSum = 0;
    let rated = 0;
    for (const s of surveys) {
        byReason[s.reason || 'unknown'] = (byReason[s.reason || 'unknown'] || 0) + 1;
        if (s.comeBack in comeBack) comeBack[s.comeBack] += 1;
        if (s.rating) { ratingSum += s.rating; rated += 1; }
    }
    return {
        total: surveys.length,
        averageRating: rated ? Math.round((ratingSum / rated) * 10) / 10 : null,
        rated,
        byReason: Object.entries(byReason)
            .map(([id, count]) => ({ id, label: REASONS[id] || id, count }))
            .sort((a, b) => b.count - a.count),
        comeBack,
    };
}
