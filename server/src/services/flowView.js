/**
 * How a WhatsApp Flow (an in-chat form) reads in our inbox.
 *
 * Two sides, both derived from the stored webhook/send payload so nothing
 * has to be migrated:
 *   - a form we sent: `form` = { name, cta } — the inbox draws the button
 *     the customer sees under the message;
 *   - a form they submitted: `formAnswers` = { name, answers: [{label, value}] }
 *     — the inbox shows what they filled in, field by field, rather than a
 *     blob of JSON or a blank bubble.
 */

const SKIP = new Set(['flow_token', 'flow', 'error_message', 'show_error']);

// Field names whose plain humanised form would read badly.
const LABELS = {
    size: 'Unit size',
    start_date: 'Start date',
    from_date: 'Start date',
    to_date: 'End date',
    come_back: 'Would come back',
    one_change: 'One thing to change',
    what_would_keep_you: 'What would keep them',
    id_type: 'ID type',
    id_photo: 'ID photo',
    authorized_name: 'Authorised person',
    authorized_phone: 'Authorised person phone',
    emergency_phone: 'Emergency phone',
    full_name: 'Full name',
};

const humanise = (key) => {
    const s = String(key).replace(/[_-]+/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
};

const dayLabel = (iso) => new Date(`${iso}T00:00:00+04:00`)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });

export function formatAnswer(key, value) {
    if (value === null || value === undefined || value === '') return '';
    if (Array.isArray(value)) {
        if (!value.length) return '';
        // Photos and documents arrive as file descriptors.
        if (typeof value[0] === 'object') return `${value.length} file${value.length === 1 ? '' : 's'}`;
        return value.map((v) => formatAnswer(key, v)).filter(Boolean).join(', ');
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') return '';
    const s = String(value).trim();
    if (key === 'size' && /^\d+$/.test(s)) return `${s} sq ft`;
    if (s === 'not_sure') return 'Not sure';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dayLabel(s);
    if (key === 'rating' && /^[1-5]$/.test(s)) return `${s}/5`;
    // Option ids such as "moving_abroad" read as words.
    if (/^[a-z]+(_[a-z]+)+$/.test(s)) return humanise(s);
    return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

export function formNameFor(data) {
    if (data.flow === 'welcome' || String(data.flow_token || '').startsWith('welcome.')) return 'Welcome form';
    if (String(data.flow_token || '').startsWith('exit_survey.') || ('reason' in data && 'come_back' in data)) return 'Exit survey';
    if ('from_date' in data && 'to_date' in data) return 'Booking dates';
    if ('full_name' in data || 'id_type' in data || String(data.flow_token || '').startsWith('client_info.')) return 'Client details';
    return 'Form';
}

/** The customer's submitted answers, or null when this is not a form reply. */
export function formAnswersFromRaw(raw) {
    const json = raw?.interactive?.type === 'nfm_reply' ? raw.interactive.nfm_reply?.response_json : null;
    if (!json) return null;
    let data;
    try { data = JSON.parse(json) || {}; } catch { return null; }
    const answers = Object.entries(data)
        .filter(([k]) => !SKIP.has(k))
        .map(([k, v]) => ({ label: LABELS[k] || humanise(k), value: formatAnswer(k, v) }))
        .filter((a) => a.value)
        .slice(0, 16);
    return { name: formNameFor(data), answers };
}

/** The form we sent with this message, or null. */
export function formFromRaw(raw) {
    const f = raw?.flowForm;
    if (!f) return raw?.welcomeFlow ? { name: 'Welcome form', cta: 'Choose size' } : null;
    return { name: String(f.name || 'Form'), cta: String(f.cta || 'Open form') };
}

/** Adds `form` / `formAnswers` to a stored message for the inbox. */
export function withFormView(message, raw) {
    const form = message.direction === 'outbound' ? formFromRaw(raw) : null;
    const formAnswers = message.direction === 'inbound' ? formAnswersFromRaw(raw) : null;
    return { ...message, ...(form ? { form } : {}), ...(formAnswers ? { formAnswers } : {}) };
}
