import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFunnel, median, FUNNEL_STAGES } from './leadFunnel.js';

const NOW = new Date('2026-09-10T10:00:00.000Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 864e5);

test('median: odd, even, empty', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 3); // (2+3)/2 rounded
    assert.equal(median([]), null);
});

test('a lead still at its first status counts from creation, never having changed', () => {
    const leads = [{ status: 'new', createdAt: daysAgo(5), timeline: [] }];
    const f = buildFunnel(leads, { now: NOW });
    const stage = f.stages.find((s) => s.key === 'new');
    assert.equal(stage.count, 1);
    assert.equal(stage.medianDays, 5);
});

test('a lead that has changed status counts from its last status_changed entry, not creation', () => {
    const leads = [{
        status: 'contacted',
        createdAt: daysAgo(30),
        timeline: [
            { type: 'note', at: daysAgo(20) },
            { type: 'status_changed', at: daysAgo(10) },
            { type: 'status_changed', at: daysAgo(3) }, // the most recent — this one counts
        ],
    }];
    const f = buildFunnel(leads, { now: NOW });
    const stage = f.stages.find((s) => s.key === 'contacted');
    assert.equal(stage.medianDays, 3);
});

test('lost and already_customer are counted separately, never inside a funnel stage', () => {
    const leads = [
        { status: 'lost', createdAt: daysAgo(1), timeline: [] },
        { status: 'already_customer', createdAt: daysAgo(1), timeline: [] },
        { status: 'new', createdAt: daysAgo(1), timeline: [] },
    ];
    const f = buildFunnel(leads, { now: NOW });
    assert.equal(f.lost, 1);
    assert.equal(f.alreadyCustomer, 1);
    assert.equal(f.total, 3); // total counts every lead read, including lost/already_customer
    assert.equal(f.stages.reduce((n, s) => n + s.count, 0), 1); // only the 'new' one sits in a stage bucket
});

test('atOrPastPct: a lead further along counts toward every earlier stage too', () => {
    const leads = [
        { status: 'new', createdAt: daysAgo(1), timeline: [] },
        { status: 'quotation_sent', createdAt: daysAgo(1), timeline: [] },
    ];
    const f = buildFunnel(leads, { now: NOW });
    // Both leads are at or past 'new'.
    assert.equal(f.stages.find((s) => s.key === 'new').atOrPastPct, 100);
    // Only the quotation_sent lead is at or past 'quotation_sent'.
    assert.equal(f.stages.find((s) => s.key === 'quotation_sent').atOrPastPct, 50);
    // Nobody has reached 'won'.
    assert.equal(f.stages.find((s) => s.key === 'won').atOrPastPct, 0);
});

test('an empty pipeline reports zero everywhere rather than dividing by zero', () => {
    const f = buildFunnel([], { now: NOW });
    assert.equal(f.total, 0);
    for (const s of f.stages) {
        assert.equal(s.count, 0);
        assert.equal(s.medianDays, null);
        assert.equal(s.atOrPastPct, 0);
    }
});

test('the stages are declared in the pipeline\'s actual order', () => {
    assert.deepEqual(FUNNEL_STAGES.map((s) => s.key), [
        'new', 'contact_attempted', 'contacted', 'site_visit_scheduled',
        'follow_up_scheduled', 'quotation_sent', 'won',
    ]);
});
