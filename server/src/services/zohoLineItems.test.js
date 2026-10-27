import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageCatalogue, toZohoLines, unitNumberOf } from './zohoLineItems.js';

const ACC = '7900240000000000388';
const zohoItems = [
   { item_id: 'i10', name: '10 SQFT STORAGE', account_id: ACC, account_name: 'Sales - Storage Rental Revenue', status: 'active' },
   { item_id: 'i10f2', name: '10 SQFT STORAGE F2', account_id: ACC, account_name: 'Sales - Storage Rental Revenue', status: 'active' },
   { item_id: 'i50', name: '50 SQFT STORAGE', account_id: ACC, account_name: 'Sales - Storage Rental Revenue', status: 'active' },
   { item_id: 'i75', name: '75  SQFT STORAGE', account_id: ACC, account_name: 'Sales - Storage Rental Revenue', status: 'active' },
   { item_id: 'i85', name: '85 SQFT storage second floor.', account_id: ACC, account_name: 'Sales - Storage Rental Revenue', status: 'active' },
   { item_id: 'pad', name: 'Padlock', account_id: ACC, account_name: 'Sales - Storage Rental Revenue', status: 'active' },
];

test('Zoho\'s storage items by size: the plain "N SQFT STORAGE" ones, spacing and case ignored', () => {
   const c = storageCatalogue(zohoItems);
   assert.deepEqual([...c.bySize.keys()].sort((a, b) => a - b), [10, 50, 75]);
   assert.equal(c.bySize.get(10).item_id, 'i10', 'not the F2 variant');
   assert.equal(c.accountId, ACC);
});

test('storage rent goes to the item for its size; a size with no item, to the storage account; the rest unchanged', () => {
   const catalogue = storageCatalogue(zohoItems);
   const unitSizes = new Map([['F1-12', 50], ['F2-3', 85], ['F1-9', 75]]);
   const lines = toZohoLines([
      { itemDetails: 'Storage Rent 01 Nov 2026 – 28 Nov 2026 · Unit F1-12', quantity: 1, rate: 1080, amount: 1080 },
      { itemDetails: 'Storage Rent 01 Nov 2026 – 28 Nov 2026 · F2-3', quantity: 1, rate: 1283.3, amount: 1283.3 },
      { itemDetails: 'Advance Rent 01 Dec – 28 Dec · Unit F1-9', quantity: 4, rate: 360, amount: 1440 },
      { itemDetails: 'Storage Unit F9-9 (10 sqft, Floor F1)', quantity: 1, rate: 250, amount: 250 },
      { itemDetails: 'Padlock', quantity: 1, rate: 40, amount: 40 },
      { itemDetails: 'Security Deposit · Unit F1-12', quantity: 1, rate: 500, amount: 500 },
   ], { unitSizes, catalogue });
   assert.equal(lines[0].name, '50 SQFT STORAGE', 'named as the Zoho item');
   assert.equal(lines[0].account_id, ACC);
   assert.equal(lines[0].item_id, undefined, 'not linked: the item\'s own VAT would double the VAT line');
   assert.match(lines[0].description, /01 Nov 2026 – 28 Nov 2026 · Unit F1-12/);
   assert.match(lines[1].name, /^Storage Rent/);
   assert.equal(lines[1].account_id, ACC, '85 sq ft has no plain item: still storage revenue');
   assert.equal(lines[2].name, '75 SQFT STORAGE', 'advance rent is storage rent too; double space tidied');
   assert.equal(lines[3].name, '10 SQFT STORAGE', 'size read from the text when it is there');
   assert.deepEqual(lines[4], { name: 'Padlock', description: 'Padlock', quantity: 1, rate: 40 });
   assert.equal(lines[5].item_id, undefined);
   assert.equal(lines[5].account_id, undefined, 'deposits are not mapped yet');
   assert.equal(unitNumberOf('Storage Rent 1 Nov – 28 Nov · Unit F1-12'), 'F1-12');
});
