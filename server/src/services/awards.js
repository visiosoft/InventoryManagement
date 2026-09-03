/**
 * Who gets recognised, and for what.
 *
 * Pure functions over rows the leaderboard has already counted, so an award
 * can be asserted without a database and cannot invent a winner out of an
 * empty period.
 *
 * Two rules run through all of them:
 *
 *   - Nothing is awarded for nothing. A month in which nobody closed anything
 *     crowns no top closer; a trophy handed out for a zero is worth less than
 *     no trophy.
 *   - Ties are shared. Picking one of two equal people by whoever sorts first
 *     is arbitrary, and the person who loses that coin toss knows it.
 */

/** Enough leads that a rate means something. One-of-one is not a conversion. */
export const MIN_LEADS_FOR_RATE = 10;

/** How many answered leads somebody needs before their reply time is a habit
 *  rather than an accident. Measured on production, one rep held the fastest
 *  median in the company off three leads. */
export const MIN_REPLIES_FOR_SPEED = 5;

export const AWARDS = {
   top_closer: { label: 'Top closer', hint: 'Most deals closed this period' },
   highest_value: { label: 'Biggest book', hint: 'Largest total deal value this period' },
   best_conversion: { label: 'Best conversion', hint: `Highest share of their leads closed (at least ${MIN_LEADS_FOR_RATE} leads)` },
   fastest_response: { label: 'Fastest to reply', hint: 'Quickest to answer a lead they were given' },
   most_improved: { label: 'Most improved', hint: 'Biggest rise in closes since last period' },
   first_deal: { label: 'First deal', hint: 'Their first closed deal' },
};

/** Everybody holding the best value, when that value is worth having. */
function leadersBy(rows, value, { minimum = 0, lowerIsBetter = false } = {}) {
   const eligible = rows.filter((r) => {
      const v = value(r);
      return Number.isFinite(v) && (lowerIsBetter ? v > 0 : v > minimum);
   });
   if (!eligible.length) return [];
   const best = eligible.reduce(
      (acc, r) => (lowerIsBetter ? Math.min(acc, value(r)) : Math.max(acc, value(r))),
      lowerIsBetter ? Infinity : -Infinity,
   );
   return eligible.filter((r) => value(r) === best).map((r) => r.userId);
}

/**
 * Award keys per person.
 *
 * `rows` are this period; each row carries { userId, closed, value, received,
 * medianResponseMins, responsesMeasured, closedPreviously, closedEverBefore }.
 * `hasPreviousPeriod` is false for the all-time board, which has nothing
 * behind it to improve on.
 * Returns { [userId]: string[] }.
 */
export function awardsFor(rows = [], { hasPreviousPeriod = true } = {}) {
   const out = {};
   const give = (ids, key) => ids.forEach((id) => { (out[id] ||= []).push(key); });

   give(leadersBy(rows, (r) => r.closed), 'top_closer');
   give(leadersBy(rows, (r) => r.value), 'highest_value');

   /* Off the leads they were actually handed, not off every deal they raised —
      otherwise somebody given four leads who signed eighteen walk-ins scores
      450% and wins a conversion award for it. */
   give(
      leadersBy(
         rows.filter((r) => r.received >= MIN_LEADS_FOR_RATE),
         (r) => (r.received ? (r.closedFromLeads ?? r.closed) / r.received : 0),
      ),
      'best_conversion',
   );

   /* Speed is only a habit once there are a few of them. Somebody handed three
      leads who answered all three in two minutes is not the fastest in the
      company, and a board that says so is one nobody believes twice. */
   give(
      leadersBy(
         rows.filter((r) => (r.responsesMeasured ?? 0) >= MIN_REPLIES_FOR_SPEED),
         (r) => r.medianResponseMins,
         { lowerIsBetter: true },
      ),
      'fastest_response',
   );

   /* Improvement is a rise, so somebody who stood still or fell wins nothing —
      and on an all-time board there is nothing to have risen from, so it is not
      awarded at all rather than handed to whoever closed the most. */
   if (hasPreviousPeriod) {
      give(leadersBy(rows, (r) => r.closed - (r.closedPreviously ?? 0)), 'most_improved');
   }

   // Once only, and only for a real first: closed now, nothing ever before.
   for (const r of rows) {
      if (r.closed > 0 && !r.closedEverBefore) (out[r.userId] ||= []).push('first_deal');
   }

   return out;
}

/**
 * Rank by closes, then by value, then by conversion.
 *
 * Equal people share a position — two firsts are followed by a third, not a
 * second, which is how a placing is normally read.
 */
export function rank(rows = []) {
   const sorted = [...rows].sort((a, b) => (
      b.closed - a.closed
      || b.value - a.value
      // Before anybody has closed anything, the person working the most leads
      // is the one at the top, rather than whoever happens to sort first.
      || b.received - a.received
   ));
   // Everything the sort above considers, or two people ordered apart would
   // still print the same position.
   const same = (a, b) => a.closed === b.closed && a.value === b.value && a.received === b.received;
   let position = 0;
   return sorted.map((r, i) => {
      if (i === 0 || !same(r, sorted[i - 1])) position = i + 1;
      return { ...r, position };
   });
}
