import { registerTool } from './tools.js';

/**
 * Reading from the other systems the company is connected to — card
 * payments (Stripe), website traffic (Google Analytics) and files (Google
 * Drive). Read-only, admins only; each says plainly when its connection is
 * missing rather than answering from nothing.
 */

const ADMINS = ['admin', 'accounts_admin'];

registerTool({
   name: 'stripe_payments',
   description: 'Card payments taken through Stripe in the last N days (default 30), newest first: amount in AED, status, description, payer email and the invoice or quote reference. Admins only, read-only. Use for "card payments this week", "did Sara pay by card", "how much came in online".',
   parameters: { type: 'object', properties: { days: { type: 'number' } } },
   async run({ days = 30 } = {}, { user } = {}) {
      if (!ADMINS.includes(user?.role)) return { error: 'Payments are for admins' };
      const { stripeConfigured, recentStripePayments } = await import('../stripe.js');
      if (!stripeConfigured()) return { error: 'Stripe is not connected (Settings → Integrations)' };
      const rows = await recentStripePayments({ days: Number(days) || 30 });
      const ok = rows.filter((r) => r.status === 'succeeded');
      return {
         period: `last ${Number(days) || 30} days`,
         succeeded: ok.length,
         totalAed: Math.round(ok.reduce((t, r) => t + r.amountAed, 0) * 100) / 100,
         notCompleted: rows.length - ok.length,
         payments: rows.slice(0, 60),
      };
   },
});

registerTool({
   name: 'website_traffic',
   description: 'purplebox.ae visits from Google Analytics: today and yesterday, the last N days (default 30) by day and by country, and the most viewed pages. Admins only. Use for "how is the website doing", "visits this week", "which pages do people read", and for SEO work.',
   parameters: { type: 'object', properties: { days: { type: 'number' } } },
   async run({ days = 30 } = {}, { user } = {}) {
      if (!ADMINS.includes(user?.role)) return { error: 'Website figures are for admins' };
      const { websiteAnalytics } = await import('../googleAnalytics.js');
      const out = await websiteAnalytics({ days: Math.min(90, Math.max(1, Number(days) || 30)) });
      if (out.configured === false) return { error: 'Google Analytics is not connected (Settings → Integrations)' };
      return out;
   },
});

registerTool({
   name: 'drive_files',
   description: 'Search the company Google Drive by file name (customer documents, contracts, receipts the CRM filed there): name, type, folder link and last change. Admins only, read-only — it lists files, it does not open them. Use for "is Sara\'s passport copy on Drive", "find the October receipts".',
   parameters: { type: 'object', properties: { name: { type: 'string', description: 'Part of the file name' } }, required: ['name'] },
   async run({ name }, { user } = {}) {
      if (!ADMINS.includes(user?.role)) return { error: 'Drive is for admins' };
      const { driveConfigured, driveClient } = await import('../drive.js');
      if (!driveConfigured()) return { error: 'Google Drive is not connected (Settings → Integrations)' };
      const q = String(name || '').replace(/['\\]/g, ' ').trim().slice(0, 80);
      if (q.length < 2) return { error: 'Give at least two letters of the name' };
      const { data } = await driveClient().files.list({ q: `name contains '${q}' and trashed = false`, fields: 'files(id,name,mimeType,modifiedTime,webViewLink)', pageSize: 25, orderBy: 'modifiedTime desc' });
      return { count: (data.files || []).length, files: (data.files || []).map((f) => ({ name: f.name, type: f.mimeType, changed: f.modifiedTime, link: f.webViewLink })) };
   },
});

registerTool({
   name: 'ai_usage',
   description: 'What the AI itself costs: calls, input and output tokens and estimated US-dollar cost over the last N days (default 7), by provider (OpenAI, Claude), by model, by feature (each bot, each agent, the Ask box, web search) and by day. Every AI call is logged from when logging started; agent replies are also counted from their own log before that. Admins only, read-only. Use for "AI usage", "which bot uses the most tokens", "why did the API credit run out", "AI cost this week".',
   parameters: { type: 'object', properties: { days: { type: 'number', description: '1–90, default 7' } } },
   async run({ days = 7 } = {}, { user, now = new Date() } = {}) {
      if (!ADMINS.includes(user?.role)) return { error: 'AI usage is for admins' };
      const { aiUsageReport } = await import('../aiUsageReport.js');
      return aiUsageReport({ days, now });
   },
});

registerTool({
   name: 'inventory_mix',
   description: 'Stock against demand by unit size: rentable, occupied (from contracts), reserved, maintenance, available, average days vacant, and leads in the last N days (default 30) asking for each size, with stock-out and oversupply flags. Read-only. Use for "which sizes are sold out", "where is demand without stock", "which sizes sit empty".',
   parameters: { type: 'object', properties: { days: { type: 'number' } } },
   async run({ days = 30 } = {}) {
      const { inventoryMix } = await import('../inventoryMix.js');
      return inventoryMix({ days });
   },
});

registerTool({
   name: 'churn_risk',
   description: 'Active contracts at risk of leaving (score 60+ by fixed rules: not renewing, undecided and ending within a week, late payments, new tenant, repeated extensions), with reasons and the rent at risk. Admins and sales, read-only. Use for "who might leave", "retention list", "at-risk tenants".',
   parameters: { type: 'object', properties: {} },
   async run(_a, { user } = {}) {
      if (![...ADMINS, 'sales_rep'].includes(user?.role)) return { error: 'Not available for your role' };
      const { churnRisk } = await import('../churnRisk.js');
      return churnRisk({});
   },
});

registerTool({
   name: 'lead_attribution',
   description: 'Leads, wins and win rate by where each lead first came from — website UTM campaign, Meta lead-ad campaign, or the click-to-WhatsApp ad — over the last N days (default 30). Read-only. Use for "which campaign brings customers", "leads by campaign", "which ad works". Older leads show "(not recorded)".',
   parameters: { type: 'object', properties: { days: { type: 'number' } } },
   async run({ days = 30 } = {}) {
      const { attributionReport } = await import('../attribution.js');
      return attributionReport({ days });
   },
});
