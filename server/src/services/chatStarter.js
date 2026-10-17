import { Lead, User, WhatsAppMessage } from '../models/index.js';

/**
 * Whoever is logged in and messages a chat nobody owns becomes its owner.
 *
 * Every rep has their own login, and every message sent from the CRM records
 * who sent it (WhatsAppMessage.sentBy). That is the only thing trusted here:
 * a chat started from the WhatsApp Business app on the shared phone carries
 * no login, so the distribution rules place it. A lead somebody already owns
 * — given by hand or by the rules — is never taken away.
 */

const keptNote = (name) => `Assigned to ${name}, who messaged this chat from their CRM login`;

/** The active user who sent our opening messages from the CRM, or null. */
export async function starterOfChat(phoneNormalized, { pending = [] } = {}) {
    if (!phoneNormalized) return null;
    const stored = await WhatsAppMessage.find({ phoneNormalized })
        .sort({ occurredAt: 1 }).limit(10)
        .select('direction sentBy occurredAt').lean();
    const messages = [...stored, ...pending].sort((a, b) => new Date(a.occurredAt || 0) - new Date(b.occurredAt || 0));
    if (!messages.length || messages[0].direction !== 'outbound') return null;

    // Our opening messages, up to the customer's first reply.
    for (const m of messages) {
        if (m.direction !== 'outbound') break;
        if (!m.sentBy) continue;
        const u = await User.findById(m.sentBy).select('name role isActive').lean();
        if (u && u.isActive !== false) return u;
    }
    return null;
}

/**
 * Called after a colleague sends from the CRM. No lead for the number: create
 * one on them. A lead nobody owns: it becomes theirs. Owned: left alone.
 * Signed tenants are not sales leads and are skipped.
 */
export async function keepChatWithSender({ phone, phoneNormalized, userId }) {
    if (!phoneNormalized || !userId) return null;
    const user = await User.findById(userId).select('name isActive').lean();
    if (!user || user.isActive === false) return null;

    const lead = await Lead.findOne({ phoneNormalized }).select('_id owner status').lean();
    if (lead) {
        // Closed or already a tenant: not a sales lead to hand out (the sweep skips these too).
        if (lead.owner || ['won', 'lost', 'already_customer'].includes(lead.status)) return null;
        const now = new Date();
        // owner: null in the filter — never overwrite someone who got it meanwhile.
        const claimed = await Lead.updateOne({ _id: lead._id, owner: null }, {
            $set: { owner: user._id, assignedAt: now, autoAssigned: false, assignedBy: user._id, ownerSeenAt: now },
            $push: { timeline: { type: 'note', text: keptNote(user.name) } },
        });
        // No "you were given a lead" alert: they are the one who just acted.
        return claimed.modifiedCount ? lead : null;
    }

    const { isExistingCustomerPhone } = await import('./customerLeads.js');
    if (await isExistingCustomerPhone(phoneNormalized).catch(() => false)) return null;
    const { createLeadFromWhatsAppPhone } = await import('./whatsappLeadSync.js');
    const created = await createLeadFromWhatsAppPhone({
        phone: phone || phoneNormalized,
        phoneNormalized,
        status: 'new',
        timelineText: `Lead created when ${user.name} started this chat from the CRM`,
        ownerId: user._id,
        ownerNote: keptNote(user.name),
        notify: false,
    });
    if (created) await WhatsAppMessage.updateMany({ phoneNormalized, lead: null }, { $set: { lead: created._id } });
    return created;
}

export { keptNote };

/**
 * A colleague replied on WhatsApp from the CRM, so the stage catches up by
 * itself — the same way logging a call attempt already moves New on.
 *
 *   they have written to us  -> Contacted (we are in a conversation)
 *   they never have          -> Contact attempted (we reached out, no answer yet)
 *
 * Only moves a lead forward from New (or from Contact attempted to Contacted
 * once they have written); anything further along is left exactly as it is.
 * Saved through the document so stageHistory records the move.
 */
export async function advanceStageOnReply(phoneNormalized) {
    if (!phoneNormalized) return null;
    const lead = await Lead.findOne({ phoneNormalized });
    if (!lead || !['new', 'contact_attempted'].includes(lead.status)) return null;
    const theyWrote = await WhatsAppMessage.exists({ phoneNormalized, direction: 'inbound' });
    const next = theyWrote ? 'contacted' : 'contact_attempted';
    if (lead.status === next) return null;
    lead.status = next;
    lead.timeline.push({ type: 'note', text: `Moved to ${next === 'contacted' ? 'Contacted' : 'Contact attempted'} — replied on WhatsApp` });
    await lead.save();
    return next;
}
