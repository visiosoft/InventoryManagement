import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDashboardLayout } from './dashboardLayout.js';

test('a dashboard layout keeps only card ids and tab names', () => {
    assert.deepEqual(
        cleanDashboardLayout({ order: ['stats', 'zoho-sales', 'stats', 42, '<b>'], hidden: ['team-tasks'], tabs: { 'zoho-sales': 'finance', bad: 7, 'x y': 'sales' }, sizes: { 'zoho-sales': 'half', stats: 'huge', 'lead-funnel': 'full' }, extra: 'dropped' }),
        { order: ['stats', 'zoho-sales'], hidden: ['team-tasks'], tabs: { 'zoho-sales': 'finance' }, sizes: { 'zoho-sales': 'half', 'lead-funnel': 'full' } },
    );
    assert.equal(cleanDashboardLayout({}), null, 'nothing to keep: back to the default');
    assert.deepEqual(cleanDashboardLayout({ sizes: { 'team-tasks': 'full' } }), { order: [], hidden: [], tabs: {}, sizes: { 'team-tasks': 'full' } });
    assert.equal(cleanDashboardLayout('nope'), null);
});
