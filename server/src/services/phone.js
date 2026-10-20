/**
 * One shape for every phone number we store: the international digits
 * WhatsApp uses (9715XXXXXXXX), whatever way somebody typed it.
 *
 * A rep typing "054 266 2555" used to be stored as 0542662555 while the same
 * customer's WhatsApp chat was 971542662555, so the two never met: a second
 * lead was created, and the chat's activity moved the other copy.
 */
export function normalizePhone(input) {
    let d = String(input || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    // +971 followed by the local 0: 971 05x … → 971 5x …
    if (/^9710\d{8,9}$/.test(d)) d = `971${d.slice(4)}`;
    // UAE numbers written the local way: mobiles 05x xxx xxxx or 5x xxx xxxx,
    // landlines 04 xxx xxxx.
    if (/^05\d{8}$/.test(d)) d = `971${d.slice(1)}`;
    else if (/^5\d{8}$/.test(d)) d = `971${d}`;
    else if (/^0[2-9]\d{7}$/.test(d)) d = `971${d.slice(1)}`;
    return d;
}

/** The last nine digits: the part that is the same however the number was written. */
export function phoneTail9(input) {
    const d = String(input || '').replace(/\D/g, '');
    return d.length >= 9 ? d.slice(-9) : '';
}
