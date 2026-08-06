import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import mongoose from 'mongoose';
import { connectDb } from './db.js';

import { requireAuth } from './middleware/auth.js';
import { UPLOADS_DIR } from './services/drive.js';
import authRoutes from './routes/auth.js';
import unitRoutes from './routes/units.js';
import floorPlanRoutes from './routes/floorPlans.js';
import siteRoutes from './routes/sites.js';
import customerRoutes from './routes/customers.js';
import contractRoutes from './routes/contracts.js';
import paymentRoutes from './routes/payments.js';
import documentRoutes from './routes/documents.js';
import reportRoutes from './routes/reports.js';
import leadRoutes from './routes/leads.js';
import integrationRoutes from './routes/integrations.js';
import quoteRoutes from './routes/quotes.js';
import invoiceRoutes from './routes/invoices.js';
import vendorRoutes from './routes/vendors.js';
import purchaseRoutes from './routes/purchases.js';
import expenseRoutes from './routes/expenses.js';
import movingInventoryRoutes from './routes/movingInventory.js';
import unitTypeRoutes, { seedUnitTypes } from './routes/unitTypes.js';
import signingRoutes from './routes/signing.js';
import userRoutes from './routes/users.js';
import whatsappRoutes from './routes/whatsapp.js';
import workerRoutes from './routes/workers.js';
import truckRoutes from './routes/trucks.js';
import movingJobRoutes, { publicUploadRouter as movingJobPublicUpload, publicShareRouter as movingJobPublicShare } from './routes/movingJobs.js';
import movingLeadRoutes, { publicLeadRouter as movingLeadPublic } from './routes/movingLeads.js';
import movingQuoteRoutes from './routes/movingQuotes.js';
import movingInvoiceRoutes from './routes/movingInvoices.js';
import movingReportRoutes from './routes/movingReports.js';
import movingSurveyRoutes from './routes/movingSurveys.js';
import movingClaimRoutes from './routes/movingClaims.js';
import siteVisitRoutes from './routes/siteVisits.js';
import productRoutes from './routes/products.js';
import backupRoutes from './routes/backup.js';
import reminderConfigRoutes from './routes/reminderConfig.js';
import messageTemplateRoutes from './routes/messageTemplates.js';
import automationRuleRoutes from './routes/automationRules.js';
import customerAuthRoutes from './routes/customerAuth.js';
import customerPortalRoutes from './routes/customerPortal.js';
import crewAuthRoutes from './routes/crewAuth.js';
import crewPortalRoutes from './routes/crewPortal.js';
import { runBackup } from './services/backup.js';
import { runWhatsAppLabelReconciliation } from './services/whatsappLeadSync.js';
import { runPaymentReminders } from './services/paymentReminders.js';

const app = express();
// In production this server sits behind an nginx layer that already injects
// Access-Control-Allow-Origin (and related headers) on every response, so Express
// must not add its own or the browser sees duplicate values ("*, *") and blocks it.
// Local dev has no such proxy, so Express handles CORS itself there.
// Set CORS_HANDLED_BY_PROXY=true in the production .env to disable Express's CORS headers.
if (process.env.CORS_HANDLED_BY_PROXY === 'true') {
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
} else {
  app.use(cors({ origin: '*' }));
}

app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      if (req.originalUrl?.includes('/api/integrations/whatsapp/webhook')) {
        req.rawBody = Buffer.from(buf);
      }
    },
  })
);
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/api/health', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

// Public signing routes — no JWT required
app.use('/api/sign', signingRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/customer-auth', customerAuthRoutes);
app.use('/api/customer-portal', customerPortalRoutes);
app.use('/api/crew-auth', crewAuthRoutes);
app.use('/api/crew-portal', crewPortalRoutes);
app.use('/api/moving-jobs/public-upload', movingJobPublicUpload);
app.use('/api/moving-jobs/share', movingJobPublicShare);
app.use('/api/moving-leads/public', movingLeadPublic);
// Zoho webhook must be reachable without a JWT.
app.use('/api/contracts/zoho-webhook', (req, _res, next) => next());
// WhatsApp webhook verification and events must be reachable without a JWT.
app.use('/api/integrations/whatsapp/webhook', (req, _res, next) => next());
app.use('/api/units', requireAuth, unitRoutes);
app.use('/api/customers', requireAuth, customerRoutes);
app.use(
  '/api/contracts',
  (req, res, next) => (req.path === '/zoho-webhook' ? next() : requireAuth(req, res, next)),
  contractRoutes
);
app.use('/api/payments', requireAuth, paymentRoutes);
app.use('/api/documents', requireAuth, documentRoutes);
app.use('/api/reports', requireAuth, reportRoutes);
app.use('/api/leads', requireAuth, leadRoutes);
app.use(
  '/api/quotes',
  (req, res, next) => req.path.startsWith('/public/') ? next() : requireAuth(req, res, next),
  quoteRoutes
);
app.use(
  '/api/invoices',
  (req, res, next) => req.path.startsWith('/public/') ? next() : requireAuth(req, res, next),
  invoiceRoutes
);
app.use('/api/vendors', vendorRoutes);
app.use('/api/purchases', requireAuth, purchaseRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/moving-inventory', requireAuth, movingInventoryRoutes);
app.use('/api/workers', requireAuth, workerRoutes);
app.use('/api/trucks', requireAuth, truckRoutes);
app.use('/api/moving-jobs', requireAuth, movingJobRoutes);
app.use('/api/moving-leads', requireAuth, movingLeadRoutes);
app.use(
  '/api/moving-quotes',
  (req, res, next) => (req.path.endsWith('/pdf') && req.query.token) ? next() : requireAuth(req, res, next),
  movingQuoteRoutes
);
app.use(
  '/api/moving-invoices',
  (req, res, next) => (req.path.startsWith('/pay/') || (req.path.endsWith('/pdf') && req.query.token)) ? next() : requireAuth(req, res, next),
  movingInvoiceRoutes
);
app.use('/api/moving-reports', requireAuth, movingReportRoutes);
app.use('/api/moving-surveys', requireAuth, movingSurveyRoutes);
app.use('/api/moving-claims', requireAuth, movingClaimRoutes);
app.use('/api/site-visits',
  (req, res, next) => req.path.startsWith('/drive-stream/') ? next() : requireAuth(req, res, next),
  siteVisitRoutes,
);
app.use('/api/products', requireAuth, productRoutes);
app.use('/api/unit-types', requireAuth, unitTypeRoutes);
app.use('/api/floor-plan', requireAuth, floorPlanRoutes);
app.use('/api/sites', requireAuth, siteRoutes);
app.use(
  '/api/integrations',
  (req, res, next) =>
    req.path.startsWith('/whatsapp/webhook') || req.path.startsWith('/drive/callback') || req.path.startsWith('/drive/connect') || req.path.startsWith('/gmail/callback')
      ? next()
      : requireAuth(req, res, next),
  integrationRoutes
);

app.use('/api/users', requireAuth, userRoutes);
app.use('/api/backup', requireAuth, backupRoutes);
app.use('/api/whatsapp', requireAuth, whatsappRoutes);
app.use('/api/reminder-config', requireAuth, reminderConfigRoutes);
app.use('/api/message-templates', requireAuth, messageTemplateRoutes);
app.use('/api/automation-rules', requireAuth, automationRuleRoutes);

// Central error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5010;

function isTransientMongoNetworkError(error) {
  if (!error) return false;
  const name = String(error.name || '');
  const message = String(error.message || '');
  return name.includes('MongoNetworkError')
    || message.includes('MongoNetworkError')
    || message.includes('ECONNRESET')
    || message.includes('connection reset');
}

async function start() {
  await connectDb();
  mongoose.connection.on('error', (err) => {
    console.error('[MongoDB] connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('[MongoDB] disconnected from Atlas. The driver will keep retrying.');
  });

  const client = mongoose.connection.getClient?.();
  if (client?.on) {
    client.on('error', (err) => {
      console.error('[MongoDB] client error:', err.message);
    });
  }

  await seedUnitTypes();
  console.log(`Connected to MongoDB (db: ${process.env.DB_NAME})`);
  app.listen(PORT, () => console.log(`PurpleBox API listening on http://localhost:${PORT}`));

  // Reconcile WhatsApp label-driven lead state every 15 minutes.
  const WHATSAPP_RECONCILE_INTERVAL = 15 * 60 * 1000;
  if (process.env.WHATSAPP_LABEL_SYNC_ENABLED === 'true') {
    setTimeout(async () => {
      await runWhatsAppLabelReconciliation();
      setInterval(runWhatsAppLabelReconciliation, WHATSAPP_RECONCILE_INTERVAL);
    }, 7000);
  }

  // Daily database backup — runs every day at 02:00 server time.
  // BACKUP_HOUR env var overrides the hour (0-23, default 2).
  function scheduleDailyBackup() {
    const hour = Number(process.env.BACKUP_HOUR ?? 2);
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1); // already past today's slot → tomorrow
    const msUntil = next.getTime() - now.getTime();
    console.log(`[Backup] Next scheduled backup at ${next.toLocaleString()} (in ${Math.round(msUntil / 60000)} min)`);
    setTimeout(async () => {
      try { await runBackup('scheduler'); } catch (e) { console.error('[Backup] Scheduled backup failed:', e.message); }
      setInterval(async () => {
        try { await runBackup('scheduler'); } catch (e) { console.error('[Backup] Scheduled backup failed:', e.message); }
      }, 24 * 60 * 60 * 1000);
    }, msUntil);
  }
  scheduleDailyBackup();

  // Payment reminders — run every 6 hours
  const REMINDER_INTERVAL = 6 * 60 * 60 * 1000;
  setTimeout(async () => {
    try { await runPaymentReminders(); } catch (e) { console.error('[Reminders]', e.message); }
    setInterval(async () => {
      try { await runPaymentReminders(); } catch (e) { console.error('[Reminders]', e.message); }
    }, REMINDER_INTERVAL);
  }, 15_000);
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});


process.on('unhandledRejection', (reason) => {
  if (isTransientMongoNetworkError(reason)) {
    console.error('[Runtime] transient MongoDB network rejection:', reason?.message || reason);
    return;
  }
  console.error('[Runtime] unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  if (isTransientMongoNetworkError(err)) {
    console.error('[Runtime] transient MongoDB network exception:', err.message);
    return;
  }
  console.error('[Runtime] uncaught exception:', err);
  process.exit(1);
});


