/**
 * The follow-up lifecycle, as a pure state machine.
 *
 * Every lead the agent looks after sits in exactly one bucket. This file
 * answers three questions with no database and no clock of its own, so the
 * answers can be asserted directly: which bucket does an event move a lead
 * to, when is its next touch due, and what does the existing human-facing
 * Lead.status become. Everything that sends, saves or schedules lives in
 * runtime.js and scheduler.js and calls in here.
 *
 * Cadences are day offsets counted from the moment the lead entered the
 * bucket (or its last touch). They are defaults: the scheduler passes the
 * configured ones in. A bucket with no cadence never gets a next touch.
 */

export const BUCKETS = {
    new: { label: 'New', selling: true },
    engaged: { label: 'Engaged', selling: true },
    quoted: { label: 'Quoted', selling: true },
    booking: { label: 'Booking', selling: true },
    won: { label: 'Won', closed: true },
    quiet: { label: 'Quiet', nurture: true },
    dormant: { label: 'Dormant', nurture: true },
    with_person: { label: 'With a person', paused: true },
    lost: { label: 'Lost', closed: true },
    do_not_contact: { label: 'Do not contact', closed: true },
};

export const BUCKET_ORDER = ['new', 'engaged', 'quoted', 'booking', 'quiet', 'dormant', 'with_person', 'won', 'lost', 'do_not_contact'];

/** Day offsets for each touch, from the bucket's anchor moment. */
export const DEFAULT_CADENCE = {
    quoted: [1, 3, 7],
    booking: [1, 3],
    quiet: [3, 7, 14],
    dormant: [30, 60, 90],
};

/** What happens when a cadence runs out with no reply. */
const AFTER_EXHAUSTED = {
    quoted: 'quiet',
    booking: 'with_person',
    quiet: 'dormant',
    dormant: 'lost',
};

/** The human-facing sales status each bucket implies. Never the other way round. */
export const LEAD_STATUS_FOR = {
    new: 'new',
    engaged: 'contacted',
    quoted: 'quotation_sent',
    booking: 'quotation_sent',
    quiet: 'follow_up_scheduled',
    dormant: 'follow_up_scheduled',
    with_person: null, // leave whatever the person set
    won: 'won',
    lost: 'lost',
    do_not_contact: 'lost',
};

const DAY = 86_400_000;

export function freshState(now = new Date()) {
    return { bucket: 'new', touchCount: 0, anchorAt: now, nextTouchAt: null, previousBucket: null };
}

/** "touch 2 of 3", or '' for a bucket with no cadence. */
export function describeStage(state, cadence = DEFAULT_CADENCE) {
    const stages = cadence[state.bucket];
    if (!stages) return '';
    return `touch ${Math.min(state.touchCount + 1, stages.length)} of ${stages.length}`;
}

/**
 * When the next touch is due for this state, or null if the bucket has no
 * cadence, is closed, or has used every stage.
 */
export function nextTouchFor(state, cadence = DEFAULT_CADENCE) {
    const stages = cadence[state.bucket];
    if (!stages || state.touchCount >= stages.length) return null;
    const anchor = new Date(state.anchorAt || Date.now());
    return new Date(anchor.getTime() + stages[state.touchCount] * DAY);
}

function enter(state, bucket, now) {
    const next = {
        ...state,
        previousBucket: state.bucket === bucket ? state.previousBucket : state.bucket,
        bucket,
        touchCount: 0,
        anchorAt: now,
    };
    next.nextTouchAt = nextTouchFor(next);
    return next;
}

/**
 * The one reducer. Returns { state, changed, reason }. `reason` is a short
 * sentence for the action log; `changed` is false when the event does not
 * apply to the current bucket, so a caller can skip logging a non-move.
 */
export function transition(state, event, { now = new Date(), cadence = DEFAULT_CADENCE } = {}) {
    const b = state.bucket;
    const closed = BUCKETS[b]?.closed;
    const moved = (bucket, reason) => ({ state: enter({ ...state }, bucket, now), changed: true, reason });
    const same = (reason = '') => ({ state, changed: false, reason });

    switch (event) {
        case 'inbound': {
            // A reply from anywhere brings the lead back to the table and
            // cancels every scheduled touch. Closed buckets stay closed:
            // a Lost lead who writes in is answered, not re-opened here.
            if (closed || b === 'with_person') return same('reply received, bucket unchanged');
            if (b === 'new') return same('first message already noted');
            if (b === 'engaged') return { state: { ...state, touchCount: 0, nextTouchAt: null, anchorAt: now }, changed: true, reason: 'reply received' };
            return moved('engaged', `reply received, back from ${BUCKETS[b].label}`);
        }
        case 'first_reply_sent':
            return b === 'new' ? moved('engaged', 'first reply sent') : same();
        case 'quote_sent':
            return ['engaged', 'quiet', 'dormant', 'new'].includes(b) ? moved('quoted', 'quotation sent') : same();
        case 'confirmed':
            return b === 'quoted' ? moved('booking', 'customer confirmed and checks passed') : same();
        case 'signed':
            return closed ? same() : moved('won', 'contract signed');
        case 'declined':
            return closed ? same() : moved('lost', 'customer declined');
        case 'silence':
            // Only a live or quoted conversation can go quiet; a bucket
            // already on a cadence is already handling silence.
            if (b === 'engaged') return moved('quiet', 'no reply for 24 hours');
            if (b === 'quoted') return moved('quiet', 'no reply after the quotation');
            return same();
        case 'touch_sent': {
            const stages = cadence[b];
            if (!stages) return same();
            const next = { ...state, touchCount: state.touchCount + 1, anchorAt: now };
            next.nextTouchAt = nextTouchFor(next, cadence);
            return { state: next, changed: true, reason: `${describeStage(state, cadence)} sent` };
        }
        case 'exhausted': {
            const to = AFTER_EXHAUSTED[b];
            return to ? moved(to, `${cadence[b].length} touches with no reply`) : same();
        }
        case 'escalate':
            return b === 'with_person' || closed ? same() : moved('with_person', 'handed to a person');
        case 'hand_back':
            return b === 'with_person' ? moved(state.previousBucket || 'engaged', 'handed back by a person') : same();
        case 'opt_out':
            return moved('do_not_contact', 'asked not to be contacted');
        default:
            return same();
    }
}

/** Whether the agent may start a conversation with this lead on its own. */
export function mayContactFirst(state) {
    const b = BUCKETS[state.bucket];
    return Boolean(b) && !b.closed && !b.paused;
}
