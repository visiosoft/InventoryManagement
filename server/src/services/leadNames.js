import { Customer } from '../models/index.js';

/**
 * A lead auto-created from an inbound WhatsApp message is named
 * "WhatsApp Contact 4387" until somebody types a real one in. That name
 * survives even after the same person becomes a Customer under their own
 * name elsewhere — nothing links the two records, so the lead never learns
 * it. A rep handed exactly this lead saw a stranger's placeholder sitting
 * next to a real customer they already know, and searching for that
 * customer's actual name found nothing, because the name was never on the
 * lead to begin with.
 *
 * Resolved by the same rule the rest of the app already uses to decide two
 * phone numbers are the same person — the last nine digits — matched
 * against every phone Customer holds. Read-only wherever it is called from:
 * this reshapes what a response says, it never rewrites the lead. A name
 * typed in later, by a rep or by the sync that created it, is left alone
 * rather than fought over.
 *
 * Shared by every place a lead's name reaches a person — the leads list, the
 * quiet-lead review screen, and now a push notification, which is the worst
 * place of all to show a stranger's placeholder next to a name a rep already
 * knows. One fix, used everywhere the name is read, rather than one screen
 * fixed and the same bug still live in the next.
 *
 * @param items objects carrying `phoneNormalized` and a name field
 * @param nameKey which field holds the name — 'fullName' on a Lead document,
 *   'name' on services/leadFollowUp.js's own shaped rows
 */
export const PLACEHOLDER_NAME = /^whatsapp\s*contact/i;
export const phoneTail = (phone) => String(phone || '').replace(/\D/g, '').slice(-9);

export async function resolvePlaceholderNames(items, nameKey = 'fullName') {
    const placeholders = items.filter((l) => PLACEHOLDER_NAME.test(l[nameKey] || ''));
    if (!placeholders.length) return items;

    const tails = new Set(placeholders.map((l) => phoneTail(l.phoneNormalized)).filter((t) => t.length === 9));
    if (!tails.size) return items;

    const customers = await Customer.find({}).select('fullName phone phones').lean();
    const nameByTail = new Map();
    for (const c of customers) {
        for (const p of [...(c.phones || []), c.phone]) {
            const t = phoneTail(p);
            if (t.length === 9 && tails.has(t) && !nameByTail.has(t)) nameByTail.set(t, c.fullName);
        }
    }

    for (const l of placeholders) {
        const name = nameByTail.get(phoneTail(l.phoneNormalized));
        if (name) l[nameKey] = name;
    }
    return items;
}
