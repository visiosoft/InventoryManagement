import {
    Lead,
    User,
    WhatsAppLabelState,
    WhatsAppMessage,
} from '../../../server/src/models/index.js';

function normalizePhone(input) {
    let d = String(input || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    return d;
}

function numericHash(input) {
    const text = String(input || '').toLowerCase().trim();
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
        hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return String(hash % 10000000000).padStart(10, '0');
}

function resolvePhoneIdentity(conversation, options) {
    const rawDigits = normalizePhone(conversation.phone);
    if (rawDigits) {
        return {
            phoneDisplay: conversation.phone || rawDigits,
            phoneNormalized: rawDigits,
            isSynthetic: false,
        };
    }

    const allowSynthetic = String(options.allowSyntheticPhone ?? 'true').toLowerCase() === 'true';
    if (!allowSynthetic) return null;

    const title = String(conversation.chatTitle || 'unknown-chat');
    const phoneNormalized = `999999${numericHash(title)}`;
    return {
        phoneDisplay: `wa:${title}`,
        phoneNormalized,
        isSynthetic: true,
    };
}

function mapStatusFromLabels(labels) {
    const source = labels.map((x) => String(x).toLowerCase());
    if (source.some((x) => x.includes('won') || x.includes('closed won'))) return 'won';
    if (source.some((x) => x.includes('lost') || x.includes('closed lost'))) return 'lost';
    if (source.some((x) => x.includes('proposal'))) return 'proposal_sent';
    if (source.some((x) => x.includes('qualif'))) return 'qualified';
    if (source.some((x) => x.includes('contacted') || x.includes('follow up'))) return 'contacted';
    if (source.length > 0) return 'new';
    return '';
}

function normalizeLabel(value) {
    return String(value || '').trim();
}

function canonicalizeToken(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

function sanitizeConversationLabels(labels, conversation) {
    const clean = Array.from(new Set((labels || []).map(normalizeLabel).filter(Boolean)));
    const titleCandidates = [
        conversation?.chatTitle,
        conversation?.rowTitle,
        conversation?.rowPreview,
    ]
        .map((v) => String(v || '').trim())
        .filter(Boolean);

    const canonicalTitleSet = new Set(
        titleCandidates
            .map((value) => canonicalizeToken(value))
            .filter(Boolean)
    );

    return clean.filter((label) => {
        const canonicalLabel = canonicalizeToken(label);
        if (!canonicalLabel) return false;
        return !canonicalTitleSet.has(canonicalLabel);
    });
}

function filterAllowedLabels(labels, options) {
    const cleanLabels = Array.from(new Set((labels || []).map(normalizeLabel).filter(Boolean)));
    const allowlist = Array.isArray(options?.allowedLabels)
        ? Array.from(new Set(options.allowedLabels.map(normalizeLabel).filter(Boolean)))
        : [];

    if (allowlist.length === 0) {
        return cleanLabels;
    }

    const allowMap = new Map(allowlist.map((label) => [label.toLowerCase(), label]));
    const filtered = cleanLabels
        .map((label) => allowMap.get(label.toLowerCase()) || '')
        .filter(Boolean);

    return Array.from(new Set(filtered));
}

function cleanName(chatTitle, phoneNormalized) {
    const title = String(chatTitle || '').trim();
    if (!title) return `WhatsApp ${phoneNormalized.slice(-4)}`;

    const looksLikeNumber = /^\+?[0-9\s()-]+$/.test(title);
    if (looksLikeNumber) return `WhatsApp ${phoneNormalized.slice(-4)}`;
    return title;
}

function isPlaceholderLeadName(value) {
    const text = String(value || '').trim();
    return /^Chat\s+\d+$/i.test(text) || /^WhatsApp\s+\d{4}$/i.test(text);
}

function isPlaceholderPhone(value) {
    return /^wa:Chat\s+\d+$/i.test(String(value || '').trim());
}

function buildLeadNotes(conversation, isSynthetic) {
    const parts = [];
    if (isSynthetic) {
        parts.push('Auto-created from WhatsApp sync (no phone exposed by WhatsApp Web, synthetic key used).');
    } else {
        parts.push('Auto-created from WhatsApp sync.');
    }
    if (conversation.rowPreview) {
        parts.push(`Last chat preview: ${conversation.rowPreview}`);
    }
    if (conversation.rowTimeText) {
        parts.push(`Chat list time: ${conversation.rowTimeText}`);
    }
    return parts.join(' ');
}

function logLeadSync(action, payload) {
    const parts = [
        `[WhatsAppLead][Lead] ${action}`,
        `name="${String(payload.name || '').replace(/"/g, '')}"`,
        `phone="${String(payload.phone || '').replace(/"/g, '')}"`,
        `key=${payload.phoneNormalized || ''}`,
        `messages=${payload.messageCount ?? 0}`,
    ];

    if (payload.isSynthetic) {
        parts.push('syntheticPhone=true');
    }

    if (payload.labels?.length) {
        parts.push(`labels=${payload.labels.join('|')}`);
    }

    console.log(parts.join(' '));
}

async function resolveOwner(defaultOwnerEmail) {
    if (defaultOwnerEmail) {
        const byEmail = await User.findOne({ email: String(defaultOwnerEmail).toLowerCase().trim() }).select('_id');
        if (byEmail) return byEmail;
    }

    const fallback = await User.findOne({ isActive: true }).sort({ role: 1, createdAt: 1 }).select('_id');
    if (!fallback) {
        throw new Error('No active users found to assign WhatsApp leads. Create a user first.');
    }
    return fallback;
}

export async function upsertConversationBatch(conversations, options) {
    const owner = await resolveOwner(options.defaultOwnerEmail);
    const allowlist = Array.isArray(options?.allowedLabels)
        ? Array.from(new Set(options.allowedLabels.map(normalizeLabel).filter(Boolean)))
        : [];
    const syncOnlyAllowedLabels = String(options?.syncOnlyAllowedLabels ?? 'false').toLowerCase() === 'true';

    let createdLeads = 0;
    let updatedLeads = 0;
    let savedMessages = 0;
    let skippedByLabel = 0;

    for (const conversation of conversations) {
        // Skip contacts with no WhatsApp labels at all
        const rawLabels = (conversation.labels || []).map(normalizeLabel).filter(Boolean);
        if (rawLabels.length === 0) {
            skippedByLabel += 1;
            continue;
        }

        const labels = filterAllowedLabels(rawLabels, options);
        if (syncOnlyAllowedLabels && allowlist.length > 0 && labels.length === 0) {
            skippedByLabel += 1;
            continue;
        }

        // Use sanitized labels for storage (strips labels that look like the contact's own name)
        const sanitizedLabels = sanitizeConversationLabels(rawLabels, conversation);

        const identity = resolvePhoneIdentity(conversation, options);
        if (!identity) continue;

        const { phoneNormalized, phoneDisplay, isSynthetic } = identity;

        let lead = await Lead.findOne({ phoneNormalized });
        if (!lead) {
            lead = await Lead.create({
                fullName: cleanName(conversation.chatTitle, phoneNormalized),
                email: '',
                phone: phoneDisplay,
                phoneNormalized,
                status: 'new',
                source: 'whatsapp',
                leadDateTime: new Date(),
                storageSizeValue: 0,
                storageSizeUnit: 'sqft',
                durationValue: 1,
                durationUnit: 'month',
                owner: owner._id,
                unitsNeeded: 1,
                notes: buildLeadNotes(conversation, isSynthetic),
                timeline: [{ type: 'created', text: 'Lead auto-created from WhatsApp desktop scrape.' }],
            });
            createdLeads += 1;
            logLeadSync('created', {
                name: lead.fullName,
                phone: lead.phone,
                phoneNormalized,
                messageCount: conversation.messages?.length || 0,
                isSynthetic,
                labels: conversation.labels,
            });
        } else {
            // Merge: update existing lead with WhatsApp data without overwriting good data
            const waName = cleanName(conversation.chatTitle, phoneNormalized);
            const updates = {};

            // Upgrade source to whatsapp if it was manual/google so we know it's on WA
            if (lead.source !== 'whatsapp') updates.source = 'whatsapp';

            // Only overwrite name if existing name is a placeholder and WA has a real name
            if (isPlaceholderLeadName(lead.fullName) && !isPlaceholderLeadName(waName)) {
                updates.fullName = waName;
            }

            // Fill in phone display if existing record has a synthetic/placeholder phone
            if (isPlaceholderPhone(lead.phone) && !isSynthetic) {
                updates.phone = phoneDisplay;
            }

            if (Object.keys(updates).length > 0) {
                await Lead.findByIdAndUpdate(lead._id, {
                    $set: updates,
                    $push: { timeline: { type: 'whatsapp_merge', text: 'Lead merged with WhatsApp contact.' } },
                });
            }

            updatedLeads += 1;
            logLeadSync('merged', {
                name: lead.fullName,
                phone: lead.phone,
                phoneNormalized,
                messageCount: conversation.messages?.length || 0,
                isSynthetic,
                labels: conversation.labels,
            });
        }

        const mappedStatus = mapStatusFromLabels(labels);

        await WhatsAppLabelState.findOneAndUpdate(
            { phoneNormalized },
            {
                phone: phoneDisplay,
                phoneNormalized,
                labels,
                mappedStatus,
                lastEventKey: `scrape:${Date.now()}:${phoneNormalized}`,
                lastWebhookAt: new Date(),
                lastReconciledAt: new Date(),
            },
            { upsert: true, new: true }
        );

        const maxStoreMessages = Math.max(1, options.maxStoreMessages || 10);
        const messagesToStore = (conversation.messages || [])
            .slice(-maxStoreMessages);

        const ops = messagesToStore.map((msg, idx) => {
            const messageId = String(msg.messageId || `scraped:${phoneNormalized}:${idx}:${msg.occurredAt || ''}:${msg.text || ''}`).slice(0, 180);
            const occurredAt = msg.occurredAt ? new Date(msg.occurredAt) : new Date();
            const messageType = String(msg.type || 'text').trim() || 'text';

            return {
                updateOne: {
                    filter: { messageId },
                    update: {
                        $setOnInsert: {
                            messageId,
                            phone: phoneDisplay,
                            phoneNormalized,
                            lead: lead._id,
                            direction: msg.direction === 'outbound' ? 'outbound' : 'inbound',
                            type: messageType,
                            text: String(msg.text || '').trim(),
                            status: 'imported',
                            occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
                            raw: {
                                importedFrom: 'whatsapp-web-scraper',
                                labels,
                                media: msg.media || {},
                                links: msg.links || [],
                                meta: msg.raw || {},
                            },
                        },
                    },
                    upsert: true,
                },
            };
        });

        if (ops.length > 0) {
            const result = await WhatsAppMessage.bulkWrite(ops, { ordered: false });
            savedMessages += Number(result.upsertedCount || 0);
        }
    }

    return {
        scannedConversations: conversations.length,
        createdLeads,
        updatedLeads,
        savedMessages,
        skippedByLabel,
    };
}

export async function listWhatsAppContacts(limit = 200) {
    const leads = await Lead.find({ source: 'whatsapp' })
        .select('fullName phone phoneNormalized status source leadDateTime notes updatedAt createdAt')
        .sort({ updatedAt: -1 })
        .limit(Math.max(1, Math.min(limit, 500)));

    const phoneNormalizedList = leads.map((x) => x.phoneNormalized).filter(Boolean);

    const [labels, messages] = await Promise.all([
        WhatsAppLabelState.find({ phoneNormalized: { $in: phoneNormalizedList } })
            .select('phoneNormalized labels mappedStatus updatedAt')
            .lean(),
        WhatsAppMessage.aggregate([
            { $match: { phoneNormalized: { $in: phoneNormalizedList } } },
            { $sort: { occurredAt: -1, createdAt: -1 } },
            {
                $group: {
                    _id: '$phoneNormalized',
                    totalMessages: { $sum: 1 },
                    lastFiveMessages: {
                        $push: {
                            messageId: '$messageId',
                            text: '$text',
                            direction: '$direction',
                            occurredAt: '$occurredAt',
                        },
                    },
                },
            },
            {
                $project: {
                    totalMessages: 1,
                    lastFiveMessages: { $slice: ['$lastFiveMessages', 5] },
                },
            },
        ]),
    ]);

    const labelByPhone = new Map(labels.map((x) => [x.phoneNormalized, x]));
    const messagesByPhone = new Map(messages.map((x) => [x._id, x]));

    return leads.map((lead) => {
        const phoneData = messagesByPhone.get(lead.phoneNormalized);
        const labelData = labelByPhone.get(lead.phoneNormalized);

        const hasSyntheticPhone = String(lead.phoneNormalized || '').startsWith('999999');

        return {
            lead,
            labels: labelData?.labels || [],
            mappedStatus: labelData?.mappedStatus || '',
            totalMessages: phoneData?.totalMessages || 0,
            lastFiveMessages: phoneData?.lastFiveMessages || [],
            whatsappWebLink: hasSyntheticPhone
                ? 'https://web.whatsapp.com/'
                : `https://web.whatsapp.com/send?phone=${lead.phoneNormalized}`,
        };
    });
}

export async function listLeadMessages(leadId, limit = 50) {
    const lead = await Lead.findById(leadId).select('fullName phone phoneNormalized');
    if (!lead) return null;

    const messages = await WhatsAppMessage.find({ phoneNormalized: lead.phoneNormalized })
        .select('messageId text direction occurredAt status createdAt')
        .sort({ occurredAt: -1, createdAt: -1 })
        .limit(Math.max(1, Math.min(limit, 300)));

    return {
        lead,
        messages,
        whatsappWebLink: `https://web.whatsapp.com/send?phone=${lead.phoneNormalized}`,
    };
}
