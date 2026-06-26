import { Router } from 'express';
import { runBackup, listLocalBackups, listDriveBackups, backupState } from '../services/backup.js';

const router = Router();

// GET /api/backup/status — live progress state (poll this while running)
router.get('/status', (req, res) => {
  res.json({
    running:     backupState.running,
    startedAt:   backupState.startedAt,
    triggeredBy: backupState.triggeredBy,
    logs:        backupState.logs,
    lastResult:  backupState.lastResult,
    lastError:   backupState.lastError,
  });
});

// GET /api/backup/list — recent backups from Drive + local
router.get('/list', async (req, res) => {
  const [drive, local] = await Promise.all([listDriveBackups(), Promise.resolve(listLocalBackups())]);
  const driveNames = new Set(drive.map(b => b.filename));
  const localOnly  = local.filter(b => !driveNames.has(b.filename));
  const merged = [
    ...drive.map(b => ({ ...b, storage: 'drive' })),
    ...localOnly.map(b => ({ ...b, storage: 'local' })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ backups: merged });
});

// POST /api/backup/run — fire-and-forget: respond immediately, run in background
router.post('/run', (req, res) => {
  if (backupState.running) {
    return res.status(409).json({ error: 'A backup is already in progress' });
  }
  const actor = req.user?.name || req.user?.email || 'manual';
  // Kick off without awaiting — client polls /status for progress
  runBackup(actor).catch(err => console.error('[Backup] Background run error:', err.message));
  res.json({ ok: true, started: true });
});

export default router;
