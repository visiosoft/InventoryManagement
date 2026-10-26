/**
 * Each person's own dashboard: the order of the cards, which ones are hidden
 * and which tab a card sits on, kept on their account so it follows them to
 * any computer. Card ids and tab names are the client's; this only keeps the
 * shape sane — strings, sensible lengths, nothing else stored.
 */

const ID = /^[a-z0-9-]{1,40}$/;

/** The layout as stored, or null when there is nothing worth keeping. */
export function cleanDashboardLayout(input) {
    if (!input || typeof input !== 'object') return null;
    const ids = (v) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && ID.test(x)))].slice(0, 60);
    const tabs = {};
    if (input.tabs && typeof input.tabs === 'object' && !Array.isArray(input.tabs)) {
        for (const [k, v] of Object.entries(input.tabs).slice(0, 60)) {
            if (ID.test(k) && typeof v === 'string' && ID.test(v)) tabs[k] = v;
        }
    }
    const out = { order: ids(input.order), hidden: ids(input.hidden), tabs };
    return out.order.length || out.hidden.length || Object.keys(tabs).length ? out : null;
}
