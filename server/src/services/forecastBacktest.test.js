import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mape, confidence, backtest } from './forecastBacktest.js';

test('MAPE and its label', () => {
   assert.equal(mape([{ forecast: 110, actual: 100 }, { forecast: 90, actual: 100 }]), 10);
   assert.equal(mape([]), null);
   assert.equal(confidence(3), 'high');
   assert.equal(confidence(7), 'medium');
   assert.equal(confidence(12), 'low');
   assert.equal(confidence(null), 'not enough history');
});

test('a forecast is compared with the actual eight weeks later', () => {
   const snaps = [
      { madeAt: '2026-08-31T06:00:00Z', actualOccupied: 140, actualRevenue: 180000, weeks: [{ weekEnding: '2026-10-26', occupiedUnits: 160, revenuePer4WeeksAed: 190000 }] },
      { madeAt: '2026-10-26T06:00:00Z', actualOccupied: 156, actualRevenue: 193000, weeks: [] },
   ];
   const b = backtest(snaps);
   assert.equal(b.comparisons, 1);
   assert.equal(b.occupancy.mapePct, 2.6);
   assert.equal(b.occupancy.confidence, 'high');
});
