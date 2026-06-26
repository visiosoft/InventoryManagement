import { Router } from 'express';
import { runBackup, listLocalBackups, listDriveBackups } from '../services/backup.js';

const router = Router();

// GET /api/backup/list — recent backups from Drive + local
router.get('/list', async (req, res) => {
  const [drive, local] = await Promise.all([listDriveBackups(), Promise.resolve(listLocalBackups())]);

  // Merge: prefer Drive entries, supplement with local-only
  const driveNames = new Set(drive.map(b => b.filename));
  const localOnly  = local.filter(b => !driveNames.has(b.filename));
  const merged = [
    ...drive.map(b => ({ ...b, storage: 'drive' })),
    ...localOnly.map(b => ({ ...b, storage: 'local' })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ backups: merged });
});

// POST /api/backup/run — manual trigger (admin only)
router.post('/run', async (req, res) => {
  const actor = req.user?.name || req.user?.email || 'manual';
  try {
    const result = await runBackup(actor);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[Backup] Manual run failed:', err);
    res.status(500).json({ error: err.message || 'Backup failed' });
  }
});

export default router;
