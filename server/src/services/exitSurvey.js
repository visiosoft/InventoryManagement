import { AiBotConfig, Contract, Customer, ExitSurvey, Task, User, WhatsAppMessage } from '../models/index.js';
import { pushConfigured, pushToUser } from './push.js';
import { usableFirstName } from './leadNames.js';
import { isFlowReply, flowReplyData } from './renewalReply.js';
import {
    sendWhatsAppInteractiveFlow, sendWhatsAppTemplate, sendWhatsAppText, whatsappSendConfigured, windowOpenFor,
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

/* exit_survey.<contractId|none>.<phone digits>.<time>. The phone is there
 * because a request to the flow endpoint carries the token and nothing else
 * about who is answering. */
export const exitSurveyToken = (contractId, phone = '') =>
    `${TOKEN_PREFIX}${contractId || 'none'}.${String(phone).replace(/\D/g, '') || '0'}.${Date.now()}`;

/** The phone carried in a token we generated, or ''. */
export function phoneFromExitToken(token) {
    const m = String(token || '').match(/^exit_survey\.[a-z0-9]+\.(\d{7,15})\.\d+$/i);
    return m ? m[1] : '';
}

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
    return readExitSurveyData(flowReplyData(raw));
}

/** Same, from the plain answers object — what the flow endpoint receives. */
export function readExitSurveyData(d = {}) {
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

/**
 * A low rating promises the customer a call, so it lands on a person: the
 * contract's sales rep, else whoever receives hand-overs, else the first
 * admin — never on nobody. One open task per contract.
 */
async function createLowRatingTask({ contract, answers, phoneNormalized }) {
    let assignee = contract?.salesRep ? await User.findById(contract.salesRep).select('_id name email isActive').lean() : null;
    if (!assignee || assignee.isActive === false) {
        const cfg = await AiBotConfig.findOne().select('escalateTo').lean();
        assignee = cfg?.escalateTo ? await User.findById(cfg.escalateTo).select('_id name email isActive').lean() : null;
    }
    if (!assignee || assignee.isActive === false) {
        assignee = await User.findOne({ role: 'admin', isActive: { $ne: false } }).select('_id name email').sort({ createdAt: 1 }).lean();
    }
    if (!assignee) return;

    const customer = contract?.customer ? await Customer.findById(contract.customer).select('fullName').lean() : null;
    const who = customer?.fullName || phoneNormalized || 'Tenant';
    if (contract && await Task.exists({ leadId: contract._id, status: { $ne: 'done' }, title: /^Low exit-survey rating/ })) return;

    await Task.create({
        title: `Low exit-survey rating — ${who}`,
        description: [
            `${who} rated PurpleBox ${answers.rating}/5 in the exit survey${contract?.contractNo ? ` (${contract.contractNo})` : ''}.`,
            `Reason for leaving: ${REASONS[answers.reason] || answers.reason || '—'}. Would come back: ${COME_BACK[answers.comeBack] || answers.comeBack || '—'}.`,
            answers.oneChange ? `One thing to change: "${answers.oneChange}"` : '',
            answers.whatWouldKeepYou ? `What would keep them: "${answers.whatWouldKeepYou}"` : '',
            `They were told on WhatsApp that someone will reach out — call them${phoneNormalized ? ` on +${phoneNormalized}` : ''}.`,
        ].filter(Boolean).join('\n'),
        assignedTo: assignee._id,
        createdByName: 'System',
        leadId: contract?._id || null,
        leadType: contract ? 'contract' : null,
        leadName: who,
        priority: 'high',
        dueDate: new Date(Date.now() + 864e5),
        assignmentHistory: [{ fromId: null, fromName: '', toId: assignee._id, toName: assignee.name || assignee.email, byId: null, byName: 'System', reason: 'Low exit-survey rating' }],
    });
    if (pushConfigured()) {
        await pushToUser(assignee._id, {
            title: 'Low exit-survey rating',
            body: `${who} rated us ${answers.rating}/5. Please call them.`,
            url: contract ? `/contracts/${contract._id}` : '/exit-surveys',
        }).catch(() => { });
    }
}

/**
 * The thank-you sent once the form is in. It answers what they said rather
 * than a generic "thanks": a low rating gets an apology and a promise that
 * someone will follow up, a "yes" or "maybe" to coming back gets a welcome.
 */
export function thankYouText(answers, firstName = '') {
    const hi = `Thank you${firstName ? `, ${firstName},` : ''} for your feedback! 🙏`;
    const lines = [hi];
    if (answers.rating && answers.rating <= 2) {
        lines.push("We're sorry we fell short. A member of our team will reach out to make things right.");
    } else if (answers.rating >= 4) {
        lines.push("We're glad you enjoyed storing with PurpleBox.");
    } else {
        lines.push('Your answers help us improve PurpleBox.');
    }
    if (answers.comeBack === 'yes' || answers.comeBack === 'maybe') {
        lines.push("Whenever you need storage again, just message us here — we'd love to have you back.");
    } else {
        lines.push('We wish you all the best, and our door is always open.');
    }
    lines.push('— Team PurpleBox');
    return lines.join('\n');
}

/** The contract this survey is about: the one in our token, else the number's latest contract. */
async function contractFor({ token, phoneNormalized }) {
    const id = contractIdFromToken(token);
    if (id) {
        const c = await Contract.findById(id).select('_id customer unit salesRep contractNo').lean();
        if (c) return c;
    }
    const key = suffix(phoneNormalized);
    if (key.length < 7) return null;
    const rx = new RegExp(`${key}$`);
    const customers = await Customer.find({ $or: [{ phone: rx }, { phones: rx }] }).select('_id').lean();
    if (!customers.length) return null;
    return Contract.findOne({ customer: { $in: customers.map((c) => c._id) } })
        .sort({ endDate: -1 }).select('_id customer unit salesRep contractNo').lean();
}

/**
 * Save a submitted survey. Returns { handled } so the webhook keeps the AI
 * assistant from answering a form submission as if it were a chat message.
 */
export async function handleExitSurveyReply({ phoneNormalized, messageId, raw, occurredAt }) {
    if (!isExitSurveyReply(raw)) return { handled: false };
    return saveExitSurvey({ answers: readExitSurvey(raw), phoneNormalized, messageId, occurredAt });
}

/**
 * Store one set of answers, from the webhook or from the flow endpoint.
 *
 * Idempotent: on the WhatsApp message id (Meta redelivers webhooks), and on
 * our own flow token — a survey answered through the endpoint is followed by
 * the same answers on the webhook once the flow closes.
 */
export async function saveExitSurvey({ answers, phoneNormalized = '', messageId = '', occurredAt }) {
    if (messageId && await ExitSurvey.exists({ messageId })) return { handled: true, duplicate: true };
    if (answers.flowToken.startsWith(TOKEN_PREFIX) && await ExitSurvey.exists({ flowToken: answers.flowToken })) {
        return { handled: true, duplicate: true };
    }
    phoneNormalized = phoneNormalized || phoneFromExitToken(answers.flowToken);

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

    // A 1-2 rating is promised a follow-up in the thank-you, so somebody gets the job.
    if (answers.rating && answers.rating <= 2) {
        await createLowRatingTask({ contract, answers, phoneNormalized }).catch((e) => console.error('[ExitSurvey] task:', e.message));
    }

    /* Their submission is itself an inbound message, so the 24-hour window
     * is open and a plain text is allowed. Never allowed to fail the save. */
    let thanked = false;
    if (phoneNormalized && whatsappSendConfigured()) {
        try {
            const customer = contract?.customer ? await Customer.findById(contract.customer).select('fullName').lean() : null;
            const body = thankYouText(answers, usableFirstName(customer?.fullName));
            const sent = await sendWhatsAppText({ to: phoneNormalized, body });
            await WhatsAppMessage.create({
                messageId: sent?.messages?.[0]?.id || '',
                phone: phoneNormalized,
                phoneNormalized,
                direction: 'outbound',
                type: 'text',
                text: body,
                status: 'sent',
                occurredAt: new Date(),
                sentByAi: false,
                raw: sent,
            });
            thanked = true;
        } catch (e) {
            console.error('[ExitSurvey] thank-you not sent:', e.message);
        }
    }

    return { handled: true, surveyId: String(survey._id), contractId: contract ? String(contract._id) : '', thanked };
}

/** A survey token for this number, carrying its latest contract when there is one. */
export async function exitSurveyTokenForPhone(phone) {
    const phoneNormalized = normalizeLeadPhone(phone);
    const contract = await contractFor({ phoneNormalized });
    return exitSurveyToken(contract?._id, phoneNormalized);
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

    const flowToken = exitSurveyToken(contract?._id, normalizeLeadPhone(to));
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
            formName: 'Exit survey',
        });
        via = 'flow';
    } else if (template) {
        const sent = await sendWhatsAppTemplate({ to, name: template, language: process.env.WHATSAPP_EXIT_SURVEY_TEMPLATE_LANG || 'en', flowToken });
        via = 'template';
        // Recorded so the inbox shows the survey went out.
        await WhatsAppMessage.create({
            messageId: sent?.messages?.[0]?.id || '',
            phone: to, phoneNormalized: normalizeLeadPhone(to), direction: 'outbound', type: 'template',
            text: `Template: ${template}`, status: 'sent', occurredAt: new Date(), sentByAi: false,
            raw: { flowForm: { name: 'Exit survey', cta: 'Give feedback' }, sendResult: sent },
        }).catch(() => { });
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
