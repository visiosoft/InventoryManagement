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
import whatsappDiagnosticsRoutes from './routes/whatsappDiagnostics.js';
import whatsappMediaRoutes from './routes/whatsappMedia.js';
import quoteRoutes from './routes/quotes.js';
import invoiceRoutes from './routes/invoices.js';
import vendorRoutes from './routes/vendors.js';
import purchaseRoutes from './routes/purchases.js';
import expenseRoutes from './routes/expenses.js';
import movingInventoryRoutes from './routes/movingInventory.js';
import unitTypeRoutes, { seedUnitTypes } from './routes/unitTypes.js';
import signingRoutes from './routes/signing.js';
import stripeWebhookRoutes from './routes/stripeWebhook.js';
import userRoutes from './routes/users.js';
import whatsappRoutes from './routes/whatsapp.js';
import aiBotRoutes from './routes/aiBot.js';
import campaignRoutes from './routes/campaigns.js';
import sentEmailRoutes from './routes/sentEmails.js';
import walkthroughRoutes from './routes/walkthroughs.js';
import marketingPublicRoutes from './routes/marketingPublic.js';
import contractsPublicRoutes from './routes/contractsPublic.js';
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
import agreementTemplateRoutes from './routes/agreementTemplate.js';
import automationRuleRoutes from './routes/automationRules.js';
import taskRoutes from './routes/tasks.js';
import salesGoalRoutes from './routes/salesGoals.js';
import salesTeamRoutes from './routes/salesTeam.js';
import activityRoutes from './routes/activity.js';
import signingMovingRoutes from './routes/signingMoving.js';
import customerAuthRoutes from './routes/customerAuth.js';
import customerPortalRoutes from './routes/customerPortal.js';
import crewAuthRoutes from './routes/crewAuth.js';
import crewPortalRoutes from './routes/crewPortal.js';
import { startBackupScheduler } from './services/backup.js';
import { runWhatsAppLabelReconciliation } from './services/whatsappLeadSync.js';
import { runAiBotTick, getAiBotConfig } from './services/aiBot.js';
import { summariseRecent } from './services/conversationSummary.js';
import { runCampaignTick } from './services/campaignSender.js';
import { inspectWhatsAppToken } from './services/whatsapp.js';
import { runAutomationRules, getAutoSend } from './services/automationEngine.js';

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
      if (req.originalUrl?.includes('/api/integrations/whatsapp/webhook') || req.originalUrl?.includes('/api/stripe/webhook')) {
        req.rawBody = Buffer.from(buf);
      }
    },
  })
);
app.use('/uploads', express.static(UPLOADS_DIR));


// Public signing routes — no JWT required
app.use('/api/sign', signingRoutes);
app.use('/api/sign-moving', signingMovingRoutes);
// Stripe webhook — no JWT, verified via Stripe-Signature instead
app.use('/api/stripe/webhook', stripeWebhookRoutes);

// Public liveness probe — also proves which build is running after a deploy
const STARTED_AT = new Date().toISOString();
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    db: mongoose.connection.readyState === 1,
    startedAt: STARTED_AT,
    uptimeSec: Math.round(process.uptime()),
  });
});

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
// Before the authenticated mount below: a tenant clicking the renewal link in
// their expiry email has no account, and Express matches in order.
app.use('/api/contracts/public', contractsPublicRoutes);
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

app.use('/api/whatsapp-debug', requireAuth, whatsappDiagnosticsRoutes);
app.use('/api/whatsapp-media', requireAuth, whatsappMediaRoutes);
app.use('/api/users', requireAuth, userRoutes);
app.use('/api/backup', requireAuth, backupRoutes);
app.use('/api/whatsapp', requireAuth, whatsappRoutes);
app.use('/api/ai-bot', requireAuth, aiBotRoutes);
app.use('/api/marketing', marketingPublicRoutes);
app.use('/api/campaigns', requireAuth, campaignRoutes);
app.use('/api/sent-emails', requireAuth, sentEmailRoutes);
app.use('/api/walkthroughs', requireAuth, walkthroughRoutes);
app.use('/api/reminder-config', requireAuth, reminderConfigRoutes);
app.use('/api/message-templates', requireAuth, messageTemplateRoutes);
app.use('/api/agreement-template', requireAuth, agreementTemplateRoutes);
app.use('/api/automation-rules', requireAuth, automationRuleRoutes);
app.use('/api/tasks', requireAuth, taskRoutes);
app.use('/api/sales-goals', requireAuth, salesGoalRoutes);
app.use('/api/sales-team', requireAuth, salesTeamRoutes);
app.use('/api/activity', requireAuth, activityRoutes);

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
  // Automatic backups: frequency and hour come from the Backup page settings
  startBackupScheduler();

  // Automation rules (payment due / overdue / contract expiry) — every 6 hours.
  // Rules and templates come from Settings → Automation Rules; per-contract
  // muting and overrides from each contract's Reminders tab.
  const REMINDER_INTERVAL = 6 * 60 * 60 * 1000;
  const automationTick = async () => {
    try {
      if (!(await getAutoSend())) return; // turned on from the Automation Rules page
      await runAutomationRules();
    } catch (e) { console.error('[Automation]', e.message); }
  };
  setTimeout(async () => {
    await automationTick();
    setInterval(automationTick, REMINDER_INTERVAL);
  }, 15_000);

  // WhatsApp AI assistant. Deliberately not run inside the webhook: an OpenAI
  // round trip in front of Meta's ACK would make the webhook slow enough for
  // Meta to retry it, and the retry would send the customer a second reply.
  // The short interval also lets a burst of messages settle into one answer.
  // Say at boot whether the WhatsApp token still works. A deploy is exactly
  // when a token saved through Settings can be lost — the Settings page writes
  // it to .env, and hosts that rebuild the filesystem on deploy discard that —
  // so this is the moment the answer is most worth having in the log.
  setTimeout(async () => {
    try {
      const t = await inspectWhatsAppToken({ force: true });
      if (!t.configured) return console.warn('[WhatsApp] No access token configured — sending is off.');
      if (t.valid === false) return console.error(`[WhatsApp] Access token rejected: ${t.error}`);
      if (t.neverExpires) return console.log('[WhatsApp] Access token valid, does not expire.');
      if (t.expiresAt) {
        const hours = t.expiresInHours ?? 0;
        const line = `[WhatsApp] Access token expires ${t.expiresAt} (${hours}h).`;
        if (hours < 48) console.warn(`${line} Temporary tokens last 24 hours — use a System User token instead.`);
        else console.log(line);
      }
    } catch { /* a diagnostic must never stop the server booting */ }
  }, 5_000);

  // Marketing campaigns work through their recipients here rather than in the
  // request that starts them: several hundred sends take minutes, and the
  // batching is what keeps a campaign from spending the whole daily mail
  // allowance at once.
  setTimeout(() => setInterval(() => {
    runCampaignTick().catch((e) => console.error('[Campaign]', e.message));
  }, 15 * 1000), 25_000);

  const AI_BOT_INTERVAL = 10 * 1000;
  setTimeout(() => setInterval(() => {
    runAiBotTick().catch((e) => console.error('[AI bot]', e.message));
  }, AI_BOT_INTERVAL), 20_000);

  // Keep the inbox summaries current, so "hot leads" answers about today
  // rather than about whichever chats somebody happened to open. Only
  // conversations that moved in the last two days, capped per run, and it
  // re-reads nothing that has not changed. Reads only — nothing is sent.
  const SUMMARY_INTERVAL = 2 * 60 * 60 * 1000;
  const summaryTick = async () => {
    const cfg = await getAiBotConfig();
    if (cfg?.autoSummarise === false) return;
    await summariseRecent({});
  };
  setTimeout(() => {
    summaryTick().catch((e) => console.error('[Summaries]', e.message));
    setInterval(() => summaryTick().catch((e) => console.error('[Summaries]', e.message)), SUMMARY_INTERVAL);
  }, 45_000);
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


