import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occupancyFrom, reconcileUnits } from './occupancy.js';

const date = new Date('2026-10-28T10:00:00Z');
const unit = (i, status = 'available', o = {}) => ({ _id: `u${i}`, unitNumber: `F1-${i}`, status, ...o });
const contract = (i, units, o = {}) => ({ _id: `c${i}`, contractNo: `PB-${i}`, status: 'active', startDate: new Date('2026-09-01'), endDate: new Date('2026-12-01'), unit: units[0], units, ...o });

test('spec fixture: 10 rentable, 6 under contract, 2 in maintenance → 60% and 20%', () => {
   const units = [...Array(10)].map((_, i) => unit(i, i < 6 ? 'occupied' : i < 8 ? 'maintenance' : 'available'));
   const contracts = [0, 1, 2, 3, 4, 5].map((i) => contract(i, [`u${i}`]));
   const o = occupancyFrom({ units, contracts, date });
   assert.equal(o.rentable, 10);
   assert.equal(o.occupied, 6);
   assert.equal(o.maintenance, 2);
   assert.equal(o.occupancyPct, 60);
   assert.equal(o.maintenancePct, 20);
});

test('a contract starting tomorrow or already ended does not count; decommissioned units leave the base', () => {
   const units = [unit(1, 'occupied'), unit(2, 'reserved'), unit(3), unit(4, 'available', { decommissioned: true })];
   const contracts = [
      contract(1, ['u1']),
      contract(2, ['u2'], { startDate: new Date('2026-10-29') }),
      contract(3, ['u3'], { endDate: new Date('2026-10-20') }),
   ];
   const o = occupancyFrom({ units, contracts, date });
   assert.equal(o.rentable, 3);
   assert.equal(o.occupied, 1);
   assert.equal(o.reserved, 1);
   assert.equal(o.occupancyPct, 33.3);
});

test('reconciliation lists status that disagrees with contracts, and contracts past their end', () => {
   const units = [unit(1, 'occupied'), unit(2, 'available'), unit(3, 'occupied')];
   const contracts = [contract(1, ['u2']), contract(2, ['u3'], { endDate: new Date('2026-10-20') })];
   const r = reconcileUnits({ units, contracts, date });
   assert.deepEqual(r.units.map((x) => x.unit).sort(), ['F1-1', 'F1-2', 'F1-3']);
   assert.deepEqual(r.contractsPastEnd.map((c) => c.contractNo), ['PB-2']);
});
