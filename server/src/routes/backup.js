import { Router } from 'express';
import multer from 'multer';
import {
  runBackup, listLocalBackups, listDriveBackups, backupState,
  getBackupConfig, saveBackupConfig, getBackupFile,
  runRestore, restoreState,
} from '../services/backup.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const requireAdmin = (req, res) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
};

// GET /api/backup/status — live progress for both backup and restore
router.get('/status', (req, res) => {
  res.json({
    running:     backupState.running,
    startedAt:   backupState.startedAt,
    triggeredBy: backupState.triggeredBy,
    logs:        backupState.logs,
    lastResult:  backupState.lastResult,
    lastError:   backupState.lastError,
    restore: {
      running:    restoreState.running,
      startedAt:  restoreState.startedAt,
      filename:   restoreState.filename,
      logs:       restoreState.logs,
      lastResult: restoreState.lastResult,
      lastError:  restoreState.lastError,
    },
  });
});

// GET /api/backup/list — history from Drive + local, newest first
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

// Schedule settings — read by anyone signed in, changed by admins
router.get('/config', async (req, res) => {
  try {
    res.json(await getBackupConfig());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/config', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const cfg = await saveBackupConfig(req.body || {}, req.user?.name || req.user?.email || '');
    res.json(cfg);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/backup/run — fire-and-forget: respond immediately, poll /status
router.post('/run', (req, res) => {
  if (backupState.running) {
    return res.status(409).json({ error: 'A backup is already in progress' });
  }
  const actor = req.user?.name || req.user?.email || 'manual';
  runBackup(actor).catch(err => console.error('[Backup] Background run error:', err.message));
  res.json({ ok: true, started: true });
});

// GET /api/backup/download/:filename — the raw .json.gz (local, else Drive)
router.get('/download/:filename', async (req, res) => {
  try {
    const buf = await getBackupFile(req.params.filename);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    res.send(buf);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// POST /api/backup/restore — restore a listed backup (admin). Fire-and-forget.
router.post('/restore', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const filename = String(req.body?.filename || '');
  if (!filename) return res.status(400).json({ error: 'filename is required' });
  if (backupState.running || restoreState.running) {
    return res.status(409).json({ error: 'A backup or restore is already running' });
  }
  try {
    const buffer = await getBackupFile(filename);
    const actor = req.user?.name || req.user?.email || 'admin';
    runRestore({ buffer, filename, actor }).catch(err => console.error('[Restore] Background error:', err.message));
    res.json({ ok: true, started: true });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// POST /api/backup/restore-upload — restore from an uploaded .json.gz (admin)
router.post('/restore-upload', upload.single('file'), async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!req.file?.buffer) return res.status(400).json({ error: 'No file uploaded' });
  if (backupState.running || restoreState.running) {
    return res.status(409).json({ error: 'A backup or restore is already running' });
  }
  const actor = req.user?.name || req.user?.email || 'admin';
  runRestore({ buffer: req.file.buffer, filename: req.file.originalname, actor })
    .catch(err => console.error('[Restore] Background error:', err.message));
  res.json({ ok: true, started: true });
});

export default router;
