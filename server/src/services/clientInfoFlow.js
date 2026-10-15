import { WhatsAppMessage } from '../models/index.js';
import { normalizeLeadPhone } from '../routes/leads.js';
import { flowToken } from './whatsappFlow.js';
import { sendWhatsAppInteractiveFlow, sendWhatsAppTemplate, whatsappSendConfigured, windowOpenFor } from './whatsapp.js';

/**
 * Send the client-details form (CLIENT_INFO WhatsApp Flow): name, phone,
 * Emirates ID or passport photo, and an authorized person.
 *
 * The flow token carries the WhatsApp number, signed (services/whatsappFlow.js),
 * so the answers and the ID photos land on that number's customer record.
 *
 * Set in the environment:
 *   WHATSAPP_CLIENT_INFO_FLOW_ID   the published flow's id (required)
 *   WHATSAPP_CLIENT_INFO_TEMPLATE  an approved template with a Flow button for
 *                                  the same flow, for customers who have not
 *                                  written in the last 24 hours (optional)
 */
export async function sendClientInfoFlow({ phone, name = '' }) {
    if (!whatsappSendConfigured()) throw Object.assign(new Error('WhatsApp is not configured'), { status: 400 });
    const flowId = process.env.WHATSAPP_CLIENT_INFO_FLOW_ID;
    if (!flowId) throw Object.assign(new Error('WHATSAPP_CLIENT_INFO_FLOW_ID is not set'), { status: 400 });
    const phoneNormalized = normalizeLeadPhone(phone);
    if (!phoneNormalized) throw Object.assign(new Error('A phone number is required'), { status: 400 });

    const lastInbound = await WhatsAppMessage.findOne({ phoneNormalized, direction: 'inbound' })
        .sort({ occurredAt: -1 }).select('occurredAt').lean();
    const token = flowToken(phoneNormalized);
    const first = String(name || '').trim().split(/\s+/)[0];
    const bodyText = `Hi${first ? ` ${first}` : ''}, to prepare your storage agreement please share your details and a photo of your Emirates ID or passport. It takes a minute and is kept confidential.`;

    let via;
    if (windowOpenFor({ lastInboundAt: lastInbound?.occurredAt || null })) {
        await sendWhatsAppInteractiveFlow({
            to: phoneNormalized, bodyText, flowId, flowCta: 'Share details', flowToken: token, flowAction: 'data_exchange',
        });
        via = 'flow';
    } else if (process.env.WHATSAPP_CLIENT_INFO_TEMPLATE) {
        await sendWhatsAppTemplate({
            to: phoneNormalized, name: process.env.WHATSAPP_CLIENT_INFO_TEMPLATE,
            language: process.env.WHATSAPP_CLIENT_INFO_TEMPLATE_LANG || 'en', flowToken: token,
        });
        via = 'template';
    } else {
        throw Object.assign(new Error(
            'The customer has not written in the last 24 hours, so WhatsApp only allows a template. '
            + 'Set WHATSAPP_CLIENT_INFO_TEMPLATE to an approved template with a Flow button.',
        ), { status: 409 });
    }

    await WhatsAppMessage.create({
        phone: phoneNormalized, phoneNormalized, direction: 'outbound', type: 'interactive',
        text: via === 'flow' ? `${bodyText}\n[Form: Share details]` : `Template: ${process.env.WHATSAPP_CLIENT_INFO_TEMPLATE}`,
        status: 'sent', occurredAt: new Date(), sentByAi: false,
    }).catch(() => { });

    return { sent: true, via, phone: phoneNormalized };
}
