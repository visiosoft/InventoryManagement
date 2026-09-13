/**
 * The WhatsApp Flow Templates that back services/movingStorageFlow.js — an
 * editable, cloneable stand-in for what used to be a single hardcoded
 * conversation gated by a single movingStorageFlowEnabled checkbox.
 */

import { AiBotConfig, WhatsAppFlowTemplate } from '../models/index.js';

/**
 * The wording reproduced exactly as movingStorageFlow.js used to hardcode
 * it, so seeding this changes nothing for a number already mid-conversation
 * the day this ships.
 */
export function defaultFlowTemplateSteps() {
    return [
        {
            kind: 'buttons',
            prompt: 'Hi! Are you looking for Moving or Storage services?',
            options: [
                { label: 'Moving', action: 'handoff' },
                { label: 'Storage', action: 'next' },
            ],
        },
        {
            kind: 'size_list',
            prompt: 'Here are our available unit sizes and pricing:',
            listButtonLabel: 'View Sizes',
            helpOptionLabel: 'Need Help Choosing',
        },
        {
            kind: 'date_range',
            // Only the calendar-flow body text uses this — the plain-text
            // from/then-to fallback (used until a calendar Flow id is
            // configured) has its own fixed wording; see dateFromPrompt/
            // dateToPrompt in movingStorageFlow.js.
            prompt: 'Great, a {size} sqft unit — tap below to pick the dates you need it for.',
            noAvailabilityText: "We don't have a {size} sqft unit free from {from} to {to} right now. A member of our team will follow up shortly with the closest options.",
            confirmationText: "Sure, I'll help you book unit {unitNumber} ({size} sqft) right away! It's {price}, available {from} to {to}.",
        },
        {
            kind: 'text_question',
            prompt: "Let's get your reservation started — what's your full name?",
            saveField: 'fullName',
        },
        {
            kind: 'text_question',
            prompt: "Thanks, {name}! What's the best phone number to reach you on?",
            saveField: 'contactPhone',
        },
    ];
}

export const DEFAULT_HANDOFF_TEXT = 'Thanks! A member of our team will follow up shortly to help with this.';
export const DEFAULT_COMPLETION_TEXT = "You're all set, {name}! We've noted your reservation for unit {unitNumber} ({size} sqft), {from} to {to}. Our team will confirm shortly.";

/** Creates the seeded "Moving/Storage Booking" template if the collection
 *  is empty, carrying over the old single movingStorageFlowEnabled
 *  checkbox's value as this template's `active` flag — read straight off
 *  the raw AiBotConfig collection, since that field is no longer declared
 *  on its schema and a normal Mongoose read wouldn't see it even though an
 *  existing database still has it stored from before this migration ran.
 *  Only matters the one time this runs — irrelevant once the collection is
 *  no longer empty. */
export async function ensureDefaultFlowTemplate() {
    const count = await WhatsAppFlowTemplate.countDocuments();
    if (count > 0) return;
    const raw = await AiBotConfig.collection.findOne({}, { projection: { movingStorageFlowEnabled: 1 } });
    await WhatsAppFlowTemplate.create({
        name: 'Moving/Storage Booking',
        active: Boolean(raw?.movingStorageFlowEnabled),
        custom: false,
        order: 0,
        handoffText: DEFAULT_HANDOFF_TEXT,
        completionText: DEFAULT_COMPLETION_TEXT,
        steps: defaultFlowTemplateSteps(),
    });
}

/** The one template currently answering fresh conversations, or null if
 *  none is active — the "off" state that used to be
 *  movingStorageFlowEnabled: false. */
export async function getActiveFlowTemplate() {
    return WhatsAppFlowTemplate.findOne({ active: true });
}

/** Replaces {token} placeholders with values from `vars`; a token with no
 *  matching var, or one whose value is empty, is dropped rather than left
 *  as a literal "{price}" a customer would see. */
export function fillPlaceholders(text, vars = {}) {
    return String(text || '').replace(/\{(\w+)\}/g, (match, key) => {
        const v = vars[key];
        return v === undefined || v === null || v === '' ? '' : String(v);
    }).replace(/[ \t]{2,}/g, ' ').trim();
}
