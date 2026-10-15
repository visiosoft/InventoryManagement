import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitOutstanding, byMonth } from './zohoBooks.js';

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
