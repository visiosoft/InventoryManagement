import 'dotenv/config';

/* Dubai, before anything reads a clock.
 *
 * The host decides what `toLocaleDateString` and `getHours()` mean, and a
 * production box set to UTC rendered every contract PDF, invoice and signature
 * timestamp four hours behind the office. Setting it here — ahead of any other
 * import, because Node caches the zone on first use — makes the server agree
 * with the app and with the people reading it.
 *
 * The digest and follow-up services do their own fixed UTC+4 arithmetic and
 * are unaffected. The backup scheduler's configured hour now means a Dubai
 * hour, which is what it always read as.
 */
process.env.TZ = process.env.TZ || 'Asia/Dubai';

import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execSync } from 'node:child_process';
import cors from 'cors';

import mongoose from 'mongoose';
import { connectDb } from './db.js';

import { requireAuth, readOnlyFor } from './middleware/auth.js';
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
import aiReportRoutes from './routes/aiReports.js';
import agentRoutes from './routes/agents.js';
import assistantRoutes from './routes/assistant.js';
import { runDueAgents } from './services/agents/schedule.js';
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
import pushRoutes from './routes/push.js';
import agreementTemplateRoutes from './routes/agreementTemplate.js';
import automationRuleRoutes from './routes/automationRules.js';
import taskRoutes from './routes/tasks.js';
import salesGoalRoutes from './routes/salesGoals.js';
import salesTeamRoutes from './routes/salesTeam.js';
import leaderboardRoutes from './routes/leaderboard.js';
import myDayRoutes from './routes/myDay.js';
import accountsDashboardRoutes from './routes/accountsDashboard.js';
import exportRoutes from './routes/exports.js';
import leadRoutingRoutes from './routes/leadRouting.js';
import activityRoutes from './routes/activity.js';
import signingMovingRoutes from './routes/signingMoving.js';
import customerAuthRoutes from './routes/customerAuth.js';
import customerPortalRoutes from './routes/customerPortal.js';
import crewAuthRoutes from './routes/crewAuth.js';
import crewPortalRoutes from './routes/crewPortal.js';
import whatsappFlowRoutes from './routes/whatsappFlow.js';
import { startBackupScheduler } from './services/backup.js';
import { runFollowUps, pushDueFollowUps } from './services/followUps.js';
import { sweepUnassignedLeads } from './services/leadRouting.js';
import { runWhatsAppLabelReconciliation } from './services/whatsappLeadSync.js';
import { runAiBotTick, getAiBotConfig } from './services/aiBot.js';
import { summariseRecent } from './services/conversationSummary.js';
import { ensureDigest, dayKeyFor, previousDay, localHour } from './services/dailyDigest.js';
import { runDayBriefs } from './services/dayBrief.js';
import { runLeadSla } from './services/leadSla.js';
import { releaseLapsedHolds } from './utils/unitStatus.js';
import { runCampaignTick } from './services/campaignSender.js';
import { inspectWhatsAppToken } from './services/whatsapp.js';
import { runAutomationRules, getAutoSend } from './services/automationEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// WhatsApp Flow endpoint. Mounted ahead of the global parser with a larger
// limit of its own — Meta calls it directly, so there is no JWT, and the
// encrypted payload can exceed the 2mb the rest of the app allows.
app.use('/api/whatsapp/flow', express.json({ limit: '20mb' }), whatsappFlowRoutes);

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

/* Which commit this process is running.
 *
 * The API host deploys with `git reset --hard origin/main` (server/deploy.sh),
 * so the checkout two directories up knows. Read once at boot: it cannot
 * change while the process lives, and asking git on every request would be
 * silly. The footer compares this with the commit baked into the page, which
 * is how "I pushed — is it live?" gets answered without opening two
 * dashboards. */
const VERSION = (() => {
  const run = (args) => {
    try {
      return execSync(`git ${args}`, { cwd: path.resolve(__dirname, '../..'), stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim();
    } catch { return ''; }
  };
  const sha = process.env.COMMIT_REF || process.env.GIT_SHA || run('rev-parse HEAD') || 'unknown';
  return {
    sha,
    short: sha.slice(0, 7),
    message: run(`show -s --format=%s ${sha}`),
    committedAt: run(`show -s --format=%cI ${sha}`),
    startedAt: STARTED_AT,
  };
})();
app.get('/api/version', (_req, res) => res.json(VERSION));
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
/* Accounts read tenants and contracts to invoice against them; they do not
   agree terms or correct somebody's details. See readOnlyFor. */
const accountsReadOnly = readOnlyFor('accounts');
app.use('/api/customers', requireAuth, accountsReadOnly, customerRoutes);
// Before the authenticated mount below: a tenant clicking the renewal link in
// their expiry email has no account, and Express matches in order.
app.use('/api/contracts/public', contractsPublicRoutes);
app.use(
  '/api/contracts',
  (req, res, next) => (req.path === '/zoho-webhook' ? next() : requireAuth(req, res, next)),
  // The webhook is Zoho's, not a person's, so it is past the role check above.
  (req, res, next) => (req.path === '/zoho-webhook' ? next() : accountsReadOnly(req, res, next)),
  contractRoutes
);
app.use('/api/payments', requireAuth, paymentRoutes);
app.use('/api/documents', requireAuth, documentRoutes);
app.use('/api/reports', requireAuth, reportRoutes);
// Asking for a report in plain English. Admin-only inside the router itself.
app.use('/api/ai-reports', requireAuth, aiReportRoutes);
app.use('/api/agents', requireAuth, agentRoutes);
app.use('/api/assistant', requireAuth, assistantRoutes);
// A lead is client information too, and accounts have no leads screen at all.
app.use('/api/leads', requireAuth, accountsReadOnly, leadRoutes);
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
// The Flow data endpoint is mounted above, before this, so it never gets here.
// The exception is kept anyway: if that mount is ever moved below this line,
// the flow would start returning 401 to Meta and the only visible symptom
// would be "something went wrong" on a customer's phone.
app.use('/api/whatsapp', (req, res, next) => (req.path.startsWith('/flow') ? next() : requireAuth(req, res, next)), whatsappRoutes);
app.use('/api/ai-bot', requireAuth, aiBotRoutes);
app.use('/api/marketing', marketingPublicRoutes);
app.use('/api/campaigns', requireAuth, campaignRoutes);
app.use('/api/sent-emails', requireAuth, sentEmailRoutes);
app.use('/api/walkthroughs', requireAuth, walkthroughRoutes);
app.use('/api/reminder-config', requireAuth, reminderConfigRoutes);
app.use('/api/message-templates', requireAuth, messageTemplateRoutes);
app.use('/api/push', requireAuth, pushRoutes);
app.use('/api/agreement-template', requireAuth, agreementTemplateRoutes);
app.use('/api/automation-rules', requireAuth, automationRuleRoutes);
app.use('/api/tasks', requireAuth, taskRoutes);
app.use('/api/sales-goals', requireAuth, salesGoalRoutes);
app.use('/api/sales-team', requireAuth, salesTeamRoutes);
// Signed in is enough: a board only the manager can see recognises nobody.
app.use('/api/leaderboard', requireAuth, leaderboardRoutes);
app.use('/api/my-day', requireAuth, myDayRoutes);
// The invoicing day, on one page. Admin and accounts only, inside the router.
app.use('/api/accounts-dashboard', requireAuth, accountsDashboardRoutes);
// Downloading the table you are looking at, in any format, from any page.
app.use('/api/exports', requireAuth, exportRoutes);
// Who gets the next WhatsApp lead. Admin only, inside the router.
app.use('/api/lead-routing', requireAuth, leadRoutingRoutes);
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

  // Yesterday's conversations, built once each morning. Same shape as the
  // backup scheduler: a minute tick, a fixed local hour, and a stored row that
  // makes it idempotent — a restart at 08:30 cannot produce a second digest,
  // because the day is unique and ensureDigest returns the one already there.
  /* Agents whose owner asked for them on a schedule.
   *
   * Every schedule is off until somebody switches it on, so this normally does
   * nothing at all. Idempotent through each agent's lastScheduledDay, claimed
   * before the sweep starts rather than after — a run takes minutes, and this
   * tick would otherwise start it again while it was still going.
   *
   * When the multi-tenant work lands this is the line that becomes an everyOrg
   * sweep; nothing else about an agent has to know. */
  setInterval(async () => {
    try {
      const out = await runDueAgents();
      if (out.ran.length) console.log(`[Agents] ran ${out.ran.join(', ')}`);
    } catch (e) {
      console.error('[Agents]', e.message);
    }
  }, 60_000);

  const DIGEST_HOUR = Number(process.env.DIGEST_HOUR ?? 8);
  setInterval(async () => {
    try {
      if (localHour() !== DIGEST_HOUR) return;
      await ensureDigest(previousDay(dayKeyFor()));
    } catch (e) {
      console.error('[Digest]', e.message);
    }
  }, 60_000);

  // Follow-ups that have come due, raised as tasks on the owner's board.
  // Same minute tick and fixed local hour; idempotent through each lead's
  // followUpNotifiedAt rather than a stored row, so a restart at 07:30 cannot
  // raise a second reminder for anybody.
  //
  // This creates tasks. It sends nothing — no WhatsApp, no email — and is the
  // only scheduled job touching leads.
  /* The reminder itself, at the minute somebody chose.
   *
   * A minute tick rather than the daily one: a follow-up set for 16:00 is no
   * use arriving at 07:00 the next morning. Idempotent through
   * followUpPushedAt, so the same lead is not pushed on every tick. */
  setInterval(async () => {
    try {
      const out = await pushDueFollowUps();
      if (out.pushed) console.log(`[Push] ${out.pushed} follow-up reminder(s) sent`);
    } catch (e) {
      console.error('[Push]', e.message);
    }
  }, 60_000);

  /* Everybody's morning brief: what is late, what is due, who is waiting.
     Same minute tick and fixed local hour as the digest, idempotent through
     each user's dayBriefSentAt rather than a stored row. Sends to people, not
     to customers. */
  const DAY_BRIEF_HOUR = Number(process.env.DAY_BRIEF_HOUR ?? 8);
  setInterval(async () => {
    try {
      if (localHour() !== DAY_BRIEF_HOUR) return;
      const out = await runDayBriefs();
      if (out.sent) console.log(`[DayBrief] sent ${out.sent} brief(s)`);
    } catch (e) {
      console.error('[DayBrief]', e.message);
    }
  }, 60_000);

  const FOLLOW_UP_HOUR = Number(process.env.FOLLOW_UP_HOUR ?? 7);
  setInterval(async () => {
    try {
      if (localHour() !== FOLLOW_UP_HOUR) return;
      const out = await runFollowUps();
      if (out.raised.length) console.log(`[FollowUps] raised ${out.raised.length} reminder(s) for ${out.day}`);
    } catch (e) {
      console.error('[FollowUps]', e.message);
    }
  }, 60_000);

  /* Leads the webhook could not hand out.
   *
   * The webhook assigns each chat as it arrives, so nobody has to open a page
   * for that to happen. What it cannot do is hand out a chat that came in when
   * nobody was on shift — those are left unowned on purpose rather than
   * landing on somebody asleep — or anything that arrived while distribution
   * was switched off.
   *
   * This picks those up. It does nothing unless somebody is on shift, so an
   * overnight enquiry goes out at the start of the morning. Every two minutes,
   * starting a little after boot so it is not competing with everything else
   * that runs at startup. */
  /* The clock on a lead nobody has answered: a reminder to its owner, and
     then it goes to somebody else. Every minute, because fifteen minutes late
     on a fifteen-minute promise is half a promise. Does nothing unless
     distribution is on — see services/leadSla.js. */
  setTimeout(() => setInterval(async () => {
    try {
      const out = await runLeadSla();
      if (out.nudged || out.reassigned) {
        console.log(`[LeadSLA] reminded ${out.nudged}, moved ${out.reassigned}`);
      }
    } catch (e) {
      console.error('[LeadSLA]', e.message);
    }
  }, 60_000), 60_000);

  /* Units held by a quotation that has since expired.
     A quote holds its unit until its expiry date, and nothing else sweeps
     those — without this a unit quoted in June would stay reserved for ever.
     Hourly, and it only ever releases. */
  setTimeout(() => setInterval(async () => {
    try {
      const freed = await releaseLapsedHolds();
      if (freed.length) console.log(`[Units] released ${freed.length} unit(s): ${freed.join(', ')}`);
    } catch (e) {
      console.error('[Units]', e.message);
    }
  }, 60 * 60 * 1000), 90_000);

  const SWEEP_INTERVAL = 2 * 60 * 1000;
  setTimeout(() => setInterval(async () => {
    try {
      const out = await sweepUnassignedLeads();
      if (out.assigned) console.log(`[LeadRouting] handed out ${out.assigned} lead(s) nobody owned`);
    } catch (e) {
      console.error('[LeadRouting]', e.message);
    }
  }, SWEEP_INTERVAL), 45_000);
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


