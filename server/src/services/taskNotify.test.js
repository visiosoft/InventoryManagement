import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskEmail, taskSubject } from './taskNotify.js';

/* The subject that prompted this: the whole title went into it, filling a
   phone screen and saying nothing at a glance. */
const RAMBLING = 'Hi Mr. Anthony, we need to generate an invoice for Miss Laila under this '
    + 'agreement name. She will be leaving her credit card details on file with us. I have '
    + 'attached her WhatsApp message below in case you need to contact her directly regarding '
    + 'the bank and credit card information.';

test('a subject stays short even when the title is a paragraph', () => {
    const subject = taskSubject({
        task: { taskNo: 'T-2026-0042', title: RAMBLING },
        contract: { contractNo: 'PB-2026-0357' },
    });
    assert.ok(subject.length <= 60, `too long (${subject.length}): ${subject}`);
    assert.match(subject, /^T-2026-0042 · /, 'leads with the reference');
    assert.ok(subject.endsWith('…'), 'shows it was trimmed');
    assert.ok(!subject.includes('credit card'), 'the body carries the detail, not the subject');
});

test('a short title is left alone', () => {
    assert.equal(
        taskSubject({ task: { taskNo: 'T-2026-0042', title: 'Raise the invoice in Zoho Books' } }),
        'T-2026-0042 · Raise the invoice in Zoho Books',
    );
});

test('trimming happens at a word, and no stray punctuation is left hanging', () => {
    const subject = taskSubject({
        task: { taskNo: 'T-1', title: 'Collect the deposit, then confirm the billing cycle with the tenant' },
    });
    assert.ok(!/[ ,;:.\-—]…$/.test(subject), `ragged ending: ${subject}`);
    assert.ok(!subject.includes('confir…'), 'did not cut mid-word');
});

test('only the first line reaches the subject', () => {
    const subject = taskSubject({ task: { taskNo: 'T-1', title: 'Invoice request\nDeposit is AED 1600' } });
    assert.equal(subject, 'T-1 · Invoice request');
});

test('an older task with no reference falls back to the contract', () => {
    assert.equal(
        taskSubject({ task: { title: 'Invoice request' }, contract: { contractNo: 'PB-2026-0357' } }),
        'PB-2026-0357 · Invoice request',
    );
});

test('a task with neither a reference nor a contract still has a subject', () => {
    assert.equal(taskSubject({ task: { title: '' } }), 'Task assigned');
});

const ASSIGNEE = { name: 'Accounts', email: 'accounts@purplebox.ae' };

const TASK = {
    _id: 't1',
    title: 'Raise the first invoice',
    description: 'Four weeks in advance, plus the deposit.',
    dueDate: new Date('2026-09-04T00:00:00+04:00'),
    priority: 'high',
    leadName: 'Emad',
};

const CONTRACT = {
    contractNo: 'PB-2026-F2-34',
    customer: { fullName: 'Emad Rahman', phone: '+971 50 123 4567', email: 'emad@example.com' },
    units: [{ unitNumber: 'F2-34' }, { unitNumber: 'F2-35' }],
    startDate: new Date('2026-08-28T00:00:00+04:00'),
    endDate: new Date('2026-09-24T00:00:00+04:00'),
    rate: 1828,
    deposit: 500,
    paymentMethod: 'Bank transfer',
    status: 'active',
    signedDocUrl: 'https://drive.google.com/file/d/abc/view',
};

test('the client details ride along with the task', () => {
    const { subject, text } = buildTaskEmail({
        task: TASK, assignee: ASSIGNEE, assignedByName: 'Mase', contract: CONTRACT, signedPdfAttached: true,
    });

    assert.match(subject, /Raise the first invoice/);
    assert.match(subject, /PB-2026-F2-34/, 'the contract is named in the subject');

    for (const detail of ['Emad Rahman', '+971 50 123 4567', 'emad@example.com', 'Bank transfer']) {
        assert.ok(text.includes(detail), `missing ${detail}`);
    }
    assert.match(text, /Mase/, 'says who assigned it');
    assert.match(text, /AED 1,828/, 'rate is formatted as money');
    assert.match(text, /AED 500/, 'deposit too');
});

test('both units are listed, not just the first', () => {
    const { text } = buildTaskEmail({ task: TASK, assignee: ASSIGNEE, contract: CONTRACT, signedPdfAttached: true });
    assert.match(text, /F2-34, F2-35/);
});

test('a single-unit contract still names its unit', () => {
    const { text } = buildTaskEmail({
        task: TASK, assignee: ASSIGNEE,
        contract: { ...CONTRACT, units: [], unit: { unitNumber: 'A1-07' } },
        signedPdfAttached: true,
    });
    assert.match(text, /Unit: A1-07/);
});

test('the email says which document is attached', () => {
    const signed = buildTaskEmail({ task: TASK, assignee: ASSIGNEE, contract: CONTRACT, signedPdfAttached: true });
    assert.match(signed.text, /signed contract is attached/i);

    // Signed, but the copy could not be fetched: point at it rather than
    // quietly attaching an unsigned one that looks the same.
    const unfetched = buildTaskEmail({ task: TASK, assignee: ASSIGNEE, contract: CONTRACT, signedPdfAttached: false });
    assert.match(unfetched.text, /could not be attached/i);
    assert.match(unfetched.text, /drive\.google\.com/);

    // Never signed at all: say so.
    const unsigned = buildTaskEmail({
        task: TASK, assignee: ASSIGNEE,
        contract: { ...CONTRACT, signedDocUrl: '' }, signedPdfAttached: false,
    });
    assert.match(unsigned.text, /has not been signed yet/i);
});

test('a task with no contract is still a proper email', () => {
    const { subject, text, html } = buildTaskEmail({
        task: { ...TASK, taskNo: 'T-2026-0007', leadName: 'Emad' },
        assignee: ASSIGNEE, assignedByName: 'Mase', contract: null,
    });
    // The reference names it; the lead belongs in the body, not the subject.
    assert.equal(subject, 'T-2026-0007 · Raise the first invoice');
    assert.ok(!text.includes('Client details'), 'no empty paperwork section');
    assert.ok(!html.includes('Client details'));
    assert.match(text, /Raise the first invoice/);
});

test('a task with no due date says so rather than printing nothing', () => {
    const { text } = buildTaskEmail({ task: { ...TASK, dueDate: null }, assignee: ASSIGNEE });
    assert.match(text, /Due: No date set/);
});

test('customer text cannot inject markup into the html', () => {
    const { html } = buildTaskEmail({
        task: TASK, assignee: ASSIGNEE,
        contract: { ...CONTRACT, customer: { fullName: '<script>alert(1)</script>', phone: '', email: '' } },
        signedPdfAttached: true,
    });
    assert.ok(!html.includes('<script>'), 'the tag is escaped');
    assert.match(html, /&lt;script&gt;/);
});

test('missing pieces degrade to a dash, not to "undefined"', () => {
    const { text } = buildTaskEmail({
        task: { title: 'Chase the paperwork', _id: 'x' }, assignee: ASSIGNEE,
        contract: { contractNo: 'PB-1', customer: {}, units: [] }, signedPdfAttached: false,
    });
    assert.ok(!/undefined|NaN|null/.test(text), `leaked a placeholder:\n${text}`);
    assert.match(text, /Customer: —/);
});
