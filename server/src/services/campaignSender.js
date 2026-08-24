import { Campaign, CampaignRecipient } from '../models/index.js';
import { mailConfigured, sendMail } from '../services/mail.js';
import { sendWhatsAppTemplate, whatsappSendConfigured } from './whatsapp.js';

/**
 * Works through campaigns that are sending, a slice at a time.
 *
 * Deliberately not done inside the HTTP request that starts a campaign: several
 * hundred sends take minutes, and a request that long would time out somewhere
 * in the middle with no way to tell what had gone out.
 *
 * Each recipient is claimed before it is sent, so a crash mid-send loses one
 * message rather than repeating the batch — for marketing, sending twice is the
 * worse failure.
 */

// Small enough that a restart wastes little, large enough to make progress.
const BATCH = 25;

// Gmail's daily cap is shared with invoices and password resets, and WhatsApp
// throttles per second. Pausing between batches keeps a campaign from spending
// the whole allowance at once.
const PAUSE_MS = 1000;

export const campaignState = {
    at: null, running: false, sent: 0, failed: 0, lastError: '',
};

const stripHtml = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function sendOne(campaign, recipient) {
    if (recipient.channel === 'email') {
        if (!mailConfigured()) throw new Error('Email is not configured');
        // Sent individually rather than BCC: a campaign needs to record who
        // received it, and later to carry a per-person unsubscribe link.
        await sendMail({
            to: recipient.email,
            subject: campaign.emailSubject,
            html: campaign.emailHtml,
            text: stripHtml(campaign.emailHtml),
        });
        return;
    }

    if (!whatsappSendConfigured()) throw new Error('WhatsApp is not configured');
    await sendWhatsAppTemplate({
        to: recipient.phoneNormalized,
        name: campaign.whatsapp?.templateName,
        language: campaign.whatsapp?.language || 'en',
        variables: campaign.whatsapp?.variables || [],
    });
}

export async function runCampaignTick() {
    if (campaignState.running) return { skipped: 'already running' };
    campaignState.running = true;
    try {
        const campaign = await Campaign.findOne({ status: 'sending' }).sort({ startedAt: 1 });
        if (!campaign) return { idle: true };

        const batch = await CampaignRecipient.find({ campaign: campaign._id, status: 'pending' }).limit(BATCH);

        if (!batch.length) {
            const [sent, failed, skipped] = await Promise.all([
                CampaignRecipient.countDocuments({ campaign: campaign._id, status: 'sent' }),
                CampaignRecipient.countDocuments({ campaign: campaign._id, status: 'failed' }),
                CampaignRecipient.countDocuments({ campaign: campaign._id, status: 'skipped' }),
            ]);
            campaign.stats = { ...campaign.stats, sent, failed, skipped };
            campaign.status = 'sent';
            campaign.finishedAt = new Date();
            await campaign.save();
            return { finished: String(campaign._id), sent, failed, skipped };
        }

        for (const recipient of batch) {
            // Claim it first. If the process dies during the send this message
            // is lost rather than sent twice, which is the safer way to fail.
            const claimed = await CampaignRecipient.findOneAndUpdate(
                { _id: recipient._id, status: 'pending' },
                { $set: { status: 'sent', sentAt: new Date() } },
            );
            if (!claimed) continue; // another pass already took it

            try {
                await sendOne(campaign, recipient);
                campaignState.sent += 1;
            } catch (e) {
                await CampaignRecipient.updateOne(
                    { _id: recipient._id },
                    { $set: { status: 'failed', reason: e.message || 'Send failed', sentAt: null } },
                );
                campaignState.failed += 1;
                campaignState.lastError = e.message || 'Send failed';
            }
        }

        const [sent, failed] = await Promise.all([
            CampaignRecipient.countDocuments({ campaign: campaign._id, status: 'sent' }),
            CampaignRecipient.countDocuments({ campaign: campaign._id, status: 'failed' }),
        ]);
        campaign.stats = { ...campaign.stats, sent, failed };
        await campaign.save();

        campaignState.at = new Date().toISOString();
        await new Promise((r) => setTimeout(r, PAUSE_MS));
        return { campaign: String(campaign._id), processed: batch.length, sent, failed };
    } catch (e) {
        campaignState.lastError = e.message || 'unknown error';
        return { error: campaignState.lastError };
    } finally {
        campaignState.running = false;
    }
}
