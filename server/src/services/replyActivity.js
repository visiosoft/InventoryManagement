/**
 * Who is replying to customers, for the dashboard's "Who is on now".
 *
 * Most replies are not typed in the CRM: the team answers from the WhatsApp
 * app on their phones, and those arrive as echoes with no CRM user on them
 * (sentBy null, raw.to set). Counting only CRM replies showed a rep who had
 * answered every chat as "Not replying" with 2 replies. An app reply is
 * credited to the rep who owns the lead — the person the chat belongs to.
 *
 * And a chat is not waiting for us when the customer's last word only closes
 * it — "Okay", "Thanks", 👍 — after we had already replied.
 */

const CLOSERS = [
   'ok', 'okay', 'okk', 'okey', 'k', 'kk', 'oki', 'alright', 'all right', 'fine', 'sure', 'noted', 'done', 'great', 'perfect', 'cool', 'nice', 'good',
   'thanks', 'thank you', 'thankyou', 'thx', 'ty', 'tq', 'many thanks', 'thanks a lot', 'thank you so much', 'thanks so much', 'welcome', 'you are welcome', "you're welcome",
   'got it', 'will do', 'see you', 'bye', 'have a nice day', 'have a good day', 'appreciated', 'much appreciated',
   'شكرا', 'شكراً', 'شكرا لك', 'العفو', 'تمام', 'اوكي', 'حاضر', 'ماشي', 'تسلم', 'مشكور', 'الله يعطيك العافية', 'جزاك الله خير',
];
const CLOSER_SET = new Set(CLOSERS);

/** True when a message only closes the conversation: a thank-you, an okay, or nothing but emoji. */
export function isConversationCloser(text) {
   const raw = String(text || '').trim();
   if (!raw || raw.length > 40) return false;
   // Nothing but emoji and punctuation: 👍 🙏 ❤️ 👌🏻
   if (/^[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s.!]+$/u.test(raw)) return true;
   const t = raw.toLowerCase().replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu, '').replace(/[.!,،?؟\s]+/g, ' ').trim();
   if (CLOSER_SET.has(t)) return true;
   // "ok thanks", "okay thank you", "thanks noted"
   const words = t.split(' ');
   return words.length <= 4 && words.every((w, i) => CLOSER_SET.has(w) || CLOSER_SET.has(`${w} ${words[i + 1] || ''}`.trim()) || CLOSER_SET.has(`${words[i - 1] || ''} ${w}`.trim()));
}

/**
 * The chats still waiting for us: the customer spoke last, and not just to
 * close it after a reply. `lastByPhone` is [{ phone, text, type, repliedBefore }].
 */
export function stillWaiting(lastByPhone = []) {
   return lastByPhone.filter((m) => !(m.repliedBefore && m.type === 'text' && isConversationCloser(m.text)));
}

/**
 * Replies per rep: CRM replies by who sent them, app replies by who owns the
 * lead. Returns { [repId]: { today, lastReplyAt } }.
 */
export function repliesByRep({ crm = [], app = [], ownerOfLead = {}, dayStart }) {
   const out = {};
   const add = (rep, at) => {
      if (!rep) return;
      const r = (out[rep] ||= { today: 0, lastReplyAt: null });
      if (dayStart && new Date(at) >= dayStart) r.today += 1;
      if (!r.lastReplyAt || new Date(at) > new Date(r.lastReplyAt)) r.lastReplyAt = new Date(at);
   };
   for (const m of crm) add(String(m.sentBy), m.occurredAt);
   for (const m of app) add(ownerOfLead[String(m.lead)], m.occurredAt);
   return out;
}
