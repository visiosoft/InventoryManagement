/**
 * Omar's follow-ups, laid out by day — what he would send, to whom, on which
 * day, worked out from each lead's place in the schedule. It does not depend
 * on the agent being on duty, so the plan can be read (and trusted) before
 * anything is switched on.
 */

const DAY = 86400000;
export const dubaiKey = (d) => new Date(new Date(d).getTime() + 4 * 3600000).toISOString().slice(0, 10);

/* What each step is for, on the standard schedule (days 1, 3, 7, 14, then
   nurture on 30, 60, 90) — the templates in docs/whatsapp-templates. */
const QUIET_STEPS = ['Day 1 · still looking?', 'Day 3 · visit the facility', 'Day 7 · the offer', 'Day 14 · close or later?'];
const DORMANT_STEPS = ['Day 30 · new units free', 'Day 60 · new units free', 'Day 90 · last check-in'];

export function stepLabel(bucket, index, total) {
    const named = bucket === 'quiet' && total === 4 ? QUIET_STEPS[index]
        : bucket === 'dormant' && total === 3 ? DORMANT_STEPS[index] : null;
    return named || `Follow-up ${index + 1} of ${total}`;
}

/**
 * files: [{ leadId, name, phone, bucket, touchCount, anchorAt, followUpAt }]
 * Returns one entry per day from today for `days` days, each with the
 * touches due that day. Overdue touches land on today. Later steps are
 * projected as if each earlier one goes out on its day.
 */
export function projectFollowUps(files, { now = new Date(), cadence, days = 7, dailyCap = 0 } = {}) {
    const todayKey = dubaiKey(now);
    const keys = Array.from({ length: days }, (_, i) => dubaiKey(new Date(now.getTime() + i * DAY)));
    const byDay = new Map(keys.map((k) => [k, []]));

    for (const f of files) {
        const stages = cadence?.[f.bucket];
        if (!stages || !stages.length || f.touchCount >= stages.length) continue;
        let at = new Date(new Date(f.anchorAt || now).getTime() + stages[f.touchCount] * DAY);
        // A date a person set ("call me next month") wins over the schedule.
        if (f.followUpAt && new Date(f.followUpAt) > now) at = new Date(f.followUpAt);
        let overdue = false;
        if (dubaiKey(at) < todayKey) { at = now; overdue = true; }
        for (let i = f.touchCount; i < stages.length; i++) {
            if (i > f.touchCount) at = new Date(at.getTime() + stages[i] * DAY);
            const k = dubaiKey(at);
            if (!byDay.has(k)) { if (k > keys[keys.length - 1]) break; continue; }
            byDay.get(k).push({
                leadId: f.leadId, name: f.name, phone: f.phone, bucket: f.bucket,
                step: i + 1, total: stages.length, label: stepLabel(f.bucket, i, stages.length),
                overdue: overdue && i === f.touchCount,
            });
        }
    }

    return keys.map((date, i) => {
        const items = byDay.get(date).sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.step - b.step);
        return {
            date, isToday: i === 0, count: items.length,
            overCap: dailyCap > 0 ? Math.max(0, items.length - dailyCap) : 0,
            items: items.slice(0, 60),
        };
    });
}
