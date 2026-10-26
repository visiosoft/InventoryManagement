/**
 * Each person's own dashboard: the order of the cards, which ones are hidden,
 * which tab a card sits on and how wide it is, kept on their account so it follows them to
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
    // Card widths: full, or half so two sit side by side.
    const sizes = {};
    if (input.sizes && typeof input.sizes === 'object' && !Array.isArray(input.sizes)) {
        for (const [k, v] of Object.entries(input.sizes).slice(0, 60)) {
            if (ID.test(k) && (v === 'full' || v === 'half')) sizes[k] = v;
        }
    }
    const out = { order: ids(input.order), hidden: ids(input.hidden), tabs, sizes };
    return out.order.length || out.hidden.length || Object.keys(tabs).length || Object.keys(sizes).length ? out : null;
}
