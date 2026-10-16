import { ClientInfoSubmission, Customer, Document, Lead, User, WhatsAppMessage } from '../models/index.js';
import { driveConfigured, uploadFile } from './drive.js';
import { openaiConfigured, visionJson } from './openai.js';
import { EXTRACT_SYSTEM, parseIdFields } from './documentExtract.js';
import { pushConfigured, pushToUser } from './push.js';
import { normalizeLeadPhone } from '../routes/leads.js';
import { fetchFlowMedia, flowToken } from './whatsappFlow.js';
import { listWhatsAppTemplates, sendWhatsAppInteractiveFlow, sendWhatsAppTemplate, whatsappSendConfigured, windowOpenFor } from './whatsapp.js';

/**
 * Send the client-details form (CLIENT_INFO WhatsApp Flow): name, phone,
 * Emirates ID or passport photo, and an authorized person.
 *
 * The flow token carries the WhatsApp number, signed (services/whatsappFlow.js),
 * so the answers and the ID photos land on that number's customer record.
 *
 * Set in the environment:
 *   WHATSAPP_CLIENT_INFO_TEMPLATE  the approved template with a Flow button for
 *                                  this form (default: client_info)
 *   WHATSAPP_CLIENT_INFO_FLOW_ID   only needed without an approved template
 */
// The approved WhatsApp template whose Flow button opens the ID & details form.
const TEMPLATE = () => process.env.WHATSAPP_CLIENT_INFO_TEMPLATE || 'client_info';

export async function sendClientInfoFlow({ phone, name = '' }) {
    if (!whatsappSendConfigured()) throw Object.assign(new Error('WhatsApp is not configured'), { status: 400 });
    const phoneNormalized = normalizeLeadPhone(phone);
    if (!phoneNormalized) throw Object.assign(new Error('A phone number is required'), { status: 400 });

    const token = flowToken(phoneNormalized);
    const first = String(name || '').trim().split(/\s+/)[0];

    /* The approved template is the way in: it reaches the customer whether or
     * not they have written in the last 24 hours, and its Flow button already
     * names the flow. Its language and any {{1}} come from Meta's own copy of
     * the template, so nothing has to be configured to match it. */
    const { templates = [] } = await listWhatsAppTemplates().catch(() => ({ templates: [] }));
    const tpl = templates.find((t) => t.name === TEMPLATE() && String(t.status).toUpperCase() === 'APPROVED');

    let via;
    let text;
    if (tpl) {
        const variables = Array.from({ length: tpl.variableCount || 0 }, () => first || 'there');
        await sendWhatsAppTemplate({ to: phoneNormalized, name: tpl.name, language: tpl.language, variables, flowToken: token });
        via = 'template';
        text = variables.reduce((t, v, i) => t.replaceAll(`{{${i + 1}}}`, v), tpl.bodyText || `Template: ${tpl.name}`);
    } else {
        // No approved template: an interactive Flow message, which WhatsApp
        // only delivers within 24 hours of the customer's last message.
        const flowId = process.env.WHATSAPP_CLIENT_INFO_FLOW_ID;
        if (!flowId) {
            throw Object.assign(new Error(
                `The WhatsApp template "${TEMPLATE()}" was not found or is not approved yet in Meta, and WHATSAPP_CLIENT_INFO_FLOW_ID is not set.`,
            ), { status: 400 });
        }
        const lastInbound = await WhatsAppMessage.findOne({ phoneNormalized, direction: 'inbound' })
            .sort({ occurredAt: -1 }).select('occurredAt').lean();
        if (!windowOpenFor({ lastInboundAt: lastInbound?.occurredAt || null })) {
            throw Object.assign(new Error(
                `The customer has not written in the last 24 hours, so WhatsApp only allows a template, and "${TEMPLATE()}" is not approved yet.`,
            ), { status: 409 });
        }
        text = `Hi${first ? ` ${first}` : ''}, to prepare your storage agreement please share your details and a photo of your Emirates ID or passport. It takes a minute and is kept confidential.`;
        await sendWhatsAppInteractiveFlow({
            to: phoneNormalized, bodyText: text, flowId, flowCta: 'Share details', flowToken: token, flowAction: 'data_exchange',
            record: false,
        });
        via = 'flow';
    }

    await WhatsAppMessage.create({
        phone: phoneNormalized, phoneNormalized, direction: 'outbound', type: via === 'template' ? 'template' : 'interactive',
        text,
        status: 'sent', occurredAt: new Date(), sentByAi: false,
        // The inbox draws the form's button under the message.
        raw: { flowForm: { name: 'Client details', cta: 'Share details' } },
    }).catch(() => { });

    return { sent: true, via, phone: phoneNormalized, template: tpl?.name || null };
}

/* ── What happens to the ID photos ───────────────────────────────────────── */

const ID_LABEL = { passport: 'Passport', emirates_id: 'Emirates ID' };
const READABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);
// Read off the photo into the profile, only where the profile is empty.
const FILLABLE = ['emiratesId', 'eidExpiry', 'passportNumber', 'passportExpiry', 'nationality'];

/** Whoever should hear about it: the lead's owner on that number, else the admins. */
async function whoToTell(phoneNormalized) {
    const lead = phoneNormalized ? await Lead.findOne({ phoneNormalized }).select('owner').lean() : null;
    if (lead?.owner) return [lead.owner];
    return (await User.find({ role: 'admin', isActive: { $ne: false } }).select('_id').lean()).map((u) => u._id);
}

/**
 * Download, decrypt and file each ID photo in the customer's Google Drive
 * folder, read the ID details off it, and record the outcome on the
 * submission: saved, partial or failed, with the reason. Never throws — a
 * failure is something to show people, not to lose.
 */
export async function processIdPhotos({ submission, customer, photos, idType, phone }) {
    const docType = idType === 'passport' ? 'passport' : idType === 'emirates_id' ? 'emirates_id' : 'id_proof';
    const label = ID_LABEL[idType] || 'ID document';
    const date = new Date().toISOString().slice(0, 10);
    const problems = [];
    const documents = [];
    const readable = [];

    if (!driveConfigured() && process.env.NODE_ENV !== 'test') {
        problems.push('Google Drive is not connected, so the photos could not be saved');
    } else {
        for (const [i, descriptor] of photos.entries()) {
            try {
                const { buffer, mimeType, ext } = await fetchFlowMedia(descriptor);
                const stored = await uploadFile({
                    buffer,
                    filename: `${customer.fullName} - ${label} ${i + 1} - ${date}.${ext}`.replace(/[\\/:*?"<>|]/g, ''),
                    mimeType,
                    customerName: customer.fullName,
                });
                const doc = await Document.create({
                    customer: customer._id,
                    name: `${label}${photos.length > 1 ? ` (${i + 1} of ${photos.length})` : ''} — WhatsApp${phone ? ` +${phone}` : ''}`,
                    type: docType,
                    ...stored,
                });
                documents.push(doc._id);
                if (READABLE.has(mimeType)) readable.push({ buffer, mimeType });
            } catch (e) {
                problems.push(`Photo ${i + 1}: ${e.message}`);
                console.error('[ClientInfo] photo not stored:', e.message);
            }
        }
    }

    // Read the ID number, expiry and nationality off the photo(s) and fill
    // in whatever the profile does not have yet. Optional: without OpenAI, or
    // if it cannot read the photo, the documents are still saved.
    const filled = [];
    if (readable.length && openaiConfigured()) {
        try {
            const fresh = await Customer.findById(customer._id);
            for (const img of readable) {
                const { parsed } = await visionJson({
                    system: EXTRACT_SYSTEM, imageBase64: img.buffer.toString('base64'), mimeType: img.mimeType,
                    prompt: 'Report what is printed on this document.',
                });
                const { fields } = parseIdFields(parsed);
                for (const f of FILLABLE) {
                    if (fields[f] && !fresh[f] && !filled.includes(f)) {
                        fresh[f] = f.endsWith('Expiry') ? new Date(fields[f]) : fields[f];
                        filled.push(f);
                    }
                }
            }
            if (filled.length) await fresh.save();
        } catch (e) {
            console.error('[ClientInfo] could not read the ID:', e.message);
        }
    }

    const saved = documents.length;
    const status = saved === photos.length && saved > 0 ? 'saved' : saved > 0 ? 'partial' : 'failed';
    await ClientInfoSubmission.updateOne({ _id: submission._id }, {
        $set: { status, filesSaved: saved, problems, documents, filledFromId: filled, processedAt: new Date() },
    });

    const note = status === 'saved'
        ? `${label} received over WhatsApp on ${date}: ${saved} file${saved === 1 ? '' : 's'} saved to Google Drive.${filled.length ? ` Filled in from the ID: ${filled.join(', ')}.` : ''}`
        : `${label} sent over WhatsApp on ${date}: ${saved} of ${photos.length} file(s) saved. ${problems[0] || ''} — ask the customer to send it again.`;
    const current = await Customer.findById(customer._id).select('notes').lean();
    await Customer.updateOne({ _id: customer._id }, { $set: { notes: [current?.notes, note].filter(Boolean).join('\n') } }).catch(() => { });

    if (pushConfigured()) {
        const who = await whoToTell(phone).catch(() => []);
        for (const userId of who) {
            await pushToUser(userId, {
                title: status === 'saved' ? `${label} received` : `${label} upload failed`,
                body: status === 'saved'
                    ? `${customer.fullName} sent their details and ${label} on WhatsApp.`
                    : `${customer.fullName}'s ${label} could not be saved. Ask them to send it again.`,
                url: `/customers/${customer._id}`,
            }).catch(() => { });
        }
    }
    return { status, saved, problems, filled };
}
