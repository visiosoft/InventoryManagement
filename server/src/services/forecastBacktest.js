import mongoose from 'mongoose';
import { forecast } from '../mcp/analytics.js';

/**
 * Forecasts checked against what happened (WP-22). Once a week the 12-week
 * forecast is saved. For any week that has now arrived, the forecast made
 * about eight weeks before it is compared with the actual figure for that
 * week, and the mean absolute percentage error (MAPE) gives a confidence
 * label shown beside the forecast: high below 5%, medium 5–10%, low above.
 */

const { Schema, model } = mongoose;
const snapSchema = new Schema({
   madeAt: { type: Date, required: true, index: true },
   actualOccupied: Number, actualRevenue: Number,
   weeks: [{ weekEnding: String, occupiedUnits: Number, revenuePer4WeeksAed: Number, _id: false }],
}, { versionKey: false });
export const ForecastSnapshot = mongoose.models.ForecastSnapshot || model('ForecastSnapshot', snapSchema);

const DAY = 86_400_000;

/** MAPE in percent over pairs of { forecast, actual }, or null. Pure. */
export function mape(pairs) {
   const ok = pairs.filter((p) => p.actual > 0 && Number.isFinite(p.forecast));
   if (!ok.length) return null;
   return Math.round((ok.reduce((s, p) => s + Math.abs(p.forecast - p.actual) / p.actual, 0) / ok.length) * 1000) / 10;
}
export const confidence = (m) => (m == null ? 'not enough history' : m < 5 ? 'high' : m <= 10 ? 'medium' : 'low');

/**
 * Compare: for each snapshot's actual (taken the week it was made), find the
 * forecast for that week made 7–9 weeks earlier. Pure.
 */
export function backtest(snaps) {
   const sorted = [...snaps].sort((a, b) => new Date(a.madeAt) - new Date(b.madeAt));
   const occ = []; const rev = [];
   for (const s of sorted) {
      const day = new Date(s.madeAt).toISOString().slice(0, 10);
      const earlier = sorted.filter((e) => { const d = (new Date(s.madeAt) - new Date(e.madeAt)) / DAY; return d >= 49 && d <= 63; });
      for (const e of earlier) {
         const w = (e.weeks || []).reduce((best, x) => (!best || Math.abs(Date.parse(x.weekEnding) - Date.parse(day)) < Math.abs(Date.parse(best.weekEnding) - Date.parse(day)) ? x : best), null);
         if (!w || Math.abs(Date.parse(w.weekEnding) - Date.parse(day)) > 4 * DAY) continue;
         occ.push({ forecast: w.occupiedUnits, actual: s.actualOccupied });
         rev.push({ forecast: w.revenuePer4WeeksAed, actual: s.actualRevenue });
      }
   }
   const mo = mape(occ); const mr = mape(rev);
   return { comparisons: occ.length, occupancy: { mapePct: mo, confidence: confidence(mo) }, revenue: { mapePct: mr, confidence: confidence(mr) } };
}

/** Save this week's forecast, once a week. */
export async function snapshotForecast(now = new Date()) {
   const last = await ForecastSnapshot.findOne({}).sort({ madeAt: -1 }).select('madeAt').lean();
   if (last && now - new Date(last.madeAt) < 6.5 * DAY) return { saved: false };
   const f = await forecast({ weeks: 12 });
   await ForecastSnapshot.create({
      madeAt: now, actualOccupied: f.now.occupiedUnits, actualRevenue: f.now.revenuePer4WeeksAed,
      weeks: f.weeks.map((w) => ({ weekEnding: w.weekEnding, occupiedUnits: w.occupiedUnits.base, revenuePer4WeeksAed: w.revenuePer4WeeksAed.base })),
   });
   return { saved: true };
}

export async function forecastAccuracy() {
   const snaps = await ForecastSnapshot.find({}).sort({ madeAt: 1 }).lean();
   return { snapshots: snaps.length, firstSnapshot: snaps[0]?.madeAt || null, ...backtest(snaps), note: 'A forecast is checked eight weeks after it is made, so the first comparison appears eight weeks after the first saved forecast.' };
}
