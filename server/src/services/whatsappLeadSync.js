import { Lead, User, WhatsAppLabelState, WhatsAppWebhookEvent, WhatsAppMessage } from '../models/index.js';
import { normalizeLeadPhone } from '../routes/leads.js';

const DEFAULT_STATUS_BY_LABEL = {
    lead: 'new',
    'new customer': 'qualified',
    followup: 'contacted',
    lost: 'lost',
    won: 'won',
};

const LABEL_ALIASES = {
    leads: 'lead',
    follow_up: 'followup',
    'follow up': 'followup',
    'new_customer': 'new customer',
};

const LABEL_PRIORITY = ['lost', 'won', 'followup', 'new customer', 'lead'];

const ALLOWED_LEAD_STATUS = new Set(['new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost']);

function readStatusMapFromEnv() {
    const raw = process.env.WHATSAPP_LABEL_STATUS_MAP;
    if (!raw) return DEFAULT_STATUS_BY_LABEL;

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return DEFAULT_STATUS_BY_LABEL;

        const normalized = {};
        for (const [label, status] of Object.entries(parsed)) {
            const key = canonicalizeLabel(label);
            const value = String(status || '').trim();
            if (!key || !ALLOWED_LEAD_STATUS.has(value)) continue;
            normalized[key] = value;
        }

        return Object.keys(normalized).length > 0 ? normalized : DEFAULT_STATUS_BY_LABEL;
    } catch {
        return DEFAULT_STATUS_BY_LABEL;
    }
}

export const whatsappLabelSyncState = {
    at: null,
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    messagesSaved: 0,
    reconciliationAt: null,
    reconciliationUpdated: 0,
    reconciliationSkipped: 0,
    lastError: '',
};

function canonicalizeLabel(label) {
    const base = String(label || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const aliased = LABEL_ALIASES[base] || base;
    return aliased;
}

function normalizeLabels(input) {
    if (!Array.isArray(input)) return [];
    const labels = input
        .map((x) => canonicalizeLabel(x))
        .filter(Boolean);
    return [...new Set(labels)];
}

function mappedStatusFromLabels(labels) {
    const statusByLabel = readStatusMapFromEnv();
    for (const key of LABEL_PRIORITY) {
        if (labels.includes(key) && statusByLabel[key]) {
            return statusByLabel[key];
        }
    }

    for (const label of labels) {
        if (statusByLabel[label]) return statusByLabel[label];
    }

    return '';
}

function parseLabelStringsFromPayload(payload) {
    const set = new Set();

    function walk(node) {
        if (!node) return;
        if (Array.isArray(node)) {
            for (const item of node) walk(item);
            return;
        }
        if (typeof node !== 'object') return;

        const maybe =
            node.label ||
            node.name ||
            node.display_name ||
            node.displayName ||
            node.tag ||
            node.statusLabel;

        if (typeof maybe === 'string') {
            const c = canonicalizeLabel(maybe);
            if (c) set.add(c);
        }

        for (const value of Object.values(node)) {
            walk(value);
        }
    }

    walk(payload);
    return [...set];
}

function parsePhoneFromPayload(payload) {
    const values = [];

    function walk(node) {
        if (!node) return;
        if (Array.isArray(node)) {
            for (const item of node) walk(item);
            return;
        }
        if (typeof node !== 'object') return;

        const candidateKeys = ['wa_id', 'from', 'phone', 'phone_number', 'contact', 'contact_phone'];
        for (const key of candidateKeys) {
            if (typeof node[key] === 'string' && node[key].trim()) values.push(node[key]);
        }

        for (const value of Object.values(node)) {
            walk(value);
        }
    }

    walk(payload);

    for (const v of values) {
        const normalized = normalizeLeadPhone(v);
        if (normalized) return { phone: String(v), phoneNormalized: normalized };
    }

    return { phone: '', phoneNormalized: '' };
}

function eventKeyFromPayload(payload) {
    const explicit =
        payload?.id ||
        payload?.event_id ||
        payload?.eventId ||
        payload?.entry?.[0]?.id ||
        payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id ||
        payload?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.id;

    if (explicit) return `meta:${String(explicit)}`;

    const compact = JSON.stringify(payload || {});
    let hash = 0;
    for (let i = 0; i < compact.length; i++) {
        hash = (hash << 5) - hash + compact.charCodeAt(i);
        hash |= 0;
    }
    return `fallback:${String(hash)}:${compact.length}`;
}

function extractMessagesFromPayload(payload) {
    const out = [];
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];
    for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
            const value = change?.value || {};

            const messages = Array.isArray(value?.messages) ? value.messages : [];
            for (const msg of messages) {
                const text = msg?.text?.body || '';
                const from = msg?.from || '';
                const messageId = msg?.id || '';
                const type = msg?.type || 'text';
                const ts = msg?.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();
                const phoneNormalized = normalizeLeadPhone(from);
                if (!phoneNormalized) continue;
                out.push({
                    messageId,
                    phone: from,
                    phoneNormalized,
                    direction: 'inbound',
                    type,
                    text,
                    status: '',
                    occurredAt: Number.isNaN(ts.getTime()) ? new Date() : ts,
                    raw: msg,
                });
            }

            const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
            for (const st of statuses) {
                const recipient = st?.recipient_id || '';
                const messageId = st?.id || '';
                const status = st?.status || '';
                const ts = st?.timestamp ? new Date(Number(st.timestamp) * 1000) : new Date();
                const phoneNormalized = normalizeLeadPhone(recipient);
                if (!phoneNormalized) continue;
                out.push({
                    messageId,
                    phone: recipient,
                    phoneNormalized,
                    direction: 'outbound',
                    type: 'status',
                    text: '',
                    status,
                    occurredAt: Number.isNaN(ts.getTime()) ? new Date() : ts,
                    raw: st,
                });
            }
        }
    }
    return out;
}

async function getDefaultOwnerId() {
    const admin = await User.findOne({ isActive: { $ne: false } }).select('_id').sort({ createdAt: 1 });
    return admin?._id || null;
}

async function createLeadFromWhatsAppPhone({ phone, phoneNormalized, status = 'new', timelineText }) {
    const ownerId = await getDefaultOwnerId();
    if (!ownerId) return null;

    const lead = await Lead.create({
        fullName: `WhatsApp Contact ${phoneNormalized.slice(-4)}`,
        email: '',
        phone: phone || phoneNormalized,
        phoneNormalized,
        status,
        source: 'whatsapp',
        leadDateTime: new Date(),
        storageSizeValue: 25,
        storageSizeUnit: 'sqft',
        durationValue: 1,
        durationUnit: 'month',
        owner: ownerId,
        unitsNeeded: 1,
        notes: '',
        timeline: [
            {
                type: 'whatsapp_created',
                text: timelineText || 'Lead auto-created from WhatsApp webhook',
            },
        ],
    });

    return lead;
}

async function persistMessages(messages) {
    let saved = 0;

    for (const msg of messages) {
        const existing = msg.messageId
            ? await WhatsAppMessage.findOne({ messageId: msg.messageId }).select('_id')
            : null;
        if (existing) continue;

        let lead = await Lead.findOne({ phoneNormalized: msg.phoneNormalized });
        if (!lead && msg.direction === 'inbound') {
            lead = await createLeadFromWhatsAppPhone({
                phone: msg.phone,
                phoneNormalized: msg.phoneNormalized,
                status: 'new',
                timelineText: 'Lead auto-created from inbound WhatsApp chat',
            });
        }

        await WhatsAppMessage.create({
            messageId: msg.messageId,
            phone: msg.phone,
            phoneNormalized: msg.phoneNormalized,
            lead: lead?._id,
            direction: msg.direction,
            type: msg.type,
            text: msg.text,
            status: msg.status,
            occurredAt: msg.occurredAt,
            raw: msg.raw,
        });
        saved += 1;

        if (lead && msg.direction === 'inbound' && msg.text) {
            pushTimeline(lead, 'whatsapp_message', `Inbound WhatsApp message: ${msg.text.slice(0, 200)}`);
            await lead.save();
        }
    }

    whatsappLabelSyncState.messagesSaved += saved;
    return saved;
}

function pushTimeline(lead, type, text) {
    lead.timeline.push({ type, text });
    if (lead.timeline.length > 200) {
        lead.timeline = lead.timeline.slice(-200);
    }
}

export async function processWhatsAppWebhookPayload(payload) {
    const extractedMessages = extractMessagesFromPayload(payload);
    if (extractedMessages.length > 0) {
        await persistMessages(extractedMessages);
    }

    const eventKey = eventKeyFromPayload(payload);

    const existing = await WhatsAppWebhookEvent.findOne({ eventKey }).select('_id status');
    if (existing) {
        whatsappLabelSyncState.skipped += 1;
        return { ok: true, duplicate: true, eventKey };
    }

    const parsed = parsePhoneFromPayload(payload);
    const payloadLabels = parseLabelStringsFromPayload(payload);
    const labels = normalizeLabels(payloadLabels);
    const mappedStatus = mappedStatusFromLabels(labels);

    const eventDoc = await WhatsAppWebhookEvent.create({
        eventKey,
        phoneNormalized: parsed.phoneNormalized,
        labels,
        payload,
        status: 'received',
    });

    if (!parsed.phoneNormalized || !mappedStatus) {
        eventDoc.status = 'skipped';
        eventDoc.detail = !parsed.phoneNormalized ? 'No phone in payload' : 'No mapped label in payload';
        await eventDoc.save();

        whatsappLabelSyncState.processed += 1;
        whatsappLabelSyncState.skipped += 1;
        whatsappLabelSyncState.at = new Date().toISOString();

        if (parsed.phoneNormalized) {
            await WhatsAppLabelState.findOneAndUpdate(
                { phoneNormalized: parsed.phoneNormalized },
                {
                    $set: {
                        phone: parsed.phone || parsed.phoneNormalized,
                        labels,
                        mappedStatus: mappedStatus || '',
                        lastEventKey: eventKey,
                        lastWebhookAt: new Date(),
                    },
                },
                { upsert: true, new: true }
            );
        }

        return { ok: true, skipped: true, reason: eventDoc.detail, eventKey };
    }

    await WhatsAppLabelState.findOneAndUpdate(
        { phoneNormalized: parsed.phoneNormalized },
        {
            $set: {
                phone: parsed.phone || parsed.phoneNormalized,
                labels,
                mappedStatus,
                lastEventKey: eventKey,
                lastWebhookAt: new Date(),
            },
        },
        { upsert: true, new: true }
    );

    let lead = await Lead.findOne({ phoneNormalized: parsed.phoneNormalized });

    if (!lead) {
        if (!labels.includes('lead')) {
            eventDoc.status = 'skipped';
            eventDoc.detail = 'Lead not found and payload is not marked as lead';
            await eventDoc.save();

            whatsappLabelSyncState.processed += 1;
            whatsappLabelSyncState.skipped += 1;
            whatsappLabelSyncState.at = new Date().toISOString();
            return { ok: true, skipped: true, reason: eventDoc.detail, eventKey };
        }

        const ownerId = await getDefaultOwnerId();
        if (!ownerId) {
            eventDoc.status = 'failed';
            eventDoc.detail = 'No active owner found to create lead';
            await eventDoc.save();
            whatsappLabelSyncState.errors += 1;
            whatsappLabelSyncState.lastError = eventDoc.detail;
            whatsappLabelSyncState.at = new Date().toISOString();
            return { ok: false, eventKey, error: eventDoc.detail };
        }

        lead = await Lead.create({
            fullName: `WhatsApp Contact ${parsed.phoneNormalized.slice(-4)}`,
            email: '',
            phone: parsed.phone || parsed.phoneNormalized,
            phoneNormalized: parsed.phoneNormalized,
            status: mappedStatus,
            source: 'whatsapp',
            leadDateTime: new Date(),
            storageSizeValue: 25,
            storageSizeUnit: 'sqft',
            durationValue: 1,
            durationUnit: 'month',
            owner: ownerId,
            unitsNeeded: 1,
            notes: '',
            timeline: [
                {
                    type: 'whatsapp_label_created',
                    text: `Lead auto-created from WhatsApp labels: ${labels.join(', ') || 'none'}`,
                },
            ],
        });

        eventDoc.status = 'processed';
        eventDoc.detail = `Lead created with status ${mappedStatus}`;
        await eventDoc.save();

        whatsappLabelSyncState.processed += 1;
        whatsappLabelSyncState.created += 1;
        whatsappLabelSyncState.at = new Date().toISOString();

        return { ok: true, created: true, leadId: String(lead._id), status: mappedStatus, eventKey };
    }

    const before = lead.status;
    lead.source = lead.source === 'manual' ? 'whatsapp' : lead.source;
    if (before !== mappedStatus) {
        lead.status = mappedStatus;
        pushTimeline(
            lead,
            'whatsapp_label_status',
            `Status changed from ${before} to ${mappedStatus} using WhatsApp labels: ${labels.join(', ')}`
        );
        await lead.save();

        eventDoc.status = 'processed';
        eventDoc.detail = `Lead status updated ${before} -> ${mappedStatus}`;
        await eventDoc.save();

        whatsappLabelSyncState.updated += 1;
    } else {
        pushTimeline(lead, 'whatsapp_label_seen', `Label sync received: ${labels.join(', ')}`);
        await lead.save();

        eventDoc.status = 'skipped';
        eventDoc.detail = `No status change (${mappedStatus})`;
        await eventDoc.save();

        whatsappLabelSyncState.skipped += 1;
    }

    whatsappLabelSyncState.processed += 1;
    whatsappLabelSyncState.at = new Date().toISOString();
    return {
        ok: true,
        updated: before !== mappedStatus,
        leadId: String(lead._id),
        from: before,
        to: mappedStatus,
        eventKey,
    };
}

export async function runWhatsAppLabelReconciliation() {
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    const states = await WhatsAppLabelState.find({}).sort({ updatedAt: -1 }).limit(1000);

    for (const state of states) {
        try {
            if (!state.phoneNormalized || !state.mappedStatus) {
                state.lastReconciledAt = new Date();
                await state.save();
                skipped += 1;
                continue;
            }

            const lead = await Lead.findOne({ phoneNormalized: state.phoneNormalized });
            if (!lead) {
                if (state.labels.includes('lead')) {
                    const ownerId = await getDefaultOwnerId();
                    if (!ownerId) {
                        errors += 1;
                        continue;
                    }
                    await Lead.create({
                        fullName: `WhatsApp Contact ${state.phoneNormalized.slice(-4)}`,
                        email: '',
                        phone: state.phone || state.phoneNormalized,
                        phoneNormalized: state.phoneNormalized,
                        status: state.mappedStatus,
                        source: 'whatsapp',
                        leadDateTime: new Date(),
                        storageSizeValue: 25,
                        storageSizeUnit: 'sqft',
                        durationValue: 1,
                        durationUnit: 'month',
                        owner: ownerId,
                        unitsNeeded: 1,
                        notes: '',
                        timeline: [
                            {
                                type: 'whatsapp_reconcile_created',
                                text: `Lead created by reconciliation with labels: ${state.labels.join(', ')}`,
                            },
                        ],
                    });
                    updated += 1;
                } else {
                    skipped += 1;
                }

                state.lastReconciledAt = new Date();
                await state.save();
                continue;
            }

            if (lead.status !== state.mappedStatus) {
                const before = lead.status;
                lead.status = state.mappedStatus;
                pushTimeline(
                    lead,
                    'whatsapp_reconcile_status',
                    `Reconciliation changed status from ${before} to ${state.mappedStatus} (labels: ${state.labels.join(', ')})`
                );
                await lead.save();
                updated += 1;
            } else {
                skipped += 1;
            }

            state.lastReconciledAt = new Date();
            await state.save();
        } catch {
            errors += 1;
        }
    }

    whatsappLabelSyncState.reconciliationAt = new Date().toISOString();
    whatsappLabelSyncState.reconciliationUpdated = updated;
    whatsappLabelSyncState.reconciliationSkipped = skipped;
    whatsappLabelSyncState.errors += errors;

    return { updated, skipped, errors };
}

export function getWhatsAppLabelSyncStatus() {
    return {
        ...whatsappLabelSyncState,
        configured: Boolean(process.env.WHATSAPP_LABEL_SYNC_ENABLED === 'true'),
    };
}
