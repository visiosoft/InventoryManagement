/**
 * A purplebox.ae form submission, turned into a lead a rep actually sees.
 *
 * Every website form (homepage, landing pages, contact, reserve flow) posts to
 * /api/moving-leads/public. Most of these people have already written to us on
 * WhatsApp, so their number is usually on a lead already — and that lead is
 * often lost, already_customer or owned by someone who has moved on. Adding a
 * note to it (what this used to do) left a fresh enquiry invisible.
 *
 * So a submission always surfaces:
 *   - new number (or only a soft-deleted lead had it): a new lead;
 *   - known number: that lead is reopened — back to New, to the top of the
 *     list, source website, and handed out again by the distribution rules;
 *   - a signed tenant: the same, tagged existing_customer so sales can see it.
 * The full form is kept on the timeline either way.
 */

import { Lead } from '../models/index.js';
import { normalizeLeadPhone as normalizePhone } from '../routes/leads.js';
import { isExistingCustomerPhone } from './customerLeads.js';
import { routeInboundLead } from './leadRouting.js';
import { notifyLeadAssigned } from './leadNotify.js';

/** "Zulfiqar Ali" -> { firstName: 'Zulfiqar', lastName: 'Ali' }. */
export function splitName(fullName) {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

/** The form's details as text a rep can read. */
export function formNotes(b) {
    return [
        b.summary_text,
        b.storing_for ? `Enquiry: ${b.storing_for}` : '',
        b.unit_size ? `Requested size: ${b.unit_size}` : '',
        b.unit_label ? `Label: ${b.unit_label}` : '',
        b.emirate ? `Emirate: ${b.emirate}` : '',
        b.move_in_date ? `Timing: ${b.move_in_date}` : '',
        b.promo_code ? `Promo code: ${b.promo_code}` : '',
        b.monthly_rent && Number(b.monthly_rent) ? `Monthly rent: AED ${b.monthly_rent}` : '',
        b.supplies_text && b.supplies_text !== 'No supplies selected' ? `Supplies: ${b.supplies_text}` : '',
        b.due_today && Number(b.due_today) ? `Due today: AED ${b.due_today}` : '',
        b.email ? `Email: ${String(b.email).trim()}` : '',
    ].filter(Boolean).join('\n');
}

export const pageName = (b) => String(b.source_page_name || '').trim() || 'Website';
export const pageNote = (b) => `Landing page: ${pageName(b)}${b.source_page ? ` (${b.source_page})` : ''}`;

/* Everything that says "somebody has been given this and is working it". A
   reopened lead starts these again exactly as a brand-new lead would. */
const FRESH_ASSIGNMENT = {
    owner: null,
    assignedAt: null,
    autoAssigned: false,
    assignedBy: null,
    ownerSeenAt: null,
    firstResponseAt: null,
    slaNudgedAt: null,
    slaReassignedAt: null,
    assignmentNotifiedAt: null,
    assignmentNotificationDismissedAt: null,
    assignmentReminderSentAt: null,
    sequenceExhaustedAt: null,
};

const DEFAULT_DEPS = {
    findLead: (phoneNormalized) => Lead.findOne({ phoneNormalized }),   // soft-deleted leads are excluded
    createLead: (doc) => Lead.create(doc),
    claim: (id, update) => Lead.updateOne({ _id: id, owner: null }, update),
    isTenant: (phoneNormalized) => isExistingCustomerPhone(phoneNormalized).catch(() => false),
    route: (phoneNormalized, at) => routeInboundLead({ phoneNormalized, at }).catch(() => null),
    notify: (lead, ownerId, reason) => notifyLeadAssigned({ lead, ownerId, reason })
        .catch((e) => console.error('[WebsiteLead] notify failed:', e.message)),
};

export class WebsiteLeadError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

/**
 * @returns {{ id, created: boolean, reopened: boolean, ownerId: string|null, existingCustomer: boolean }}
 */
export async function ingestWebsiteLead(body, { at = new Date(), deps: overrides = {} } = {}) {
    const deps = { ...DEFAULT_DEPS, ...overrides };
    const b = body || {};
    const phoneNormalized = normalizePhone(b.mobile);
    if (!phoneNormalized) throw new WebsiteLeadError('mobile must contain a phone number');

    // Only the number is required; a quick mobile form often has nothing else.
    const fullName = String(b.full_name || '').trim() || `Website lead ${phoneNormalized.slice(-4)}`;
    const notes = formNotes(b);
    const formNote = `${pageNote(b)}\n${notes}`.trim();
    const tenant = Boolean(await deps.isTenant(phoneNormalized));
    const tags = ['website', ...(tenant ? ['existing_customer'] : [])];

    let lead = await deps.findLead(phoneNormalized);
    let created = false;

    if (!lead) {
        const { firstName, lastName } = splitName(fullName);
        lead = await deps.createLead({
            firstName, lastName, fullName,
            phone: String(b.mobile || '').trim(), phoneNormalized,
            email: String(b.email || '').trim(),
            source: 'website',
            status: 'new',
            leadDateTime: at,
            unitsNeeded: 1,
            tags,
            notes,
            timeline: [
                { type: 'created', text: pageNote(b) },
                ...(tenant ? [{ type: 'note', text: 'This number belongs to an existing customer (tagged existing_customer)' }] : []),
            ],
        });
        created = true;
    } else {
        const was = [
            `was ${lead.status}`,
            lead.lostReason ? `lost reason: ${lead.lostReason}` : '',
            lead.source && lead.source !== 'website' ? `original source: ${lead.source}` : '',
        ].filter(Boolean).join(', ');

        lead.status = 'new';                     // the save hook records it in stageHistory
        lead.lostReason = '';
        lead.leadDateTime = at;                  // the Leads list sorts by this, newest first
        lead.source = 'website';
        lead.tags = [...new Set([...(lead.tags || []), ...tags])];
        if (!lead.email && b.email) lead.email = String(b.email).trim();
        if (/^(WhatsApp Contact|Website lead) /.test(String(lead.fullName || '')) && String(b.full_name || '').trim()) {
            Object.assign(lead, { fullName, ...splitName(fullName) });
        }
        Object.assign(lead, FRESH_ASSIGNMENT);
        lead.timeline.push({ type: 'note', text: `Reopened by website form: ${pageName(b)} (${was})` });
        lead.timeline.push({ type: 'note', text: formNote });
        await lead.save();
    }

    // The distribution rules, as for any new lead. Nobody on shift: it stays
    // unassigned and the sweep hands it out when somebody comes on.
    const decision = await deps.route(phoneNormalized, at);
    let ownerId = null;
    if (decision?.ownerId) {
        const reason = decision.reason || '';
        const res = await deps.claim(lead._id, {
            $set: {
                owner: decision.ownerId,
                assignedAt: at,
                autoAssigned: !decision.existingCustomer && !decision.outOfHours,
                assignedBy: null,
                ownerSeenAt: null,
                firstResponseAt: null,
            },
            $push: { timeline: { type: 'note', text: `Assigned by distribution rules — ${reason}` } },
        });
        if (res?.modifiedCount !== 0) {
            ownerId = String(decision.ownerId);
            deps.notify(lead, decision.ownerId, reason);
        }
    }

    return { id: lead._id, created, reopened: !created, ownerId, existingCustomer: tenant };
}
