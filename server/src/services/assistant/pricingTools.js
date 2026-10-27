import { Contract, Lead, Unit } from '../../models/index.js';
import { computeUnitAvailability } from '../unitAvailability.js';
import { pricingReview } from '../pricingReview.js';
import { registerTool } from './tools.js';
import { holdProposal, registerRunner, markProposalTool } from './actions.js';

/**
 * Pricing: what each size is priced at against how full it is and how much
 * it is asked for — and a price change, prepared for a Confirm. Admins only;
 * nothing here changes a price by itself.
 */

registerTool({
   name: 'pricing_review',
   description: 'For each unit size and floor: units, free now, occupancy %, the list price per 4 weeks (AED), what tenants on it actually pay on average, how many leads asked for that size in the last N days (default 30), and enquiries per free unit of the size. Admins only. Use for "should we raise prices", "which sizes are running out", "where to discount". Compare with competitor prices from web_search before suggesting a change.',
   parameters: { type: 'object', properties: { days: { type: 'number', description: 'How far back to count enquiries, default 30' } } },
   async run({ days = 30 } = {}, { user, now = new Date() } = {}) {
      if (!['admin', 'accounts_admin'].includes(user?.role)) return { error: 'Pricing is for admins' };
      const n = Math.min(180, Math.max(7, Number(days) || 30));
      const [{ allUnits, bookedUnitIds }, contracts, leads] = await Promise.all([
         computeUnitAvailability({}),
         Contract.find({ status: 'active' }).select('unit leasedPrice rate').lean(),
         Lead.find({ createdAt: { $gte: new Date(now.getTime() - n * 864e5) } }).select('storageSizeValue').lean(),
      ]);
      const leasedByUnit = new Map(contracts.filter((c) => c.unit).map((c) => [String(c.unit), Number(c.leasedPrice || c.rate || 0)]));
      const rows = pricingReview({ units: allUnits, takenIds: new Set([...bookedUnitIds].map(String)), leasedByUnit, askedSizes: leads.map((l) => l.storageSizeValue) });
      return { period: `enquiries over the last ${n} days`, note: 'Prices are per 4 weeks, in AED.', sizes: rows };
   },
});

registerTool({
   name: 'propose_price_change',
   description: 'Prepare a new list price (AED per 4 weeks) for every unit of one size on one floor — after pricing_review and, ideally, competitor prices. Shows the old and new price and how many units it touches. Only prepares it — prices change when the person confirms. Existing contracts keep what they pay. Admins only.',
   parameters: {
      type: 'object',
      properties: {
         sizeSqf: { type: 'number' },
         floor: { type: 'string' },
         newPrice: { type: 'number', description: 'AED per 4 weeks' },
         reason: { type: 'string', description: 'One line: why, with the figures' },
      },
      required: ['sizeSqf', 'floor', 'newPrice'],
   },
   async run({ sizeSqf, floor, newPrice, reason }, { user } = {}) {
      if (user?.role !== 'admin') return { error: 'Only admins can change prices' };
      const price = Math.round(Number(newPrice) * 100) / 100;
      if (!(price > 0)) return { error: 'The new price must be a positive number' };
      const units = await Unit.find({ sizeSqf: Number(sizeSqf), floor: String(floor) }).select('price').lean();
      if (!units.length) return { error: `No ${sizeSqf} sq ft units on floor ${floor}` };
      const olds = [...new Set(units.map((u) => Number(u.price || 0)))].sort((a, b) => a - b);
      const change = olds[0] ? Math.round(((price - olds[0]) / olds[0]) * 1000) / 10 : null;
      if (change !== null && Math.abs(change) > 40) return { error: `That is a ${change}% change — more than 40% at once. Set it on the Units page if it is intended.` };
      return {
         ...holdProposal({
            user, kind: 'change_price',
            summary: [
               `${sizeSqf} sq ft on floor ${floor}: ${units.length} unit${units.length === 1 ? '' : 's'}`,
               `List price: AED ${olds.join(' / ')} → AED ${price} per 4 weeks${change !== null ? ` (${change > 0 ? '+' : ''}${change}%)` : ''}`,
               ...(reason ? [`Why: ${String(reason).slice(0, 200)}`] : []),
               'New quotes and bookings use it; existing contracts keep what they pay.',
            ],
            spec: { sizeSqf: Number(sizeSqf), floor: String(floor), price },
         }),
         instruction: 'Say in one line what is ready and that prices only change when they press Confirm.',
      };
   },
});
markProposalTool('propose_price_change');

registerRunner('change_price', async ({ sizeSqf, floor, price }, { authHeader }) => {
   const base = `http://127.0.0.1:${process.env.PORT || 5010}/api`;
   const r = await fetch(`${base}/units/bulk-price`, { method: 'PUT', headers: { Authorization: authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify({ floor, sizeSqf, price, override: true }) });
   const out = await r.json().catch(() => ({}));
   if (!r.ok) throw new Error(out.error || `Could not change it (${r.status})`);
   return { ok: true, message: `${sizeSqf} sq ft on floor ${floor} is now AED ${price} per 4 weeks (${out.updated} unit${out.updated === 1 ? '' : 's'} updated).` };
});
