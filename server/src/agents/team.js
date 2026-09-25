/**
 * The team: who owns what, and who gets a new lead first. Pure functions
 * over an array of AgentProfile documents, so the rules can be asserted
 * without a database.
 *
 * Two ideas, kept separate on purpose:
 *   - a routing rule picks a lead's FIRST owner, once, when it arrives;
 *   - bucket ownership moves a lead between agents afterwards, at bucket
 *     boundaries, and never on a reply (a lead that comes back to Engaged
 *     stays with whoever has it — continuity beats the org chart).
 */

const onDuty = (p) => p && p.isActive !== false && p.mode !== 'off';

/** The agent that owns this bucket, or null if nobody claims it. */
export function ownerForBucket(profiles, bucket) {
    return (profiles || []).find((p) => onDuty(p) && (p.ownsBuckets || []).includes(bucket)) || null;
}

/** The fallback owner: the flagged default, else the first on duty. */
export function defaultAgent(profiles) {
    const live = (profiles || []).filter(onDuty);
    return live.find((p) => p.isDefault) || live[0] || null;
}

const digits = (v) => String(v || '').replace(/\D/g, '');

/**
 * Who takes a lead that has just arrived. `signals` is what the router
 * can see at that moment: the business number the message came in on,
 * a detected language, the lead's source, whether they are already a tenant.
 * First match wins; the default agent catches everything else.
 */
export function routeFirstOwner(profiles, signals = {}) {
    const live = (profiles || []).filter(onDuty);
    if (!live.length) return null;

    if (signals.isTenant) {
        const tenants = live.find((p) => (p.ownsBuckets || []).includes('tenant'));
        if (tenants) return tenants;
    }
    const inbound = digits(signals.businessNumber);
    if (inbound) {
        const byNumber = live.find((p) => (p.whatsappNumbers || []).some((n) => digits(n) && (inbound.endsWith(digits(n)) || digits(n).endsWith(inbound))));
        if (byNumber) return byNumber;
    }
    if (signals.language) {
        const lang = String(signals.language).toLowerCase();
        const byLang = live.find((p) => (p.languages || []).some((l) => String(l).toLowerCase() === lang));
        if (byLang) return byLang;
    }
    // Whoever owns New is the natural first responder.
    return ownerForBucket(live, 'new') || defaultAgent(live);
}

/**
 * After a bucket move: does ownership change? Returns the new owner, or
 * null when the lead stays where it is. Never moves a lead on the way back
 * to Engaged, and never moves one that is with a person.
 */
export function handoffFor(profiles, { currentAgentId, bucketBefore, bucketAfter, event }) {
    if (bucketAfter === bucketBefore) return null;
    if (event === 'inbound' || bucketAfter === 'engaged' || bucketAfter === 'with_person') return null;
    const owner = ownerForBucket(profiles, bucketAfter);
    if (!owner) return null;
    if (String(owner._id) === String(currentAgentId)) return null;
    return owner;
}

/** True when today's spend has not yet reached the profile's budget (0 = no budget). */
export function withinBudget(profile, spentTodayAed = 0) {
    const cap = Number(profile?.dailyBudgetAed || 0);
    return cap <= 0 || spentTodayAed < cap;
}
