import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitMovement, holdSpan } from './unitMovement.js';

const U = (id, floor) => ({ _id: id, unitNumber: id, floor });
const units = [U('F1-1', 'F1'), U('F1-2', 'F1'), U('F2-1', 'F2'), U('F2-2', 'F2'), U('F2-3', 'F2')];
const C = (o) => ({ status: 'active', createdAt: '2026-09-01T08:00:00Z', startDate: '2026-09-01T00:00:00Z', endDate: '2026-12-31T00:00:00Z', timeline: [], ...o });

test('a day rebuilt from contracts: check-out, reservation, cancellation, booking, not paid', () => {
   const contracts = [
      C({ contractNo: 'A', unit: 'F1-1' }), // occupied all day
      C({ contractNo: 'B', unit: 'F2-1', endDate: '2026-10-27T00:00:00Z' }), // checks out on the 27th
      C({ contractNo: 'R', unit: 'F2-2', status: 'pending_signature', createdAt: '2026-10-27T06:00:00Z', startDate: '2026-11-01T00:00:00Z' }), // reserved, unpaid
      C({ contractNo: 'X', unit: 'F2-3', status: 'cancelled', createdAt: '2026-10-20T06:00:00Z', startDate: '2026-11-01T00:00:00Z',
         timeline: [{ at: '2026-10-27T10:00:00Z', text: 'Contract cancelled: changed mind' }] }),
      C({ contractNo: 'S', unit: 'F1-2', status: 'active', createdAt: '2026-10-25T06:00:00Z', startDate: '2026-11-05T00:00:00Z',
         timeline: [{ at: '2026-10-27T09:00:00Z', text: 'Marked signed by Sara' }] }), // booked on the 27th, not paid
   ];
   const m = unitMovement({ units, contracts, paidContractIds: new Set(), day: '2026-10-27' });
   const t = m.rows.find((r) => r.floor === 'Total');
   assert.deepEqual(t, { floor: 'Total', morning: 1, booked: 1, checkOut: 1, reserved: 1, cancelled: 1, eod: 2, notPaid: 2 });
   assert.equal(t.eod, t.morning + t.checkOut + t.cancelled - t.reserved, 'the sheet adds up');
   assert.deepEqual(m.rows.find((r) => r.floor === 'F2'), { floor: 'F2', morning: 1, booked: 0, checkOut: 1, reserved: 1, cancelled: 1, eod: 2, notPaid: 1 });
});

test('a renewal straight after a check-out is not a check-out', () => {
   const contracts = [
      C({ contractNo: 'Old', unit: 'F1-1', status: 'ended', endDate: '2026-10-27T00:00:00Z' }),
      C({ contractNo: 'New', unit: 'F1-1', createdAt: '2026-10-20T06:00:00Z', startDate: '2026-10-28T00:00:00Z' }),
   ];
   const t = unitMovement({ units, contracts, day: '2026-10-27' }).rows.find((r) => r.floor === 'Total');
   assert.equal(t.checkOut, 0);
});

test('an imported contract holds from its check-in, not its import date', () => {
   const s = holdSpan(C({ importedAt: '2026-10-01', createdAt: '2026-10-01T00:00:00Z', startDate: '2026-06-01T00:00:00Z' }));
   assert.equal(s.from.toISOString(), '2026-06-01T00:00:00.000Z');
});

test('quotations are reservations: issued that day, converted without double counting, lapsed after two days', () => {
   const quotes = [
      { _id: 'q1', quoteNo: 'QT-1', units: [{ unit: 'F1-1' }], status: 'sent', createdAt: '2026-10-27T09:00:00Z', updatedAt: '2026-10-27T09:00:00Z', expiryDate: '2026-11-26T00:00:00Z' },
      { _id: 'q2', quoteNo: 'QT-2', units: [{ unit: 'F2-1' }], status: 'accepted', createdAt: '2026-10-27T07:00:00Z', updatedAt: '2026-10-27T07:30:00Z', expiryDate: '2026-11-26T00:00:00Z' },
      { _id: 'q3', quoteNo: 'QT-3', units: [{ unit: 'F2-2' }], status: 'sent', createdAt: '2026-10-25T05:00:00Z', updatedAt: '2026-10-25T05:00:00Z', expiryDate: '2026-11-26T00:00:00Z' },
   ];
   const contracts = [C({ contractNo: 'PB-2', quote: 'q2', unit: 'F2-1', status: 'pending_signature', createdAt: '2026-10-27T07:30:00Z', startDate: '2026-10-29T00:00:00Z' })];
   const m = unitMovement({ units, contracts, quotes, day: '2026-10-27' });
   const t = m.rows.find((r) => r.floor === 'Total');
   assert.equal(t.reserved, 2, 'QT-1 and QT-2; PB-2 came from QT-2');
   assert.equal(t.cancelled, 1, 'QT-3 lapsed after two days');
   assert.equal(t.morning, 4, 'QT-3 still held F2-2 in the morning');
   assert.equal(t.eod, t.morning + t.checkOut + t.cancelled - t.reserved);
   assert.equal(t.notPaid, 2);
});
