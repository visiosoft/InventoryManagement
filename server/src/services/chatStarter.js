import { Lead, User, WhatsAppMessage } from '../models/index.js';

/**
 * Who started a WhatsApp chat, so the lead stays with them.
 *
 * A rep who opens a conversation — a referral, someone who rang — owns it.
 * The distribution rules are only for chats nobody here started. Two ways to
 * know the starter:
 *   1. the chat was opened from the CRM, which records who pressed send;
 *   2. it was opened from the WhatsApp Business app on the shared number,
 *      where the only trace is the rep introducing themselves
 *      ("This is Emad from PurpleBox", "My name is Randa").
 * If neither says, the starter is unknown and the rules decide.
 */

const INTRO_PATTERNS = [
    /\b(?:this is|i am|i'm|im|my name is|it's|its)\s+([a-z]{2,})\b/i,
    /\b([a-z]{2,})\s+(?:here\b|from\s+(?:the\s+)?purple\s?box)/i,
];

// Words that follow "I am" / "this is" without being a name.
const NOT_NAMES = new Set([
    'the', 'a', 'an', 'your', 'our', 'from', 'here', 'just', 'calling', 'contacting', 'reaching',
    'writing', 'following', 'checking', 'sorry', 'glad', 'happy', 'available', 'interested', 'not',
    'regarding', 'about', 'with', 'purplebox', 'purple', 'storage', 'sending', 'sharing', 'okay', 'ok',
    'good', 'fine', 'hello', 'hi', 'dear', 'sir', 'madam', 'we', 'it', 'that', 'this', 'there', 'still',
]);

/** The first name a message introduces its sender by, lower-cased, or ''. */
export function introducedName(text) {
    const s = String(text || '');
    for (const re of INTRO_PATTERNS) {
        const m = s.match(re);
        const name = m?.[1]?.toLowerCase();
        if (name && !NOT_NAMES.has(name)) return name;
    }
    return '';
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0].toLowerCase();

/** The active user a first name points to — only when exactly one fits. */
export function userByFirstName(users, name) {
    if (!name) return null;
    const hits = users.filter((u) => u.isActive !== false && firstName(u.name) === name);
    if (hits.length === 1) return hits[0];
    // Two people share the name: a sales rep is the likelier sender.
    const reps = hits.filter((u) => ['sales_rep', 'accounts'].includes(u.role));
    return reps.length === 1 ? reps[0] : null;
}

/**
 * The user who started this chat, or null when we cannot tell.
 * Only counts if our side wrote first: a customer who wrote in started it.
 */
export async function starterOfChat(phoneNormalized, { pending = [] } = {}) {
    if (!phoneNormalized) return null;
    const stored = await WhatsAppMessage.find({ phoneNormalized })
        .sort({ occurredAt: 1 }).limit(10)
        .select('direction text sentBy sentByAi occurredAt').lean();
    const messages = [...stored, ...pending].sort((a, b) => new Date(a.occurredAt || 0) - new Date(b.occurredAt || 0));
    if (!messages.length || messages[0].direction !== 'outbound') return null;

    // Our opening messages, up to the customer's first reply.
    const opening = [];
    for (const m of messages) {
        if (m.direction !== 'outbound') break;
        opening.push(m);
    }

    const byCrm = opening.find((m) => m.sentBy);
    if (byCrm) {
        const u = await User.findById(byCrm.sentBy).select('name role isActive').lean();
        return u && u.isActive !== false ? u : null;
    }

    const names = opening.filter((m) => !m.sentByAi).map((m) => introducedName(m.text)).filter(Boolean);
    if (!names.length) return null;
    const users = await User.find({ isActive: { $ne: false } }).select('name role isActive').lean();
    for (const n of names) {
        const u = userByFirstName(users, n);
        if (u) return u;
    }
    return null;
}

/**
 * A colleague just sent the first message to a number with no lead: they
 * started the chat, so it is theirs. Creates the lead on them rather than
 * leaving it for the rota. A number that already has a lead keeps its owner
 * (or, if unowned, its place in the distribution queue); tenants are skipped.
 */
export async function keepChatWithSender({ phone, phoneNormalized, userId }) {
    if (!phoneNormalized || !userId) return null;
    if (await Lead.exists({ phoneNormalized })) return null;
    const { isExistingCustomerPhone } = await import('./customerLeads.js');
    if (await isExistingCustomerPhone(phoneNormalized).catch(() => false)) return null;
    const user = await User.findById(userId).select('name isActive').lean();
    if (!user || user.isActive === false) return null;
    const { createLeadFromWhatsAppPhone } = await import('./whatsappLeadSync.js');
    const lead = await createLeadFromWhatsAppPhone({
        phone: phone || phoneNormalized,
        phoneNormalized,
        status: 'new',
        timelineText: `Lead created when ${user.name} started this chat from the CRM`,
        ownerId: user._id,
        ownerNote: `Kept with ${user.name}, who started this chat`,
    });
    if (lead) await WhatsAppMessage.updateMany({ phoneNormalized, lead: null }, { $set: { lead: lead._id } });
    return lead;
}
