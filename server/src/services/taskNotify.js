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

import { Contract, Document, Task } from '../models/index.js';
import { mailConfigured, sendMail } from './mail.js';
import { buildContractPdf } from './contractDocument.js';
import { downloadFile, driveConfigured } from './drive.js';

const DATE = { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', DATE) : '—');
const money = (n) => (Number.isFinite(Number(n)) ? `AED ${Number(n).toLocaleString('en-AE')}` : '—');

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
export function buildTaskEmail({ task, assignee, assignedByName, contract, signedPdfAttached }) {
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

    const clientRows = contract ? [
        ['Contract', contract.contractNo || '—'],
        ['Customer', contract.customer?.fullName || '—'],
        ['Phone', contract.customer?.phone || '—'],
        ['Email', contract.customer?.email || '—'],
        ['Unit', unitLabel(contract)],
        ['Term', `${fmtDate(contract.startDate)} → ${fmtDate(contract.endDate)}`],
        ['Rate', money(contract.rate)],
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
        ...(contract ? ['', '--- Client details ---', textRows(clientRows), '', paperwork] : []),
        '',
        'PurpleBox',
    ].join('\n');

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
export async function notifyTaskAssigned({ task, assignee, assignedByName }) {
    if (!assignee?.email) return { sent: false, reason: 'assignee has no email address' };
    if (!mailConfigured()) return { sent: false, reason: 'email is not configured' };

    try {
        let contract = null;
        if (task.leadType === 'contract' && task.leadId) {
            contract = await Contract.findById(task.leadId)
                .populate('customer').populate('unit').populate('units').lean();
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
            task, assignee, assignedByName, contract, signedPdfAttached,
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
