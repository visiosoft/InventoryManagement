import crypto from 'node:crypto';

/**
 * One-click renewal answers.
 *
 * The expiry email asks the tenant to say whether they are staying or leaving.
 * These links let them answer without replying, calling or logging in — which
 * is the whole point, because 117 of 127 active contracts currently sit at
 * "undecided" and every one of those is a phone call somebody has to make.
 *
 * The token is an HMAC of the contract id, so nothing is stored and nothing
 * expires — a link in an email opened a week late still works — and the id
 * range cannot be walked to change other people's contracts.
 */

const SECRET = () => process.env.JWT_SECRET || 'purplebox-renewal';

export function renewalToken(contractId) {
    return crypto.createHmac('sha256', SECRET()).update(`renewal:${contractId}`).digest('hex').slice(0, 32);
}

export function verifyRenewalToken(contractId, token) {
    const expected = renewalToken(contractId);
    const a = Buffer.from(String(token || ''));
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const base = () => String(process.env.APP_URL || 'https://office.purplebox.ae').replace(/\/+$/, '');

/** Where "Renew my unit" points. */
export function renewLink(contractId) {
    return `${base()}/api/contracts/public/renewal/${contractId}/${renewalToken(contractId)}?intent=renewing`;
}

/** Where "Schedule move-out" points. */
export function moveOutLink(contractId) {
    return `${base()}/api/contracts/public/renewal/${contractId}/${renewalToken(contractId)}?intent=not_renewing`;
}
