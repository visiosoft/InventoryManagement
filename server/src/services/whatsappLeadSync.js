import { Lead, User, WhatsAppLabelState, WhatsAppWebhookEvent, WhatsAppMessage } from '../models/index.js';
import { routeInboundLead } from './leadRouting.js';
import { notifyLeadAssigned } from './leadNotify.js';
import { normalizeLeadPhone } from '../routes/leads.js';
import { noteInboundForBot, pauseBotForHuman } from './aiBot.js';

const DEFAULT_STATUS_BY_LABEL = {
    lead: 'new',
    'new customer': 'contacted',
    // A WhatsApp label saying follow-up is exactly the CRM's own bucket.
    followup: 'follow_up_scheduled',
    'site visit': 'site_visit_scheduled',
    lost: 'lost',
    won: 'won',
};

const LABEL_ALIASES = {
    leads: 'lead',
    follow_up: 'followup',
    'follow up': 'followup',
    sitevisit: 'site visit',
    site_visit: 'site visit',
    visit: 'site visit',
    'new_customer': 'new customer',
};

const LABEL_PRIORITY = ['lost', 'won', 'followup', 'new customer', 'lead'];

const ALLOWED_LEAD_STATUS = new Set(['new', 'contact_attempted', 'contacted', 'site_visit_scheduled', 'follow_up_scheduled', 'quotation_sent', 'won', 'lost']);

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

export function extractMessagesFromPayload(payload) {
    const out = [];
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];
    for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
            const value = change?.value || {};

            // Our own number, so a message "from" it is one of ours going out.
            const ourNumber = normalizeLeadPhone(value?.metadata?.display_phone_number || '');

            // Messages staff send from the WhatsApp Business app come back as
            // echoes rather than under `messages`. Meta has used more than one
            // name for the field depending on the Coexistence setup, so match
            // on the suffix rather than pinning one spelling.
            const echoKeys = Object.keys(value).filter((k) => k.endsWith('message_echoes'));
            const echoes = echoKeys.flatMap((k) => (Array.isArray(value[k]) ? value[k] : []));

            const messages = Array.isArray(value?.messages) ? value.messages : [];

            // Meta sends the sender's own profile name beside the messages,
            // keyed by number. It is the only name we get for somebody nobody
            // here has saved, and it was being thrown away.
            const profileNames = new Map();
            for (const c of Array.isArray(value?.contacts) ? value.contacts : []) {
                const key = normalizeLeadPhone(c?.wa_id || '');
                const name = String(c?.profile?.name || '').trim();
                if (key && name) profileNames.set(key, name);
            }

            for (const msg of [...messages, ...echoes]) {
                const text = msg?.text?.body || '';
                const messageId = msg?.id || '';
                const type = msg?.type || 'text';
                const ts = msg?.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();

                // An echo carries `to`; an inbound message carries `from`. A
                // message whose `from` is our own number is also outbound —
                // some setups deliver echoes inside `messages` rather than in
                // a field of their own.
                const from = msg?.from || '';
                const outbound = Boolean(msg?.to) || (ourNumber && normalizeLeadPhone(from) === ourNumber);
                const counterparty = outbound ? (msg?.to || '') : from;

                const phoneNormalized = normalizeLeadPhone(counterparty);
                if (!phoneNormalized) continue;

                // An edit, a delete or a reaction is a change to a message we
                // already hold, not a new one. Each names its target, so it is
                // carried as a control record and applied rather than stored.
                const target = msg?.edit?.original_message_id
                    || msg?.revoke?.original_message_id
                    || msg?.reaction?.message_id
                    || '';

                out.push({
                    messageId,
                    phone: counterparty,
                    phoneNormalized,
                    direction: outbound ? 'outbound' : 'inbound',
                    type,
                    text: type === 'edit' ? (msg?.edit?.message?.text?.body || '')
                        : type === 'reaction' ? (msg?.reaction?.emoji || '')
                        : text,
                    targetMessageId: target,
                    status: outbound ? 'sent' : '',
                    occurredAt: Number.isNaN(ts.getTime()) ? new Date() : ts,
                    // Only for inbound: on an echo the contact is us.
                    profileName: outbound ? '' : (profileNames.get(phoneNormalized) || ''),
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

export async function createLeadFromWhatsAppPhone({ phone, phoneNormalized, status = 'new', timelineText, fullName, ownerId: ownerOverride, profileName = '' }) {
    /* Who this belongs to.
     *
     * An explicit owner wins — somebody saving a chat as a lead has already
     * chosen. Otherwise the distribution rules decide: by share, by who is on
     * shift, and by what has gone out today. See services/leadRouting.js.
     *
     * With distribution switched off this is exactly what it always was, the
     * first user on the system, so turning it on is a decision somebody makes
     * rather than something that happens to them. */
    let ownerId = ownerOverride || null;
    let routingNote = '';
    if (!ownerId) {
        const decision = await routeInboundLead({ phoneNormalized }).catch(() => null);
        if (decision && !decision.off) {
            ownerId = decision.ownerId;
            routingNote = decision.ownerId
                ? `Assigned by distribution rules — ${decision.reason}`
                : `Left unassigned — ${decision.reason}`;
        } else {
            ownerId = await getDefaultOwnerId();
        }
    }
    // An unowned lead is a real outcome out of hours; only a lead with nobody
    // to give it to and no rules at all is a failure.
    if (!ownerId && !routingNote) return null;

    const lead = await Lead.create({
        fullName: String(fullName || '').trim() || `WhatsApp Contact ${phoneNormalized.slice(-4)}`,
        whatsappProfileName: String(profileName || '').trim(),
        email: '',
        phone: phone || phoneNormalized,
        phoneNormalized,
        status,
        source: 'whatsapp',
        leadDateTime: new Date(),
        // Left unset: nobody has asked them what size they need yet.
        storageSizeValue: 0,
        storageSizeUnit: 'sqft',
        durationValue: 1,
        durationUnit: 'month',
        owner: ownerId,
        /* A lead the rules handed to somebody is a lead they have been given,
           so it starts their response clock and shows on their board — unlike
           the auto-created contacts that exist only to hang messages off. */
        assignedAt: routingNote && ownerId ? new Date() : null,
        // The rota counts its own work when deciding whose turn is next.
        autoAssigned: Boolean(routingNote && ownerId),
        unitsNeeded: 1,
        notes: '',
        timeline: [
            {
                type: 'whatsapp_created',
                text: timelineText || 'Lead auto-created from WhatsApp webhook',
            },
            // Why this person and not another. Worth having when somebody asks.
            ...(routingNote ? [{ type: 'note', text: routingNote }] : []),
        ],
    });

    /* Tell them. A lead that lands silently on a board is found the next time
       somebody happens to look, which for a WhatsApp enquiry is far too late.
       Deliberately not awaited into the caller's failure path — a webhook must
       not fail because a mail server is slow. */
    if (routingNote && ownerId) {
        notifyLeadAssigned({ lead, ownerId, reason: routingNote.replace(/^Assigned by distribution rules — /, '') })
            .catch((e) => console.error('[WhatsAppLeadSync] notify failed:', e.message));
    }

    return lead;
}

async function persistMessages(messages) {
    let saved = 0;

    for (const msg of messages) {
        // A delivery receipt carries the same id as the message it refers to.
        // It updates that message's status — it is never a message of its own,
        // and storing it as one produced empty "[status]" bubbles in the chat.
        if (msg.type === 'status') {
            if (msg.messageId && msg.status) {
                await WhatsAppMessage.updateOne(
                    { messageId: msg.messageId },
                    { $set: { status: msg.status } },
                );
            }
            continue;
        }

        // Edits, deletions and reactions change a message already in the
        // thread. Storing them as bubbles of their own is what produced the
        // blank rows in the console — an edit showed as a second message and a
        // deletion as an empty one.
        if (msg.type === 'edit' || msg.type === 'revoke' || msg.type === 'reaction') {
            if (msg.targetMessageId) {
                const change =
                    msg.type === 'edit' ? { text: msg.text, editedAt: msg.occurredAt }
                    : msg.type === 'revoke' ? { deletedAt: msg.occurredAt }
                    // An empty emoji is how WhatsApp says a reaction was removed.
                    : { reaction: msg.text || '' };
                await WhatsAppMessage.updateOne({ messageId: msg.targetMessageId }, { $set: change });
            }
            continue;
        }

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
                profileName: msg.profileName,
            });
        } else if (lead && msg.profileName && lead.whatsappProfileName !== msg.profileName) {
            // People rename themselves. Kept current, and never allowed to
            // overwrite a name somebody here typed.
            await Lead.updateOne({ _id: lead._id }, { $set: { whatsappProfileName: msg.profileName } });
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

        // Hand the message to the AI assistant's queue. Inbound only — noting
        // our own outbound messages would have it answering itself. The worker
        // decides whether to reply; this only records that something arrived,
        // so the webhook still returns to Meta immediately.
        if (msg.direction === 'inbound') {
            try {
                await noteInboundForBot({
                    phoneNormalized: msg.phoneNormalized,
                    messageId: msg.messageId,
                    text: msg.text,
                    type: msg.type,
                    occurredAt: msg.occurredAt,
                });
            } catch { /* the assistant must never break message delivery */ }
        } else {
            // A new outbound message we did not send ourselves is a colleague
            // replying from the WhatsApp Business app, so the assistant stands
            // back exactly as it does when someone types in the console.
            // Messages we sent — including the assistant's own — were stored
            // when they were sent and are skipped as duplicates above, so they
            // never reach this line.
            try {
                await pauseBotForHuman(msg.phoneNormalized);
            } catch { /* the assistant must never break message delivery */ }
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
            // Left unset: nobody has asked them what size they need yet.
        storageSizeValue: 0,
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
                        // Left unset: nobody has asked them what size they need yet.
        storageSizeValue: 0,
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
