import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { connectDb } from './db.js';
import { requireAuth } from './middleware/auth.js';
import { UPLOADS_DIR } from './services/drive.js';
import authRoutes from './routes/auth.js';
import unitRoutes from './routes/units.js';
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
import movingJobRoutes from './routes/movingJobs.js';
import movingLeadRoutes from './routes/movingLeads.js';
import movingQuoteRoutes from './routes/movingQuotes.js';
import movingInvoiceRoutes from './routes/movingInvoices.js';
import movingReportRoutes from './routes/movingReports.js';
import movingSurveyRoutes from './routes/movingSurveys.js';
import { runGoogleContactsSync } from './services/syncContacts.js';
import { runWhatsAppLabelReconciliation } from './services/whatsappLeadSync.js';

const app = express();
app.use(cors({ origin: '*' }));
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
app.use('/api/quotes', requireAuth, quoteRoutes);
app.use(
  '/api/invoices',
  (req, res, next) => req.path.startsWith('/public/') ? next() : requireAuth(req, res, next),
  invoiceRoutes
);
app.use('/api/vendors', requireAuth, vendorRoutes);
app.use('/api/purchases', requireAuth, purchaseRoutes);
app.use('/api/expenses', requireAuth, expenseRoutes);
app.use('/api/moving-inventory', requireAuth, movingInventoryRoutes);
app.use('/api/workers', requireAuth, workerRoutes);
app.use('/api/trucks', requireAuth, truckRoutes);
app.use('/api/moving-jobs', requireAuth, movingJobRoutes);
app.use('/api/moving-leads', requireAuth, movingLeadRoutes);
app.use('/api/moving-quotes', requireAuth, movingQuoteRoutes);
app.use('/api/moving-invoices', requireAuth, movingInvoiceRoutes);
app.use('/api/moving-reports', requireAuth, movingReportRoutes);
app.use('/api/moving-surveys', requireAuth, movingSurveyRoutes);
app.use('/api/unit-types', requireAuth, unitTypeRoutes);
app.use(
  '/api/integrations',
  (req, res, next) =>
    req.path.startsWith('/whatsapp/webhook') || req.path.startsWith('/google/callback') || req.path.startsWith('/contacts/connect') || req.path.startsWith('/drive/callback') || req.path.startsWith('/drive/connect')
      ? next()
      : requireAuth(req, res, next),
  integrationRoutes
);

app.use('/api/users', requireAuth, userRoutes);
app.use('/api/whatsapp', requireAuth, whatsappRoutes);

// Central error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5010;

async function start() {
  await connectDb();
  await seedUnitTypes();
  console.log(`Connected to MongoDB (db: ${process.env.DB_NAME})`);
  app.listen(PORT, () => console.log(`PurpleBox API listening on http://localhost:${PORT}`));

  // Auto-sync Google Contacts every 10 minutes
  const SYNC_INTERVAL = 10 * 60 * 1000;
  setTimeout(async () => {
    await runGoogleContactsSync();
    setInterval(runGoogleContactsSync, SYNC_INTERVAL);
  }, 5000); // 5s delay so DB is fully ready

  // Reconcile WhatsApp label-driven lead state every 15 minutes.
  const WHATSAPP_RECONCILE_INTERVAL = 15 * 60 * 1000;
  if (process.env.WHATSAPP_LABEL_SYNC_ENABLED === 'true') {
    setTimeout(async () => {
      await runWhatsAppLabelReconciliation();
      setInterval(runWhatsAppLabelReconciliation, WHATSAPP_RECONCILE_INTERVAL);
    }, 7000);
  }
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
