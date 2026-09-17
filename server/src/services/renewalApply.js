import crypto from 'node:crypto';
import { Contract, ContractRenewal, Invoice, Payment, nextInvoiceNo } from '../models/index.js';
import { applyInvoicePayment, syncLinkedPayment } from './invoicePayments.js';
import { sendMail, mailConfigured } from './mail.js';
import { sendWhatsAppText, whatsappSendConfigured } from './whatsapp.js';
import { renderInvoicePdf } from './invoicePdf.js';

const clientOrigin = () => String(process.env.CLIENT_ORIGIN || 'https://office.purplebox.ae').replace(/\/+$/, '');

/**
 * Turning a paid renewal into an extended contract.
 *
 * One function because two things arrive here by different roads — a Stripe
 * webhook for a card, a colleague pressing "confirm transfer received" for a
 * bank payment — and "what does renewed actually mean" must not have two
 * implementations that drift. That is the same reasoning behind
 * services/invoicePayments.js, which had exactly this problem.
 *
 * Everything here is idempotent. Stripe retries a webhook on any non-2xx and
 * will happily deliver the same event twice, so a second call must extend
 * nothing, raise no second invoice, and send no second email.
 */

const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
});

const money = (n) => Number(n || 0).toLocaleString('en-AE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/**
 * Open a fresh signing link for the renewed term.
 *
 * The contract stays active — this is a re-sign, not a new agreement, the
 * same shape as the admin's own "Send agreement" button on the contract page
 * (routes/contracts.js `create-signing-link`), so an online renewal and one a
 * colleague sends by hand read identically to a tenant. Signing regenerates
 * the contract PDF from the contract's own live fields, and `contract.endDate`
 * has already been moved by the time this runs, so what they sign carries the
 * renewed date, not the old one.
 *
 * Same 7-day expiry as the manual button. A renewal already paid for does not
 * hinge on the signature — the money and the invoice stand regardless — so a
 * tenant who lets the window lapse is a reminder to chase, not a renewal to
 * undo.
 */
function openSigningLink(contract) {
    const token = crypto.randomBytes(32).toString('hex');
    contract.signingToken = token;
    contract.signingTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return `${clientOrigin()}/sign/${token}`;
}

/**
 * Raise the invoice for the renewed period.
 *
 * VAT is its own line rather than a field because the storage Invoice schema
 * has nowhere to put it — the contract invoices raised today carry none. That
 * is also why a renewal invoice looks slightly different from the rest of a
 * tenant's history, which was a deliberate choice, not an oversight.
 */
async function raiseRenewalInvoice(renewal, contract, unitNo) {
    const from = renewal.currentEndDate;
    const to = renewal.newEndDate;
    // The last day they are paying for, not the day after it — a tenant reading
    // "01 Oct – 29 Oct" on an invoice that ends on the 28th will ask why.
    const displayEnd = fmtDate(new Date(new Date(to).getTime() - 86400000));

    const items = [{
        sortOrder: 0,
        itemDetails: `Storage rental — Unit ${unitNo}, ${fmtDate(from)} – ${displayEnd}`,
        quantity: renewal.weeks,
        rate: renewal.weeklyRate,
        discountPct: 0,
        amount: renewal.subTotal,
    }];
    if (renewal.vatAmount > 0) {
        items.push({
            sortOrder: 1,
            itemDetails: `VAT (${renewal.vatPct}%)`,
            quantity: 1,
            rate: renewal.vatAmount,
            discountPct: 0,
            amount: renewal.vatAmount,
        });
    }

    const invoice = await Invoice.create({
        invoiceNo: await nextInvoiceNo(unitNo, contract._id),
        customer: contract.customer?._id || contract.customer,
        invoiceDate: new Date(),
        dueDate: new Date(from),
        orderNumber: contract.contractNo,
        terms: 'Due on receipt',
        subject: `Renewal — ${fmtDate(from)} – ${displayEnd} · ${contract.contractNo}`,
        items,
        customerNotes: 'Renewed online by the tenant.',
        subTotal: renewal.total,
        total: renewal.total,
        paymentMade: 0,
        status: 'sent',
    });

    await Payment.create({
        contract: contract._id,
        invoice: invoice._id,
        amount: renewal.total,
        dueDate: new Date(from),
        status: 'pending',
        notes: `Renewal ${fmtDate(from)} – ${displayEnd} · Unit ${unitNo}`,
    });

    return invoice;
}

/**
 * Tell the tenant it is done, on whichever channel we can reach them.
 *
 * Both are attempted rather than one being picked: somebody who renewed from a
 * WhatsApp message still wants the invoice as a file, and email is the only one
 * of the two that can carry it. Neither failing is allowed to undo a renewal
 * that has already been paid for — the money is in, the contract is extended,
 * and a bounced email is a support problem, not a reason to roll back.
 */
export async function notifyRenewalApplied({ contract, customer, renewal, invoice, signingUrl = '' }) {
    const results = { email: 'skipped', whatsapp: 'skipped' };
    const name = customer?.fullName || 'there';
    const endsOn = fmtDate(renewal.newEndDate);

    if (customer?.email && mailConfigured()) {
        try {
            let attachments = [];
            try {
                const pdf = await renderInvoicePdf({
                    invoice: await Invoice.findById(invoice._id).populate('customer', 'fullName email phone address'),
                });
                attachments = [{ filename: `${invoice.invoiceNo}.pdf`, content: pdf, contentType: 'application/pdf' }];
            } catch (e) {
                // A PDF that will not render must not hold up the confirmation.
                console.error('[Renewal] invoice PDF failed:', e.message);
            }

            const html = [
                `<p>Hi ${name},</p>`,
                `<p>Your storage contract <strong>${contract.contractNo}</strong> has been renewed. ✅</p>`,
                `<p>It now runs until <strong>${endsOn}</strong>.</p>`,
                '<p>' + [
                    `Period: ${renewal.weeks} week${renewal.weeks === 1 ? '' : 's'}`,
                    `Rent: AED ${money(renewal.subTotal)}`,
                    `VAT (${renewal.vatPct}%): AED ${money(renewal.vatAmount)}`,
                    `<strong>Total: AED ${money(renewal.total)}</strong>`,
                ].join('<br/>') + '</p>',
                attachments.length ? `<p>Your invoice ${invoice.invoiceNo} is attached.</p>` : '',
                /* The paperwork still needs their signature on the new term —
                 * the invoice being paid does not stand in for it. Put after
                 * the money, since that is the part they came here to confirm. */
                signingUrl
                    ? `<p>One more thing — please re-sign your agreement for the renewed term: <a href="${signingUrl}">${signingUrl}</a></p>`
                    : '',
                '<p>Thank you for staying with PurpleBox.</p>',
            ].filter(Boolean).join('\n');

            await sendMail({
                to: customer.email,
                subject: `Renewed — ${contract.contractNo} now runs to ${endsOn}`,
                text: [
                    `Hi ${name},`,
                    `Your storage contract ${contract.contractNo} has been renewed and now runs until ${endsOn}.`,
                    `Total paid: AED ${money(renewal.total)}`,
                    `Invoice: ${invoice.invoiceNo}`,
                    signingUrl ? `Please re-sign your agreement for the renewed term: ${signingUrl}` : '',
                    'Thank you for staying with PurpleBox.',
                ].filter(Boolean).join('\n\n'),
                html,
                attachments,
            });
            results.email = 'sent';
        } catch (e) {
            results.email = `failed: ${e.message}`;
            console.error('[Renewal] confirmation email failed:', e.message);
        }
    }

    if (customer?.phone && whatsappSendConfigured()) {
        try {
            const body = [
                `Hi ${name}, your storage contract ${contract.contractNo} has been renewed and now runs until ${endsOn}.`,
                `Total AED ${money(renewal.total)} — invoice ${invoice.invoiceNo}.`,
                signingUrl ? `Please re-sign your agreement for the renewed term: ${signingUrl}` : '',
                'Thank you for staying with PurpleBox.',
            ].filter(Boolean).join(' ');
            await sendWhatsAppText({ to: customer.phone, body });
            results.whatsapp = 'sent';
        } catch (e) {
            /* Outside Meta's 24-hour window a plain text message is refused and
             * only an approved template would go. That is expected here more
             * often than not — the tenant paid on a web page, which does not
             * open a WhatsApp window — so this is logged rather than treated as
             * a fault. The email above is the channel that carries the invoice. */
            results.whatsapp = `failed: ${e.message}`;
            console.error('[Renewal] confirmation WhatsApp failed:', e.message);
        }
    }

    return results;
}

/**
 * Should this renewal actually move the end date, and what needs saying if not?
 *
 * Pure, and separated out because it is the part that can quietly do harm. The
 * dangerous case is a contract that already runs past the date being paid for —
 * a second renewal, or a colleague extending by hand in between. Writing the
 * renewed date in then would SHORTEN a term the tenant has already paid for,
 * and nothing downstream would notice.
 *
 * So the rule is: only ever forwards. Take the money, raise the invoice, and
 * say plainly that the date was left alone.
 */
export function decideExtension({ contractEndDate, quotedEndDate, newEndDate }) {
    const current = contractEndDate ? new Date(contractEndDate) : null;
    const quoted = quotedEndDate ? new Date(quotedEndDate) : null;
    const next = new Date(newEndDate);
    const notes = [];

    if (current && quoted && current.getTime() !== quoted.getTime()) {
        notes.push(`End date moved from ${fmtDate(quoted)} to ${fmtDate(current)} between quoting and payment.`);
    }

    const extend = !current || next > current;
    if (!extend) {
        notes.push(`Contract already runs to ${fmtDate(current)}, past the renewed date — end date left alone.`);
    }
    return { extend, notes };
}

/**
 * Extend the contract, raise the invoice, tell the tenant.
 *
 * `paid` says whether the money is already in. A card renewal arrives here with
 * it true and the invoice is marked settled; a bank transfer confirmed by a
 * colleague also arrives true, because that is what they are confirming.
 */
export async function applyRenewal(renewalId, { byName = '', paid = true } = {}) {
    const renewal = await ContractRenewal.findById(renewalId);
    if (!renewal) return { ok: false, error: 'Renewal not found' };

    // Stripe delivers the same event more than once. Returning the earlier
    // result is the whole of the idempotency guarantee.
    if (renewal.status === 'applied') {
        return { ok: true, alreadyApplied: true, renewal, invoiceId: renewal.invoice };
    }
    if (renewal.status === 'cancelled') {
        return { ok: false, error: 'This renewal was cancelled' };
    }

    const contract = await Contract.findById(renewal.contract).populate('customer', 'fullName email phone').populate('unit', 'unitNumber');
    if (!contract) {
        renewal.error = 'Contract no longer exists';
        await renewal.save();
        return { ok: false, error: renewal.error };
    }
    if (['ended', 'cancelled'].includes(contract.status)) {
        /* The tenant has paid but the contract was closed in between. Do not
         * silently reopen it — somebody ended it for a reason, and that reason
         * is not in this code. Flag it and let a person decide. */
        renewal.status = 'paid';
        renewal.reviewNote = `Paid, but the contract was ${contract.status} before this could be applied. Needs a person.`;
        await renewal.save();
        return { ok: false, needsReview: true, error: renewal.reviewNote };
    }

    const newEnd = new Date(renewal.newEndDate);
    const { extend: extends_, notes } = decideExtension({
        contractEndDate: contract.endDate,
        quotedEndDate: renewal.currentEndDate,
        newEndDate: renewal.newEndDate,
    });
    let signingUrl = '';
    if (extends_) {
        contract.endDate = newEnd;
        // Nothing to re-sign when the date did not move — see decideExtension.
        signingUrl = openSigningLink(contract);
    }

    const unitNo = contract.unit?.unitNumber || '-';
    const invoice = await raiseRenewalInvoice(renewal, contract, unitNo);

    if (paid) {
        applyInvoicePayment(invoice, {
            amount: renewal.total,
            method: renewal.method === 'card' ? 'card' : 'bank',
            notes: renewal.method === 'card'
                ? `Renewal paid online via Stripe (${renewal.stripeCheckoutSessionId})`
                : `Renewal paid by bank transfer, confirmed by ${byName || 'staff'}`,
        });
        await invoice.save();
        await syncLinkedPayment(invoice);
    }

    /* Who the activity feed credits. A card renewal was genuinely done by the
     * tenant with nobody involved; a bank transfer was done by them and then
     * confirmed by a named colleague, and the feed should say both. */
    const author = renewal.method === 'card'
        ? 'Tenant (online renewal)'
        : `${byName || 'Staff'} (confirmed tenant transfer)`;

    contract.renewalIntent = 'renewing';

    /* Three separate rows rather than one long sentence: somebody scanning the
     * feed later is usually answering one specific question — did they pay,
     * what were they invoiced, did the invoice actually go out — and a single
     * combined line makes all three harder to find. */
    contract.timeline.push({
        at: new Date(),
        author,
        text: [
            `Renewed online to ${fmtDate(newEnd)}`,
            `— ${renewal.weeks} week${renewal.weeks === 1 ? '' : 's'},`,
            `AED ${money(renewal.subTotal)} + AED ${money(renewal.vatAmount)} VAT`,
            `= AED ${money(renewal.total)},`,
            renewal.method === 'card'
                ? `paid by card via Stripe${renewal.stripeCheckoutSessionId ? ` (${renewal.stripeCheckoutSessionId})` : ''}.`
                : 'paid by bank transfer.',
        ].join(' '),
    });
    contract.timeline.push({
        at: new Date(),
        author,
        text: `Invoice ${invoice.invoiceNo} raised for the renewal — AED ${money(renewal.total)}${paid ? ', marked paid in full.' : '.'}`,
    });
    if (signingUrl) {
        contract.timeline.push({
            at: new Date(),
            author,
            text: `Sent to re-sign for the renewed term (expires ${fmtDate(contract.signingTokenExpiry)}).`,
        });
    }
    if (!extends_ || notes.length) {
        // A renewal that could not move the date must be impossible to miss.
        contract.timeline.push({ at: new Date(), author, text: `Needs a look: ${notes.join(' ')}` });
    }

    /* The dedicated renewal record, which is what the contract's Renewal
     * History table reads — the general timeline is not enough. Same shape a
     * manual Check Out change writes, so an online renewal and one typed in by
     * a colleague sit in the same list rather than only one of them showing. */
    if (extends_) {
        contract.renewalHistory.push({
            at: new Date(),
            previousEndDate: renewal.currentEndDate,
            newEndDate: newEnd,
            author,
        });
    }
    await contract.save();

    renewal.status = 'applied';
    renewal.appliedAt = new Date();
    renewal.appliedByName = byName;
    renewal.invoice = invoice._id;
    if (notes.length) renewal.reviewNote = notes.join(' ');
    await renewal.save();

    const notified = await notifyRenewalApplied({
        contract,
        customer: contract.customer,
        renewal,
        invoice,
        signingUrl,
    });

    /* Record where the invoice actually went, after the fact.
     *
     * Written separately because it is the only part that cannot be known in
     * advance, and it is the difference between "we think they got it" and
     * knowing. A failure is recorded just as plainly — an invoice that silently
     * never sent is the thing that turns into "I was never told" three weeks
     * later. Pushed rather than re-saving the whole document so it cannot
     * clobber anything changed in between. */
    const delivery = [];
    if (notified.email === 'sent') delivery.push(`emailed to ${contract.customer?.email}`);
    else if (notified.email.startsWith('failed')) delivery.push(`email FAILED (${notified.email.slice(8)})`);
    if (notified.whatsapp === 'sent') delivery.push('sent on WhatsApp');
    else if (notified.whatsapp.startsWith('failed')) delivery.push('WhatsApp not delivered (no open 24h window)');

    await Contract.findByIdAndUpdate(contract._id, {
        $push: {
            timeline: {
                at: new Date(),
                author,
                text: delivery.length
                    ? `Renewal invoice ${invoice.invoiceNo} ${delivery.join(', ')}.`
                    : `Renewal invoice ${invoice.invoiceNo} was NOT sent — no email address on file and WhatsApp unavailable.`,
            },
        },
    }).catch((e) => console.error('[Renewal] delivery note failed:', e.message));

    return { ok: true, renewal, invoiceId: invoice._id, extended: extends_, notified, reviewNote: renewal.reviewNote };
}
