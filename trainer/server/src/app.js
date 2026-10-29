import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import authRoutes, { requireUser } from './routes/auth.js';
import orgRoutes from './routes/org.js';
import trainingRoutes from './routes/training.js';
import platformRoutes from './routes/platform.js';
import salesRoutes from './routes/sales.js';
import { v1, webhooks } from './routes/public.js';

/**
 * The trainer's HTTP surface, everything under /api:
 *
 *   /api/auth/*        sign up, sign in, invitations, new organisations
 *   /api/org/*         one organisation's settings, team, keys     (X-Org)
 *   /api/training/*    its imports, review, knowledge, tests        (X-Org)
 *   /api/sales/*       its playbook, scenarios, sandbox, test suite, rollout (X-Org)
 *   /api/platform/*    platform admins
 *   /api/v1/*          agents and systems elsewhere, by API key
 *   /api/webhooks/*    WhatsApp Business deliveries
 */
export function createApp() {
   const app = express();
   app.disable('x-powered-by');
   app.set('trust proxy', 1);
   const origins = String(process.env.TRAINER_WEB_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
   app.use(cors({ origin: origins.length ? origins : false }));
   // The raw body is kept for webhook signature checks.
   app.use(express.json({ limit: '25mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
   app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });

   app.get('/api/health', (_req, res) => res.json({ ok: mongoose.connection.readyState === 1, service: 'ai-trainer' }));
   app.use('/api/auth', authRoutes);
   app.use('/api/org', requireUser, orgRoutes);
   app.use('/api/training', requireUser, trainingRoutes);
   app.use('/api/sales', requireUser, salesRoutes);
   app.use('/api/platform', requireUser, platformRoutes);
   app.use('/api/v1', v1);
   app.use('/api/webhooks', webhooks);
   app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
   app.use((err, _req, res, _next) => {
      console.error('[trainer]', err.message);
      res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong' });
   });
   return app;
}
