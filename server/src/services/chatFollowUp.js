/**
 * "I'll let you know when I can come."
 *
 * The most dangerous message a customer sends, because nothing in the system
 * treats it as a problem. They wrote, the rep answered, and the conversation
 * looks finished — it is not owed a reply, so the waiting queue cannot see it,
 * and the lead was answered, so the unanswered-lead clock cannot either. It
 * simply goes quiet, and in a week nobody remembers it existed. Measured on
 * production: 366 chats where we spoke last with the lead still open, 185 of
 * them silent for three days or more.
 *
 * Two halves, and they are deliberately different in kind:
 *
 *   a reminder    the rep just read the message and knows when to chase —
 *                 they say so, in one tap, from the chat they are already in
 *   went quiet    the safety net for every one nobody marked, which is the
 *                 case that actually loses leads, because the day somebody is
 *                 too busy to set a reminder is the day it matters
 *
 * A reminder reuses the follow-up machinery that already exists: `followUpAt`
 * on the lead, a task raised on the owner's board the morning it falls due,
 * and a push at the minute it was set for. None of that was reachable from the
 * inbox, which is where reps actually are — 623 leads and 64 future follow-up
 * dates between them.
 *
 * A reply cancels the reminder. Being told to chase somebody you are in the
 * middle of talking to is the fastest way to teach people that reminders are
 * noise, and a reminder people ignore is worse than none. It is cleared rather
 * than silently skipped, with a line in the timeline saying why, so a rep who
 * wonders where their reminder went can see.
 */

import { Lead } from '../models/index.js';

/** Silent for this long, with us having spoken last, is a lead going cold.
 *
 *  Three days rather than two: two puts 276 chats on the list today, which is
 *  more than anybody can face in a morning, and a list that cannot be cleared
 *  stops being read. Three is 185 — a backlog, but a clearable one. */
export const QUIET_DAYS = 3;

/** The hour a reminder lands, local. Early enough to act on the same day,
 *  late enough not to arrive before anybody is working. */
const REMIND_HOUR = 9;

/** Dubai. Everything a rep reads is in their own day, not the server's. */
const TZ_OFFSET_HOURS = 4;

export const PRESETS = ['tomorrow', 'three_days', 'next_week'];

/**
 * When a preset falls due, as an instant.
 *
 * Worked out in local days: "tomorrow" means tomorrow where the person
 * reading it is, whatever the server thinks the date is.
 *
 * @param choice  one of PRESETS, or an ISO date string for a picked day
 * @returns Date, or null if there is nothing to make sense of
 */
export function remindAt(choice, now = new Date()) {
   const shift = TZ_OFFSET_HOURS * 36e5;
   const local = new Date(new Date(now).getTime() + shift);

   const days = choice === 'tomorrow' ? 1
      : choice === 'three_days' ? 3
         : choice === 'next_week' ? 7
            : null;

   if (days === null) {
      // A day somebody picked. Dates only — a follow-up is a day, not a moment.
      const picked = new Date(choice);
      if (Number.isNaN(picked.getTime())) return null;
      const atLocal = new Date(Date.UTC(
         picked.getUTCFullYear(), picked.getUTCMonth(), picked.getUTCDate(), REMIND_HOUR, 0, 0, 0,
      ));
      return new Date(atLocal.getTime() - shift);
   }

   const atLocal = new Date(Date.UTC(
      local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days, REMIND_HOUR, 0, 0, 0,
   ));
   return new Date(atLocal.getTime() - shift);
}

/**
 * Has this conversation gone quiet on us?
 *
 * Four things have to be true, and each of them rules out a different way of
 * being wrong:
 *
 *   we spoke last     otherwise they are owed a reply, which is a different
 *                     queue and a more urgent one
 *   the lead is open  a won or lost lead is finished, not neglected
 *   long enough ago   see QUIET_DAYS
 *   nothing planned   somebody who set a reminder has already dealt with this,
 *                     and listing it anyway would punish them for using it
 */
export function wentQuiet({
   lastInboundAt = null,
   lastOutboundAt = null,
   leadStatus = '',
   followUpAt = null,
   now = new Date(),
   days = QUIET_DAYS,
} = {}) {
   if (!lastOutboundAt) return false;
   if (lastInboundAt && new Date(lastInboundAt) >= new Date(lastOutboundAt)) return false;
   if (!leadStatus || leadStatus === 'won' || leadStatus === 'lost') return false;
   if (followUpAt && new Date(followUpAt) > new Date(now)) return false;
   return (new Date(now) - new Date(lastOutboundAt)) >= days * 864e5;
}

/** How long it has been silent, in whole days. */
export function quietDays(lastOutboundAt, now = new Date()) {
   if (!lastOutboundAt) return 0;
   return Math.max(0, Math.floor((new Date(now) - new Date(lastOutboundAt)) / 864e5));
}

/**
 * They wrote back, so the reminder is not needed.
 *
 * Only a reminder still in the future is cleared: one that has already fallen
 * due has become a task on somebody's board, and that task is theirs to close.
 * Never throws — a message must be delivered whatever this does.
 *
 * @returns { cleared: boolean }
 */
export async function cancelFollowUpOnReply(lead, { at = new Date() } = {}) {
   try {
      if (!lead?.followUpAt) return { cleared: false };
      if (new Date(lead.followUpAt) <= new Date(at)) return { cleared: false };

      const when = new Date(lead.followUpAt).toLocaleDateString('en-GB', {
         day: 'numeric', month: 'short', timeZone: 'Asia/Dubai',
      });
      await Lead.updateOne({ _id: lead._id }, {
         $set: { followUpAt: null, followUpNotifiedAt: null, followUpPushedAt: null },
         $push: {
            timeline: {
               type: 'note',
               // Said out loud, so a rep whose reminder vanished can see why.
               text: `Follow-up for ${when} cleared — they replied.`,
               at,
            },
         },
      });
      return { cleared: true };
   } catch (e) {
      console.error('[ChatFollowUp] could not clear a follow-up:', e.message);
      return { cleared: false };
   }
}
