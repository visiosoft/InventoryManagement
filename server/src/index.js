import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { connectDb } from './db.js';
import { requireAuth } from './middleware/auth.js';
import { UPLOADS_DIR } from './services/drive.js';
import authRoutes from './routes/auth.js';
import unitTypeRoutes from './routes/unitTypes.js';
import unitRoutes from './routes/units.js';
import customerRoutes from './routes/customers.js';
import contractRoutes from './routes/contracts.js';
import paymentRoutes from './routes/payments.js';
import documentRoutes from './routes/documents.js';
import reportRoutes from './routes/reports.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/api/health', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

app.use('/api/auth', authRoutes);
// Zoho webhook must be reachable without a JWT.
app.use('/api/contracts/zoho-webhook', (req, _res, next) => next());
app.use('/api/unit-types', requireAuth, unitTypeRoutes);
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

// Central error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5010;

async function start() {
  await connectDb();
  console.log(`Connected to MongoDB (db: ${process.env.DB_NAME})`);
  app.listen(PORT, () => console.log(`PurpleBox API listening on http://localhost:${PORT}`));
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
