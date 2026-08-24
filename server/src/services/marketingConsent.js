import crypto from 'node:crypto';

/**
 * Unsubscribe links.
 *
 * The token is an HMAC of the record it refers to, so nothing has to be stored
 * and nothing expires — an unsubscribe link in an email someone finds a year
 * later still works, which is the behaviour a person expects. It also cannot be
 * guessed, so nobody can walk the id range unsubscribing other people.
 */

const SECRET = () => process.env.JWT_SECRET || 'purplebox-marketing';

export function unsubscribeToken(kind, id) {
    return crypto.createHmac('sha256', SECRET()).update(`${kind}:${id}`).digest('hex').slice(0, 32);
}

export function verifyUnsubscribeToken(kind, id, token) {
    const expected = unsubscribeToken(kind, id);
    const a = Buffer.from(String(token || ''));
    const b = Buffer.from(expected);
    // Lengths must match before timingSafeEqual will accept the comparison.
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function unsubscribeUrl(kind, id) {
    const base = String(process.env.APP_URL || 'https://office.purplebox.ae').replace(/\/+$/, '');
    return `${base}/api/marketing/unsubscribe/${kind}/${id}/${unsubscribeToken(kind, id)}`;
}

/**
 * The footer every marketing email carries.
 *
 * Added by the sender rather than written into each campaign: something an
 * author can forget is something that will be missing from the one send where
 * it mattered.
 */
export function unsubscribeFooterHtml(kind, id) {
    const url = unsubscribeUrl(kind, id);
    return [
        '<hr style="border:none;border-top:1px solid #e5e0ea;margin:28px 0 14px">',
        '<p style="font-family:sans-serif;font-size:12px;color:#756E80;line-height:1.5;margin:0">',
        'You are receiving this because you are a PurpleBox Storage customer or enquired with us.',
        `<br><a href="${url}" style="color:#5B2BC9">Unsubscribe from marketing emails</a>`,
        ' You will still receive invoices and contract notices.',
        '</p>',
    ].join('');
}

export function unsubscribeFooterText(kind, id) {
    return [
        '',
        '---',
        'You are receiving this because you are a PurpleBox Storage customer or enquired with us.',
        `Unsubscribe from marketing emails: ${unsubscribeUrl(kind, id)}`,
        'You will still receive invoices and contract notices.',
    ].join('\n');
}
