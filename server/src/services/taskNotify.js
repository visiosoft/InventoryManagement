/**
 * Telling somebody a task is theirs.
 *
 * A task assigned in the app was only visible in the app, so whoever it landed
 * on found out when they next happened to look. Accounts in particular are
 * given work off the back of a booking and need the paperwork with it — the
 * signed contract and who the customer is — rather than a title and a lead
 * name they then have to go and look up.
 *
 * Composing the message is kept separate from sending it, so what goes out can
 * be tested without a mail server or a database.
 */

import { Contract, Document, Quote, Task } from '../models/index.js';
import { mailConfigured, sendMail } from './mail.js';
import { buildContractPdf } from './contractDocument.js';
import { downloadFile, driveConfigured } from './drive.js';
import { quoteLines, quoteTotals } from './quoteLines.js';

const DATE = { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', DATE) : '—');
// Always two decimals: a weekly rate of 162.5 is a typo on an invoice.
const money = (n) => (Number.isFinite(Number(n))
    ? `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—');

const escapeHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The unit numbers on a contract, however they happen to be stored. */
function unitLabel(contract) {
    const many = (contract?.units || []).map((u) => u?.unitNumber).filter(Boolean);
    if (many.length) return many.join(', ');
    return contract?.unit?.unitNumber || '—';
}

/**
 * The subject line: a reference and a few words, never the whole task.
 *
 * The title is a free-text field and people write paragraphs in it — one real
 * assignment began "Hi Mr. Anthony, we need to generate an invoice for Miss
 * Laila under this agreement name…" and every word of it became the subject,
 * which fills a phone screen and says nothing at a glance. The full wording is
 * in the body, where there is room for it.
 */
export function taskSubject({ task, contract }) {
    const ref = task.taskNo || (contract?.contractNo ? contract.contractNo : '');

    /* Trimmed at a word, not mid-word, and only the first line: a title that
       runs on is being used as the notes field, and the subject should not
       inherit that. */
    const firstLine = String(task.title || '').split('\n')[0].trim();
    let label = firstLine;
    if (label.length > 42) {
        const cut = label.slice(0, 42);
        const space = cut.lastIndexOf(' ');
        label = `${(space > 20 ? cut.slice(0, space) : cut).replace(/[,;:.\-—]$/, '')}…`;
    }

    return [ref, label].filter(Boolean).join(' · ') || 'Task assigned';
}

/**
 * The message itself — pure, so it can be asserted against.
 *
 * `contract` is optional: a task raised against a lead, or against nothing at
 * all, still deserves an email, just without the paperwork section.
 */
export function buildTaskEmail({ task, assignee, assignedByName, contract, quote, signedPdfAttached }) {
    const who = assignee?.name || assignee?.email || 'there';
    const subject = taskSubject({ task, contract });

    const rows = [
        ...(task.taskNo ? [['Reference', task.taskNo]] : []),
        ['Task', task.title],
        ['Assigned by', assignedByName || '—'],
        ['Due', task.dueDate ? fmtDate(task.dueDate) : 'No date set'],
        ['Priority', task.priority || 'medium'],
    ];
    if (task.description) rows.push(['Details', task.description]);

    /* What was actually quoted.
     *
     * Accounts raise the invoice off this email, and it used to carry the
     * contract's monthly rate and nothing else — so a fortnight in F2-37 that
     * came to 750.25 arrived as "Rate AED 650, Deposit AED 0", with no rent
     * line, no padlock and no refundable deposit. Everything they had to
     * invoice was missing, and the only way to find it was to open the quote.
     *
     * The lines come from quoteLines.js, the same list the printed quotation
     * is drawn from, so this cannot say something different to the document
     * the customer was sent. */
    const lines = quote ? quoteLines(quote) : [];
    const totals = quote ? quoteTotals(quote, lines) : null;

    const clientRows = contract ? [
        ['Contract', contract.contractNo || '—'],
        ['Customer', contract.customer?.fullName || '—'],
        ['Phone', contract.customer?.phone || '—'],
        ['Email', contract.customer?.email || '—'],
        ['Unit', unitLabel(contract)],
        ['Term', `${fmtDate(contract.startDate)} → ${fmtDate(contract.endDate)}`],
        ['Rate', `${money(contract.rate)} per 4 weeks`],
        ['Deposit', money(contract.deposit)],
        ['Payment method', contract.paymentMethod || '—'],
        ['Status', contract.status || '—'],
    ] : []

    /* Say plainly which document is attached. An unsigned agreement that
       arrives with no comment gets filed as though it were the signed one. */
    const paperwork = !contract ? ''
        : signedPdfAttached
            ? 'The signed contract is attached.'
            : contract.signedDocUrl
                ? `The signed copy could not be attached automatically — it is here: ${contract.signedDocUrl}`
                : 'This contract has not been signed yet, so the current agreement is attached unsigned.';

    const textRows = (list) => list.map(([k, v]) => `${k}: ${v}`).join('\n');
    const text = [
        `Hello ${who},`,
        '',
        `${assignedByName || 'Someone'} has assigned you a task.`,
        '',
        textRows(rows),
        ...(quote ? [
            '',
            `--- What we quoted (${quote.quoteNo || 'quote'}) ---`,
            ...lines.map((l) => `${l.title} — ${l.qty} x ${money(l.rate)} = ${money(l.amount)}${l.taxable ? '' : ' (refundable)'}`),
            `Sub total: ${money(totals.subTotal)}`,
            ...(totals.adjustment ? [`Adjustment: ${money(totals.adjustment)}`] : []),
            ...(totals.vatRate ? [`VAT (${totals.vatRate}%): ${money(totals.vatAmount)}`] : []),
            `Total: ${money(totals.total)}`,
        ] : []),
        ...(contract ? ['', '--- Client details ---', textRows(clientRows), '', paperwork] : []),
        '',
        'PurpleBox',
    ].join('\n');

    const htmlTotal = (label, value, bold = false) => `
      <tr>
        <td style="padding:4px 14px 4px 0;color:#756E80;font-size:13px;text-align:right${bold ? ';font-weight:700;color:#14081F' : ''}">${escapeHtml(label)}</td>
        <td style="padding:4px 0;font-size:13px;text-align:right;white-space:nowrap${bold ? ';font-weight:700' : ''};color:#14081F">${escapeHtml(value)}</td>
      </tr>`;

    const htmlRows = (list) => list.map(([k, v]) => `
      <tr>
        <td style="padding:6px 14px 6px 0;color:#756E80;font-size:13px;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td>
        <td style="padding:6px 0;color:#14081F;font-size:13px">${escapeHtml(v)}</td>
      </tr>`).join('');

    const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#14081F;max-width:560px">
      <p style="font-size:14px">Hello ${escapeHtml(who)},</p>
      <p style="font-size:14px">${escapeHtml(assignedByName || 'Someone')} has assigned you a task.</p>
      <table style="border-collapse:collapse;margin:14px 0">${htmlRows(rows)}</table>
      ${quote ? `
        <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#5B2BC9;margin:22px 0 6px">What we quoted${quote.quoteNo ? ` · ${escapeHtml(quote.quoteNo)}` : ''}</h3>
        <table style="border-collapse:collapse;margin-bottom:14px;width:100%">
          ${lines.map((l) => `
          <tr>
            <td style="padding:6px 14px 6px 0;color:#14081F;font-size:13px">
              ${escapeHtml(l.title)}${l.taxable ? '' : ' <span style="color:#756E80">(refundable)</span>'}
              <div style="color:#756E80;font-size:12px">${escapeHtml(l.qty)} &times; ${escapeHtml(money(l.rate))}${l.sub ? ` · ${escapeHtml(l.sub)}` : ''}</div>
            </td>
            <td style="padding:6px 0;color:#14081F;font-size:13px;text-align:right;white-space:nowrap;vertical-align:top">${escapeHtml(money(l.amount))}</td>
          </tr>`).join('')}
          <tr><td colspan="2" style="border-top:1px solid #E6E0F0;padding:0"></td></tr>
          ${htmlTotal('Sub total', money(totals.subTotal))}
          ${totals.adjustment ? htmlTotal('Adjustment', money(totals.adjustment)) : ''}
          ${totals.vatRate ? htmlTotal(`VAT (${totals.vatRate}%)`, money(totals.vatAmount)) : ''}
          ${htmlTotal('Total', money(totals.total), true)}
        </table>` : ''}
      ${contract ? `
        <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#5B2BC9;margin:22px 0 6px">Client details</h3>
        <table style="border-collapse:collapse;margin-bottom:14px">${htmlRows(clientRows)}</table>
        <p style="font-size:13px;color:#4A4357">${escapeHtml(paperwork)}</p>` : ''}
      <p style="font-size:13px;color:#756E80;margin-top:22px">PurpleBox</p>
    </div>`;

    return { subject, text, html };
}

/**
 * Send it. Never throws — a task must still be created if the mail fails, and
 * the caller has already answered the request by the time this runs.
 */
/* Who is not emailed about a task.
 *
 * A rep working the inbox all day does not need a message telling them a task
 * exists; the board is already open in front of them, and the morning brief
 * lists what is overdue and what is due today. Between tasks and leads this
 * was putting dozens of messages a day into two inboxes.
 *
 * Accounts and admins still get theirs, and deliberately: those carry the
 * signed contract PDF, which is how an invoice gets raised. Silencing those
 * would not be quieter, it would be broken. */
export const NOT_EMAILED = new Set(['sales_rep']);

export async function notifyTaskAssigned({ task, assignee, assignedByName }) {
    if (!assignee?.email) return { sent: false, reason: 'assignee has no email address' };
    if (NOT_EMAILED.has(assignee.role)) return { sent: false, reason: 'sales reps are not emailed about tasks' };
    if (!mailConfigured()) return { sent: false, reason: 'email is not configured' };

    try {
        let contract = null;
        let quote = null;
        if (task.leadType === 'contract' && task.leadId) {
            contract = await Contract.findById(task.leadId)
                .populate('customer').populate('unit').populate('units').lean();
            // The quote is where the money is: the contract carries a monthly
            // rate, not the rent, the add-ons or the deposits that are actually
            // being invoiced.
            if (contract?.quote) quote = await Quote.findById(contract.quote).lean();
            if (!quote) quote = await Quote.findOne({ contract: contract?._id }).sort({ createdAt: -1 }).lean();
        }

        const attachments = [];
        let signedPdfAttached = false;

        if (contract) {
            /* Prefer the archived signed copy over a fresh render. Re-rendering
               would produce a document that looks identical but carries no
               signature, which is a worse thing to put in an inbox than
               nothing at all. */
            const signed = await Document.findOne({ contract: contract._id, type: 'contract' })
                .sort({ createdAt: -1 }).lean();

            if (signed?.driveFileId && driveConfigured()) {
                try {
                    attachments.push({
                        filename: `${contract.contractNo}-signed.pdf`,
                        content: await downloadFile({ driveFileId: signed.driveFileId }),
                        contentType: 'application/pdf',
                    });
                    signedPdfAttached = true;
                } catch { /* fall through to the rendered agreement */ }
            }

            if (!signedPdfAttached) {
                attachments.push({
                    filename: `${contract.contractNo}.pdf`,
                    content: await buildContractPdf(contract),
                    contentType: 'application/pdf',
                });
            }
        }

        const { subject, text, html } = buildTaskEmail({
            task, assignee, assignedByName, contract, quote, signedPdfAttached,
        });

        await sendMail({
            to: assignee.email,
            subject, text, html,
            attachments: attachments.length ? attachments : undefined,
            context: { kind: 'task_assigned', taskId: String(task._id) },
        });

        await Task.updateOne({ _id: task._id }, { $set: { assigneeNotifiedAt: new Date() } });
        return { sent: true, signedPdfAttached, to: assignee.email };
    } catch (e) {
        // Logged rather than thrown: the task exists and the response is gone.
        console.error(`Task assignment email failed for ${task?._id}:`, e?.message || e);
        return { sent: false, reason: e?.message || 'unknown error' };
    }
}
