import test from 'node:test';
import assert from 'node:assert/strict';
import { projectFollowUps, stepLabel } from './plan.js';

const NOW = new Date('2026-10-20T06:00:00Z'); // 10:00 Dubai
const CAD = { quiet: [1, 2, 4, 7], dormant: [30, 60, 90] };
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000);

test('a lead that went quiet yesterday is due today, then on days 3, 7 and 14', () => {
    const plan = projectFollowUps([{ leadId: 'a', name: 'Aisha K', bucket: 'quiet', touchCount: 0, anchorAt: daysAgo(1) }], { now: NOW, cadence: CAD, days: 14 });
    const on = plan.filter((d) => d.count).map((d) => [d.date, d.items[0].label]);
    assert.deepEqual(on, [
        ['2026-10-20', 'Day 1 · still looking?'],
        ['2026-10-22', 'Day 3 · visit the facility'],
        ['2026-10-26', 'Day 7 · the offer'],
        ['2026-11-02', 'Day 14 · close or later?'],
    ]);
});

test('overdue touches land on today and are flagged; a date a person set wins', () => {
    const plan = projectFollowUps([
        { leadId: 'a', name: 'Late', bucket: 'quiet', touchCount: 1, anchorAt: daysAgo(10) },
        { leadId: 'b', name: 'Next week', bucket: 'quiet', touchCount: 0, anchorAt: daysAgo(5), followUpAt: new Date(NOW.getTime() + 3 * 86400000) },
    ], { now: NOW, cadence: CAD, days: 7 });
    assert.equal(plan[0].items[0].name, 'Late');
    assert.equal(plan[0].items[0].overdue, true);
    assert.equal(plan[3].items[0].name, 'Next week');
});

test('a spent schedule plans nothing; the cap is reported', () => {
    const spent = projectFollowUps([{ leadId: 'a', bucket: 'quiet', touchCount: 4, anchorAt: daysAgo(1) }], { now: NOW, cadence: CAD });
    assert.equal(spent.reduce((n, d) => n + d.count, 0), 0);
    const many = Array.from({ length: 5 }, (_, i) => ({ leadId: String(i), bucket: 'quiet', touchCount: 0, anchorAt: daysAgo(2) }));
    assert.equal(projectFollowUps(many, { now: NOW, cadence: CAD, dailyCap: 3 })[0].overCap, 2);
    assert.equal(stepLabel('quiet', 1, 3), 'Follow-up 2 of 3');
});
