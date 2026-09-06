import { Contract, Customer } from '../models/index.js';
import { renewLink } from './renewalLink.js';
import { sendWhatsAppText, whatsappSendConfigured } from './whatsapp.js';

/**
 * Answering the Yes/No buttons on the contract-expiry WhatsApp template.
 *
 * A WhatsApp template cannot branch on its own. Tapping "Yes" only posts that
 * word back to the business number — nothing follows unless something is
 * listening. This is that something: it recognises the tap, finds whose
 * contract it is, and sends the renewal link straight back.
 *
 * Only a BUTTON tap is acted on, never the word "yes" typed in a chat.
 * Somebody answering "yes" to a question the AI assistant asked must not be
 * handed a renewal link instead — a button carries the context a bare word
 * does not.
 *
 * The reply is a plain text message, which is allowed because their tap is
 * itself an inbound message and opens Meta's 24-hour window. No template is
 * needed for the follow-up, which is what makes this possible at all.
 */

const suffix = (p) => String(p || '').replace(/\D/g, '').slice(-9);

const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
});

/**
 * The words on a button the customer tapped, whatever shape Meta used.
 *
 * A template's quick reply arrives as `type: 'button'` with `button.text`;
 * an interactive message's arrives under `interactive.button_reply`. Neither
 * carries `text.body`, which is why these taps were being stored as blank
 * messages before this existed.
 */
export function buttonReplyText(raw) {
    if (!raw || typeof raw !== 'object') return '';
    return String(
        raw.button?.text
        || raw.button?.payload
        || raw.interactive?.button_reply?.title
        || raw.interactive?.button_reply?.id
        || raw.interactive?.list_reply?.title
        || '',
    ).trim();
}

/** Was this a button at all, as opposed to something they typed? */
export function isButtonReply(raw, type) {
    if (type === 'button') return true;
    return Boolean(raw?.interactive?.button_reply || raw?.interactive?.list_reply);
}

const YES = /^(yes|yes please|renew|renew my unit|i want to renew|نعم)$/i;
const NO = /^(no|no thanks|not renewing|moving out|لا)$/i;

/** Yes, no, or neither — a button we do not recognise is left alone. */
export function readAnswer(text) {
    const t = String(text || '').trim();
    if (YES.test(t)) return 'renewing';
    if (NO.test(t)) return 'not_renewing';
    return '';
}

/**
 * The contract this number is about to renew.
 *
 * Nearest expiry first: somebody with two units who taps Yes on a message
 * about one of them means that one, and it is the one running out soonest.
 */
async function contractForPhone(phoneNormalized) {
    const key = suffix(phoneNormalized);
    if (key.length < 7) return null;
    const rx = new RegExp(`${key}$`);
    const customers = await Customer.find({ $or: [{ phone: rx }, { phones: rx }] }).select('_id fullName').lean();
    if (!customers.length) return null;
    return Contract.findOne({
        customer: { $in: customers.map((c) => c._id) },
        status: 'active',
        endDate: { $ne: null },
    }).sort({ endDate: 1 }).populate('customer', 'fullName phone').populate('unit', 'unitNumber');
}

/**
 * Act on a Yes/No tap. Returns whether it was handled, so the caller can keep
 * the AI assistant from answering the same tap a second time.
 */
export async function handleRenewalButtonReply({ phoneNormalized, text, type, raw }) {
    if (!isButtonReply(raw, type)) return { handled: false };

    const answer = readAnswer(text || buttonReplyText(raw));
    if (!answer) return { handled: false };

    const contract = await contractForPhone(phoneNormalized);
    // No contract on this number — a lead tapping a button on some other
    // template. Leave it for the assistant rather than inventing a renewal.
    if (!contract) return { handled: false };

    const name = String(contract.customer?.fullName || '').trim().split(/\s+/)[0] || 'there';
    const unitNo = contract.unit?.unitNumber || 'your unit';

    contract.renewalIntent = answer;
    contract.timeline.push({
        at: new Date(),
        author: 'Tenant (WhatsApp)',
        text: answer === 'renewing'
            ? `Tapped "Yes" on the expiry message — renewal link sent on WhatsApp`
            : `Tapped "No" on the expiry message — not renewing`,
    });
    await contract.save();

    if (answer === 'not_renewing') {
        /* Nothing is sent back. They have said they are leaving, and a cheerful
         * automated reply to that is worse than silence — the move-out is a
         * conversation somebody here should have. The intent is recorded, which
         * is what puts them in front of that person. */
        return { handled: true, answer, contractId: String(contract._id), sent: false };
    }

    if (!whatsappSendConfigured()) return { handled: true, answer, sent: false };

    /* Their tap opened the 24-hour window, so this can be a plain message with
     * a link in it rather than another approved template. */
    const body = [
        `Great, ${name}! Here's your renewal link for ${unitNo}:`,
        '',
        renewLink(contract._id),
        '',
        `Pick how long you'd like to stay, see the price, and pay by card or bank transfer — it renews straight away.`,
        contract.endDate ? `Your contract currently ends on ${fmtDate(contract.endDate)}.` : '',
    ].filter(Boolean).join('\n');

    try {
        /* Reply to the number that just messaged us, not the one on file — a
         * customer record can carry an old or differently-formatted number, and
         * this one is known to work because a message just arrived from it. */
        await sendWhatsAppText({ to: phoneNormalized || contract.customer?.phone, body });
        return { handled: true, answer, contractId: String(contract._id), sent: true };
    } catch (e) {
        /* Recorded rather than thrown: the tap has already been saved as intent,
         * and a webhook must not fail because one message did not go out. The
         * contract now says they want to renew, so somebody will see it. */
        console.error('[RenewalReply] link send failed:', e.message);
        await Contract.findByIdAndUpdate(contract._id, {
            $push: {
                timeline: {
                    at: new Date(),
                    author: 'Tenant (WhatsApp)',
                    text: `Renewal link could NOT be sent on WhatsApp (${e.message}) — send it manually`,
                },
            },
        }).catch(() => { });
        return { handled: true, answer, contractId: String(contract._id), sent: false, error: e.message };
    }
}
