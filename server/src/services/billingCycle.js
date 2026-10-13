/**
 * When a contract's next 4-week rent payment falls due.
 *
 * This used to be answered by looking up the soonest unpaid `Payment`
 * document — but nothing in this codebase creates a new `Payment` for each
 * ongoing cycle of a contract already invoiced through Zoho Books after
 * signing, so that lookup just returned whichever row was created at
 * signing, unchanged, however far into the lease the contract actually was.
 *
 * This is a pure calendar calculation instead, per confirmed billing policy:
 * PurpleBox collects rent every 4 weeks (28 days) from a contract's start
 * date, and the first 28-day cycle is already paid for as the advance rent
 * collected on the first invoice. So the first real recurring due date is
 * `startDate + 28 days`, then every 28 days after that.
 *
 * The result is forward-looking only — once a due date passes, this jumps to
 * the next cycle rather than staying pinned to the missed one. Whether a
 * given cycle was actually paid is a question for the Zoho-sourced "Owes"
 * figure shown alongside this, not this date; trying to track that locally
 * is exactly the stale-data problem this replaces.
 */
export function nextPaymentDueDate({ startDate, endDate, now = new Date(), cycleDays = 28 }) {
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : null;
    const daysSinceStart = Math.floor((now - start) / 86_400_000);
    // k=1 while still inside the prepaid first cycle (daysSinceStart <= 0).
    // On a boundary day itself (daysSinceStart an exact multiple of
    // cycleDays), Math.ceil leaves k unchanged rather than rounding up to the
    // next one, so "due today" shows today, not 28 days from now.
    const k = Math.max(1, Math.ceil(daysSinceStart / cycleDays));
    const due = new Date(start.getTime() + k * cycleDays * 86_400_000);
    // Past the contract's end, there is nothing left to bill — the lease is
    // winding down, not overdue.
    if (end && due > end) return null;
    return due;
}
