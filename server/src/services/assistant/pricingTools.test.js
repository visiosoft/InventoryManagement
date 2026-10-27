import { test } from 'node:test';
import assert from 'node:assert/strict';
import './pricingTools.js';
import { toolByName } from './tools.js';
import { ACTION_TOOLS, PROPOSAL_TOOLS } from './actions.js';

test('pricing is for admins, and a price change is only ever prepared for a Confirm', async () => {
   assert.match((await toolByName('pricing_review').run({}, { user: { role: 'sales_rep' } })).error, /for admins/);
   assert.match((await toolByName('propose_price_change').run({ sizeSqf: 50, floor: 'F1', newPrice: 1100 }, { user: { role: 'accounts_admin' } })).error, /Only admins/);
   assert.match((await toolByName('propose_price_change').run({ sizeSqf: 50, floor: 'F1', newPrice: -5 }, { user: { role: 'admin' } })).error, /positive/);
   assert.ok(PROPOSAL_TOOLS.includes('propose_price_change'));
   assert.ok(ACTION_TOOLS.includes('propose_price_change'), 'hidden from anyone who may not act');
});
