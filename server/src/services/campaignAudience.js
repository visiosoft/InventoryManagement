import { Customer, Contract, Lead, WhatsAppChatLabel, CampaignRecipient } from '../models/index.js';
import { zohoBooksConfigured, zohoOutstandingByCustomer } from './zohoBooks.js';

/**
 * Who a campaign goes to.
 *
 * Tenants, past tenants and leads are three overlapping lists — a lead who
 * signed becomes a tenant and stays in both — so the union is de-duplicated on
 * email and phone before anyone is counted. Getting that wrong means somebody
 * receives the same Christmas message twice, from the same company, minutes
 * apart, which is the kind of thing people remember.
 */

const normEmail = (v) => String(v || '').trim().toLowerCase();

// UAE numbers are stored inconsistently (+971 50…, 050…, 9715…), so identity is
// the last nine digits — the same rule the inbox and the Zoho matcher use.
const phoneKey = (v) => {
    const digits = String(v || '').replace(/\D/g, '');
    return digits.length >= 9 ? digits.slice(-9) : '';
};

const firstPhone = (row) => {
    const candidates = [...(Array.isArray(row.phones) ? row.phones : []), row.phone, row.whatsappNo];
    for (const c of candidates) {
        const k = phoneKey(c);
        if (k) return k;
    }
    return '';
};

/**
 * Resolve an audience spec into a de-duplicated list of people.
 *
 * Returns `{ people, counts }` where each person carries whichever of email and
 * phone we hold, so the caller can decide which channels they are reachable on.
 */
export async function buildAudience(audience = {}) {
    const {
        tenants = true,
        pastTenants = false,
        leads = false,
        leadStatuses = [],
        renewalIntent = '',
        owingOnly = false,
        labels = [],
    } = audience;

    const people = [];
    const seenEmail = new Map();
    const seenPhone = new Map();

    // Adds one person unless we already have them under either key. First in
    // wins, and tenants are added before leads so the richer record survives.
    const add = (person) => {
        const e = normEmail(person.email);
        const p = person.phoneNormalized;
        if ((e && seenEmail.has(e)) || (p && seenPhone.has(p))) return false;
        if (e) seenEmail.set(e, person);
        if (p) seenPhone.set(p, person);
        people.push(person);
        return true;
    };

    // ── tenants ─────────────────────────────────────────────────────────────
    if (tenants || pastTenants) {
        // Which customers hold an active contract — the line between a current
        // tenant and a past one.
        const activeRows = await Contract.find({ status: 'active' })
            .select('customer renewalIntent').lean();
        const activeCustomers = new Set(activeRows.map((c) => String(c.customer)));

        let allowed = null;
        if (renewalIntent) {
            allowed = new Set(
                activeRows
                    .filter((c) => (c.renewalIntent || 'undecided') === renewalIntent)
                    .map((c) => String(c.customer)),
            );
        }

        const customers = await Customer.find({ unsubscribed: { $ne: true } })
            .select('fullName email phone phones whatsappOptIn').lean();

        let owing = null;
        if (owingOnly && zohoBooksConfigured()) {
            const zoho = await zohoOutstandingByCustomer(customers);
            owing = new Set(
                [...zoho.byCustomer.entries()].filter(([, v]) => v.outstanding > 0).map(([id]) => id),
            );
        }

        for (const c of customers) {
            const id = String(c._id);
            const isActive = activeCustomers.has(id);
            if (isActive && !tenants) continue;
            if (!isActive && !pastTenants) continue;
            if (allowed && !allowed.has(id)) continue;
            if (owing && !owing.has(id)) continue;
            add({
                kind: 'customer',
                refId: c._id,
                name: c.fullName || '',
                email: normEmail(c.email),
                phoneNormalized: firstPhone(c),
                whatsappOptIn: Boolean(c.whatsappOptIn?.at),
            });
        }
    }

    // ── leads ───────────────────────────────────────────────────────────────
    if (leads) {
        const filter = { unsubscribed: { $ne: true } };
        if (leadStatuses.length) filter.status = { $in: leadStatuses };

        // A label narrows to the chats carrying it — the labels applied in the
        // WhatsApp console, so a segment built there can be mailed here.
        if (labels.length) {
            const tagged = await WhatsAppChatLabel.find({ labels: { $in: labels } })
                .select('phoneNormalized').lean();
            const numbers = tagged.map((t) => t.phoneNormalized);
            if (!numbers.length) return { people, counts: countsFor(people) };
            filter.phoneNormalized = { $in: numbers };
        }

        const rows = await Lead.find(filter).select('fullName email phone whatsappNo phoneNormalized whatsappOptIn').lean();
        for (const l of rows) {
            add({
                kind: 'lead',
                refId: l._id,
                name: l.fullName || '',
                email: normEmail(l.email),
                phoneNormalized: phoneKey(l.phoneNormalized) || firstPhone(l),
                whatsappOptIn: Boolean(l.whatsappOptIn?.at),
            });
        }
    }

    // Anyone messaged too recently on a channel drops off that channel — a
    // campaign a week ago should not be followed by another one today.
    const days = Number(audience.minDaysBetween ?? 7);
    let recentEmail = new Set();
    let recentWhatsApp = new Set();
    if (days > 0) {
        const since = new Date(Date.now() - days * 86_400_000);
        const rows = await CampaignRecipient.find({ status: 'sent', sentAt: { $gte: since } })
            .select('refId channel').lean();
        for (const r of rows) {
            (r.channel === 'email' ? recentEmail : recentWhatsApp).add(String(r.refId));
        }
    }

    const excluded = { recentlyMessaged: 0, noWhatsAppOptIn: 0 };

    for (const p of people) {
        const id = String(p.refId);
        if (p.email && recentEmail.has(id)) { p.email = ''; p.skipEmail = 'messaged recently'; }
        if (p.phoneNormalized) {
            if (recentWhatsApp.has(id)) { p.phoneNormalized = ''; p.skipWhatsApp = 'messaged recently'; }
            // Meta requires a recorded opt-in before a marketing template.
            // Without it the person is simply not a WhatsApp audience.
            else if (!p.whatsappOptIn) { p.phoneNormalized = ''; p.skipWhatsApp = 'no opt-in'; }
        }
        if (p.skipEmail === 'messaged recently' || p.skipWhatsApp === 'messaged recently') excluded.recentlyMessaged += 1;
        if (p.skipWhatsApp === 'no opt-in') excluded.noWhatsAppOptIn += 1;
    }

    return { people, counts: countsFor(people, excluded) };
}

function countsFor(people, excluded = {}) {
    return {
        total: people.length,
        byEmail: people.filter((p) => p.email).length,
        byWhatsApp: people.filter((p) => p.phoneNormalized).length,
        // Neither an address nor a number — counted so a shortfall between the
        // audience size and what can actually be sent is never a surprise.
        unreachable: people.filter((p) => !p.email && !p.phoneNormalized).length,
        recentlyMessaged: excluded.recentlyMessaged || 0,
        noWhatsAppOptIn: excluded.noWhatsAppOptIn || 0,
    };
}
