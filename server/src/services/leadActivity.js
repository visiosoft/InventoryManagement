/**
 * The activity log on a lead: who changed what.
 *
 * "Lead updated by Emad" told nobody anything. These say what moved, old to
 * new, so the trail reads as a history: Emad changed Stage New → Contacted ·
 * Size not asked → 50 sq ft; Emad sent the lead to Admin — "wants a quote".
 */

const humanise = (v) => String(v || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const size = (n) => (Number(n) === -1 ? 'not sure' : Number(n) > 0 ? `${Number(n)} sq ft` : 'not asked');
const text = (v) => (String(v ?? '').trim() ? String(v).trim() : '—');

const FIELDS = [
    ['fullName', 'Name', text],
    ['phone', 'Phone', text],
    ['whatsappNo', 'WhatsApp no.', text],
    ['email', 'Email', text],
    ['status', 'Stage', humanise],
    ['source', 'Source', humanise],
    ['temperature', 'Temperature', (v) => (v ? humanise(v) : '—')],
    ['storageSizeValue', 'Size', size],
    ['unitsNeeded', 'Units', (v) => String(Number(v) || 1)],
    ['whenNeeded', 'When needed', text],
    ['storingWhat', 'Storing', text],
    ['spaceNeeded', 'Space', text],
];

/** One line of what changed between two versions of a lead, or '' if nothing did. */
export function describeChanges(before = {}, after = {}) {
    const parts = [];
    for (const [key, label, fmt] of FIELDS) {
        const a = fmt(before[key]);
        const b = fmt(after[key]);
        if (a !== b) parts.push(`${label} ${a} → ${b}`);
    }
    const dur = (l) => `${Number(l.durationValue) || 1} ${l.durationUnit || 'month'}${(Number(l.durationValue) || 1) === 1 ? '' : 's'}`;
    if (dur(before) !== dur(after)) parts.push(`Duration ${dur(before)} → ${dur(after)}`);
    const tags = (l) => [...(l.tags || [])].map(String).sort().join(', ') || '—';
    if (tags(before) !== tags(after)) parts.push(`Tags ${tags(before)} → ${tags(after)}`);
    if (String(before.notes || '') !== String(after.notes || '')) parts.push('Note edited');
    return parts.join(' · ');
}

/** The hand-over line: who gave it to whom, and why. */
export function handOverText({ byName, toName, fromName, note }) {
    const why = String(note || '').trim();
    const from = fromName && fromName !== byName ? ` (was ${fromName})` : '';
    if (!toName) return `${byName} left the lead unassigned${from}${why ? ` — "${why}"` : ''}`;
    return `${byName} sent the lead to ${toName}${from}${why ? ` — "${why}"` : ''}`;
}
