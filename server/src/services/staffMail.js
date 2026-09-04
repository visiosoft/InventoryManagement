/**
 * Who on the team may be emailed by the system.
 *
 * Not customers — this is only about the people who work here. A tenant still
 * gets their quotation, their invoice and their contract; none of that passes
 * through here.
 *
 * The system was sending 70 messages a day to its own staff: one for every
 * lead handed over, one for every unanswered lead, one for every task, and a
 * brief each morning. Twenty-five of them landed on one person. Email stopped
 * being a signal and became something to filter away, which is the state in
 * which the one message that mattered would have been missed too.
 *
 * So the rule is now the narrowest one that keeps the business running:
 * accounts is emailed, and nobody else is. Accounts is the seat that has to
 * act on something arriving from outside their own screen — a signed contract
 * that needs invoicing does not appear on a board they were already watching.
 * Everybody else finds their work where they already are: the leads board, the
 * task board, the inbox, and the badges on all three.
 *
 * One place, so a new notification cannot quietly reintroduce the flood by
 * calling sendMail directly and forgetting the rule.
 */

/** Roles that may receive a notification email. */
export const EMAILED_ROLES = new Set(['accounts']);

/**
 * May this colleague be emailed?
 *
 * Takes a user document or anything with `role` and `email`. Returns false
 * for somebody with no address at all, so callers need only ask once.
 */
export function mayEmailStaff(user) {
   return Boolean(user?.email) && EMAILED_ROLES.has(user?.role);
}

/**
 * Everybody in the accounts seat, by address.
 *
 * Accounts is copied on every task, not only the ones assigned to them: the
 * work they have to do — raising an invoice against a contract somebody else
 * signed — starts on somebody else's task. Reading it off the role rather than
 * a hard-coded address means the day accounting@purplebox.ae becomes somebody
 * else's mailbox, nothing here has to be remembered.
 */
export async function accountsAddresses() {
   const { User } = await import('../models/index.js');
   const people = await User.find({ isActive: true, role: 'accounts' }).select('email').lean();
   return people.map((u) => u.email).filter(Boolean);
}

/** Why not, for a log line or a returned reason. */
export function whyNotEmailed(user) {
   if (!user?.email) return 'no email address';
   return `${user.role || 'this role'} is not emailed — only accounts is`;
}
