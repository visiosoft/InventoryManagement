import { renewLink, moveOutLink } from './renewalLink.js';

/**
 * Filling @placeholders in a message before it goes to a tenant.
 *
 * Separated out and tested directly because this decides what a real customer
 * reads. An email that arrives saying "expires on @endDate" is worse than no
 * email at all — it happened once, from the bulk dialog, and the guard below is
 * what stops it happening again.
 */

const fmtDate = (d) => (d
    ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '');

/**
 * Anything still shaped like @word has no value behind it.
 *
 * The lookbehind keeps email addresses out of it: "hello@purplebox.ae" is
 * ordinary copy, and treating its @purplebox as an unfilled placeholder would
 * block a perfectly good message from going out.
 */
export function leftoverPlaceholders(value) {
    return [...new Set(String(value || '').match(/(?<![\w.])@[a-zA-Z]\w*/g) || [])];
}

/**
 * Resolve a tenant's placeholders, and their active contract's when there is
 * one. Returns the text unchanged for anything it has no value for, so the
 * caller can refuse to send rather than guessing.
 */
export function fillPlaceholders(value, customer = {}, contract = null) {
    let out = String(value || '')
        .replace(/@name/g, customer.fullName || 'there')
        .replace(/@email/g, customer.email || '')
        .replace(/@company/g, customer.company || '');

    if (!contract) return out;

    // A contract can hold several units; the message wants them all.
    const units = (contract.units?.length ? contract.units : [contract.unit])
        .filter(Boolean)
        .map((u) => (typeof u === 'object' ? u.unitNumber : u))
        .filter(Boolean)
        .join(', ');

    const daysLeft = contract.endDate
        ? Math.max(0, Math.ceil((new Date(contract.endDate) - Date.now()) / 86_400_000))
        : '';

    return out
        .replace(/@contractNo/g, contract.contractNo || '')
        .replace(/@unit/g, units)
        .replace(/@startDate/g, fmtDate(contract.startDate))
        .replace(/@endDate/g, fmtDate(contract.endDate))
        .replace(/@dueDate/g, fmtDate(contract.endDate))
        .replace(/@daysLeft/g, String(daysLeft))
        .replace(/@rate/g, contract.rate != null ? Number(contract.rate).toFixed(2) : '')
        .replace(/@lateFee/g, process.env.LATE_FEE_AMOUNT || 'AED 100')
        .replace(/@renewLink/g, renewLink(contract._id))
        .replace(/@moveOutLink/g, moveOutLink(contract._id));
}
