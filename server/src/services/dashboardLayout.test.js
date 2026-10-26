import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDashboardLayout } from './dashboardLayout.js';

test('a dashboard layout keeps only card ids and tab names', () => {
    assert.deepEqual(
        cleanDashboardLayout({ order: ['stats', 'zoho-sales', 'stats', 42, '<b>'], hidden: ['team-tasks'], tabs: { 'zoho-sales': 'finance', bad: 7, 'x y': 'sales' }, extra: 'dropped' }),
        { order: ['stats', 'zoho-sales'], hidden: ['team-tasks'], tabs: { 'zoho-sales': 'finance' } },
    );
    assert.equal(cleanDashboardLayout({}), null, 'nothing to keep: back to the default');
    assert.equal(cleanDashboardLayout('nope'), null);
});
