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
