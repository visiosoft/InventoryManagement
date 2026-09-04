import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskEmail, taskSubject, notifyTaskAssigned } from './taskNotify.js';
import { mayEmailStaff } from './staffMail.js';
import { quoteLines, quoteTotals } from './quoteLines.js';

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

/* The quoted breakdown.
 *
 * The email accounts raise the invoice from used to carry the contract's
 * monthly rate and nothing else, so a fortnight in F2-37 totalling 750.25
 * arrived as "Rate AED 650, Deposit AED 0" — no rent, no padlock, no
 * refundable deposit. These assert the money is all there, and that it is the
 * same money the printed quotation shows. */
const QUOTE_143 = {
   quoteNo: 'QT-000143',
   vatEnabled: true,
   vatRate: 5,
   deposit: 0,
   holdAdvance: true,
   units: [{ unitNumber: 'F2-37', sizeSqf: 50, floor: 'F2', rate: 650, discountPct: 0,
      startDate: new Date('2026-09-01'), endDate: new Date('2026-09-15') }],
   addOns: [{ name: 'Lock', description: 'Padlock for storage unit', quantity: 1, rate: 80, amount: 80 }],
   items: [],
};

test('the task email carries every quoted line, not just the rate', () => {
   const { text } = buildTaskEmail({
      task: { taskNo: 'T-2026-0003', title: 'Raise the invoice in Zoho Books' },
      assignee: { name: 'Antony Albert', email: 'a@x.ae' },
      assignedByName: 'Mahmoud Gohar',
      contract: { contractNo: 'PB-2026-0359', rate: 650, deposit: 0 },
      quote: QUOTE_143,
   });

   assert.match(text, /Storage Unit F2-37/);          // the rent, which was absent
   assert.match(text, /Lock/);                        // the padlock, which was absent
   assert.match(text, /Refundable Deposit · Unit F2-37/); // absent too
   assert.match(text, /AED 325/);                     // two weeks' rent
   assert.match(text, /AED 80/);                      // the padlock
   assert.match(text, /VAT \(5%\): AED 20\.25/);
   assert.match(text, /Total: AED 750\.25/);
});

test('refundable lines are marked as refundable, so they are not invoiced as income', () => {
   const { text, html } = buildTaskEmail({
      task: { title: 'Raise the invoice' },
      assignee: { email: 'a@x.ae' },
      quote: QUOTE_143,
   });
   const depositLine = text.split('\n').find((l) => l.startsWith('Refundable Deposit'));
   assert.ok(depositLine.endsWith('(refundable)'), depositLine);
   const rentLine = text.split('\n').find((l) => l.startsWith('Storage Unit'));
   assert.ok(!rentLine.includes('refundable'), rentLine);
   assert.match(html, /refundable/);
});

test('the email totals are the quotation\'s totals, line for line', () => {
   const rows = quoteLines(QUOTE_143);
   const totals = quoteTotals(QUOTE_143, rows);
   const { text } = buildTaskEmail({
      task: { title: 'Raise the invoice' }, assignee: { email: 'a@x.ae' }, quote: QUOTE_143,
   });
   for (const r of rows) assert.ok(text.includes(r.title), `missing line: ${r.title}`);
   assert.ok(text.includes(`Total: AED ${totals.total.toLocaleString('en-AE')}`));
});

test('a task with no quote still sends, without a money section', () => {
   const { text } = buildTaskEmail({
      task: { title: 'Call the tenant' }, assignee: { email: 'a@x.ae' },
   });
   assert.ok(!text.includes('What we quoted'));
   assert.match(text, /Call the tenant/);
});

test('the rate on a contract is stated as a four-week rate', () => {
   const { text } = buildTaskEmail({
      task: { title: 'x' }, assignee: { email: 'a@x.ae' },
      contract: { contractNo: 'PB-1', rate: 650, deposit: 0 },
   });
   // "Rate: AED 650" on a fortnight's booking reads as the amount due.
   assert.match(text, /Rate: AED 650\.00 per 4 weeks/);
});

test('a sales rep is not emailed about their own task', async () => {
   /* The board is already open in front of them and the morning brief lists
      what is due; between tasks and leads this was putting dozens of messages
      a day into two inboxes.

      Without a mail server configured this stops before deciding recipients,
      which is the honest thing for a unit test to assert — who receives it is
      covered by mayEmailStaff below. */
   const out = await notifyTaskAssigned({
      task: { title: 'Call the tenant' },
      assignee: { email: 'rep@purplebox.ae', role: 'sales_rep' },
      assignedByName: 'Mase',
   });
   assert.equal(out.sent, false);
});

test('accounts is the only seat emailed', () => {
   /* Their copy attaches the signed contract PDF, which is how an invoice gets
      raised — work arriving from outside a screen they were already watching.
      Everybody else finds theirs on a board that is already open. */
   assert.equal(mayEmailStaff({ email: 'accounting@purplebox.ae', role: 'accounts' }), true);
   for (const role of ['sales_rep', 'admin', 'staff']) {
      assert.equal(mayEmailStaff({ email: 'x@purplebox.ae', role }), false, `${role} must not be emailed`);
   }
   // Somebody with no address is not emailable whatever their role.
   assert.equal(mayEmailStaff({ role: 'accounts' }), false);
});
