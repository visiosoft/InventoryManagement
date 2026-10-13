import { Campaign, CampaignRecipient } from '../models/index.js';

/**
 * What happened to a campaign after it left.
 *
 * Meta tells us three things about each message — sent, delivered, read — and
 * the chat itself tells us the fourth, a reply. A "read" only arrives when the
 * person has read receipts switched on, so it is a floor, not a count: somebody
 * who read it with receipts off shows as delivered.
 */

const FOURTEEN_DAYS = 14 * 86_400_000;

/** A delivery receipt from the webhook, matched to the recipient by message id. */
export async function applyCampaignStatus({ messageId, status, occurredAt, errorDetail, errorTitle }) {
    if (!messageId || !status) return false;
    const at = occurredAt || new Date();
    const set = {};
    if (status === 'delivered') set.deliveredAt = at;
    else if (status === 'read') { set.readAt = at; set.deliveredAt = at; }
    else if (status === 'failed') { set.status = 'failed'; set.reason = errorTitle || 'Meta could not deliver it'; set.errorDetail = errorDetail || ''; }
    else return false;
    const r = await CampaignRecipient.updateOne({ messageId }, { $set: set });
    return r.matchedCount > 0;
}

/** Somebody wrote in: credit the most recent campaign message they were sent. */
export async function markCampaignReply(phoneNormalized, at = new Date()) {
    if (!phoneNormalized) return false;
    const r = await CampaignRecipient.findOneAndUpdate(
        { phoneNormalized, channel: 'whatsapp', status: 'sent', repliedAt: null, sentAt: { $gte: new Date(Date.now() - FOURTEEN_DAYS) } },
        { $set: { repliedAt: at } },
        { sort: { sentAt: -1 } },
    );
    return Boolean(r);
}

const SEGMENTS = {
    not_read: { status: 'sent', readAt: null },
    not_delivered: { status: 'sent', deliveredAt: null, readAt: null },
    read_no_reply: { status: 'sent', readAt: { $ne: null }, repliedAt: null },
    delivered_no_reply: { status: 'sent', deliveredAt: { $ne: null }, repliedAt: null },
    replied: { status: 'sent', repliedAt: { $ne: null } },
    failed: { status: 'failed' },
};
export const SEGMENT_LABELS = {
    not_read: "Didn't read it",
    not_delivered: 'Not delivered',
    read_no_reply: 'Read it, no reply',
    delivered_no_reply: 'Delivered, no reply',
    replied: 'Replied',
    failed: 'Failed',
};

export function segmentFilter(campaignId, segment) {
    const f = SEGMENTS[segment];
    return f ? { campaign: campaignId, channel: 'whatsapp', ...f } : null;
}

/** The funnel for one campaign. */
export async function campaignFunnel(campaignId) {
    const base = { campaign: campaignId, channel: 'whatsapp' };
    const [targeted, sent, delivered, read, replied, failed] = await Promise.all([
        CampaignRecipient.countDocuments(base),
        CampaignRecipient.countDocuments({ ...base, status: 'sent' }),
        CampaignRecipient.countDocuments({ ...base, status: 'sent', $or: [{ deliveredAt: { $ne: null } }, { readAt: { $ne: null } }] }),
        CampaignRecipient.countDocuments({ ...base, status: 'sent', readAt: { $ne: null } }),
        CampaignRecipient.countDocuments({ ...base, status: 'sent', repliedAt: { $ne: null } }),
        CampaignRecipient.countDocuments({ ...base, status: 'failed' }),
    ]);
    return { targeted, sent, delivered, read, replied, failed };
}

/** The funnel for every campaign, for the list. */
export async function allFunnels() {
    const rows = await CampaignRecipient.aggregate([
        { $match: { channel: 'whatsapp' } },
        {
            $group: {
                _id: '$campaign',
                targeted: { $sum: 1 },
                sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
                delivered: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'sent'] }, { $or: [{ $ne: ['$deliveredAt', null] }, { $ne: ['$readAt', null] }] }] }, 1, 0] } },
                read: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'sent'] }, { $ne: ['$readAt', null] }] }, 1, 0] } },
                replied: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'sent'] }, { $ne: ['$repliedAt', null] }] }, 1, 0] } },
                failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
            },
        },
    ]);
    return new Map(rows.map((r) => [String(r._id), r]));
}

export { Campaign };
