import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { Worker } from '../models/index.js';

const router = Router();
const otpStore = new Map();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// Entries are otherwise only removed on successful verification, so codes that
// are never used would stay in memory for the life of the process.
function pruneExpiredOtps() {
  const now = Date.now();
  for (const [phone, entry] of otpStore) {
    if (now > entry.expires) otpStore.delete(phone);
  }
}

router.post('/request-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    const worker = await Worker.findOne({ phone, status: 'active' });
    if (!worker) return res.status(404).json({ error: 'No active crew member found with this phone' });
    pruneExpiredOtps();
    const code = String(Math.floor(1000 + Math.random() * 9000));
    otpStore.set(phone, { code, expires: Date.now() + 5 * 60 * 1000 });
    res.json({ message: 'OTP sent', code });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });
    const stored = otpStore.get(phone);
    if (!stored || stored.code !== code || Date.now() > stored.expires)
      return res.status(401).json({ error: 'Invalid or expired code' });
    otpStore.delete(phone);
    const worker = await Worker.findOne({ phone, status: 'active' });
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    const token = jwt.sign({ id: worker._id, type: 'crew' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, worker: { id: worker._id, name: worker.name, phone: worker.phone, role: worker.role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export function requireCrew(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    if (decoded.type !== 'crew') return res.status(403).json({ error: 'Not a crew token' });
    req.crewId = decoded.id;
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
}

router.get('/me', requireCrew, async (req, res) => {
  try {
    const worker = await Worker.findById(req.crewId).select('-__v');
    if (!worker) return res.status(404).json({ error: 'Not found' });
    res.json({ worker });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
