import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitOutstanding, byMonth, salesSummary } from './zohoBooks.js';

test('outstanding splits into current and overdue on the due date', () => {
    const r = splitOutstanding([
        { balance: 100, due_date: '2026-10-01' },
        { balance: 50.5, due_date: '2026-10-20' },
        { balance: 0, due_date: '2026-09-01' },
        { balance: 25 },
    ], '2026-10-15');
    assert.deepEqual(r, { total: 175.5, current: 75.5, overdue: 100, count: 3 });
});

test('amounts land in their month, other years ignored', () => {
    const m = byMonth([{ date: '2026-01-05', amount: 10 }, { date: '2026-01-31', amount: 5 }, { date: '2026-12-01', amount: 7 }, { date: '2025-12-01', amount: 99 }], 2026, (r) => r.amount);
    assert.equal(m.length, 12);
    assert.equal(m[0].value, 15);
    assert.equal(m[11].value, 7);
    assert.equal(m.reduce((s, x) => s + x.value, 0), 22);
});

test('sales card: periods, change against the period before, 31 days of bars', () => {
    const inv = [
        { date: '2026-10-25', total: 100, status: 'sent' },
        { date: '2026-10-24', total: 50, status: 'paid' },
        { date: '2026-10-20', total: 999, status: 'void' },
        { date: '2026-10-15', total: 30, status: 'paid' }, // the 7 days before the last 7
        { date: '2026-10-10', total: 75, status: 'paid' }, // in the last 31, not 14
        { date: '2026-10-18', total: 20, status: 'overdue' }, // the 7 days before the last 7
    ];
    const s = salesSummary(inv, [{ date: '2026-10-01', amount: 40 }, { date: '2026-06-01', amount: 999 }], '2026-10-25');
    const [today, d7, d31, d90] = s.periods;
    assert.equal(today.value, 100);
    assert.equal(today.change, 100); // 100 vs 50 yesterday
    assert.equal(d7.value, 150);
    assert.equal(d7.before, 50); // 15th + 18th
    assert.equal(d7.change, 200);
    assert.equal(d31.value, 275);
    assert.equal(d31.change, null); // nothing the month before
    assert.equal(d90.value, 275);
    assert.equal(s.byDay.length, 31);
    assert.equal(s.byDay[30].date, '2026-10-25');
    assert.equal(s.byDay[0].date, '2026-09-25');
    assert.equal(s.invoices90, 5);
    assert.equal(s.collected90, 40);
});
