import { Router } from 'express';
import { MovingJob, Worker } from '../models/index.js';
import { requireCrew } from './crewAuth.js';
import multer from 'multer';
import path from 'path';

const router = Router();
router.use(requireCrew);

const storage = multer.diskStorage({
  destination: 'uploads/crew-photos/',
  filename: (_req, file, cb) => cb(null, `crew-${Date.now()}-${Math.round(Math.random() * 1e4)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/today', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const jobs = await MovingJob.find({
      'crew.worker': req.crewId,
      scheduledDate: { $gte: today, $lt: tomorrow },
    }).sort({ scheduledDate: 1 }).lean();
    const allJobs = await MovingJob.find({
      'crew.worker': req.crewId,
    }).sort({ scheduledDate: 1 }).lean();
    const todayJobs = jobs.length > 0 ? jobs : allJobs.slice(0, 5);
    res.json({ jobs: todayJobs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/jobs', async (req, res) => {
  try {
    const jobs = await MovingJob.find({ 'crew.worker': req.crewId })
      .sort({ scheduledDate: -1 }).limit(50).lean();
    res.json({ jobs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/jobs/:id', async (req, res) => {
  try {
    const job = await MovingJob.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/jobs/:id/checklist', async (req, res) => {
  try {
    const { items } = req.body;
    const job = await MovingJob.findByIdAndUpdate(
      req.params.id,
      { $set: { checklist: items } },
      { new: true }
    );
    res.json({ job });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/jobs/:id/photos', upload.array('images', 10), async (req, res) => {
  try {
    const files = req.files?.map(f => ({
      url: `/uploads/crew-photos/${f.filename}`,
      area: req.body.area || 'General',
      uploadedAt: new Date(),
      uploadedBy: req.crewId,
    })) || [];
    const job = await MovingJob.findByIdAndUpdate(
      req.params.id,
      { $push: { completionPhotos: { $each: files } } },
      { new: true }
    );
    res.json({ photos: files, job });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/clock-in', async (req, res) => {
  try {
    const worker = await Worker.findById(req.crewId);
    if (!worker) return res.status(404).json({ error: 'Not found' });
    const now = new Date();
    if (!worker.timeLog) worker.timeLog = [];
    worker.timeLog.push({ type: 'clock_in', time: now });
    await worker.save().catch(() => {});
    res.json({ status: 'clocked_in', time: now });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/clock-out', async (req, res) => {
  try {
    const worker = await Worker.findById(req.crewId);
    if (!worker) return res.status(404).json({ error: 'Not found' });
    const now = new Date();
    if (!worker.timeLog) worker.timeLog = [];
    worker.timeLog.push({ type: 'clock_out', time: now });
    await worker.save().catch(() => {});
    res.json({ status: 'clocked_out', time: now });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/earnings', async (req, res) => {
  try {
    const jobs = await MovingJob.find({
      'crew.worker': req.crewId,
      status: 'completed',
    }).lean();
    let total = 0;
    jobs.forEach(j => {
      const me = j.crew?.find(c => String(c.worker) === String(req.crewId));
      if (me) total += (me.dailyRate || 0) * (me.days || 1) + (me.extraHours || 0) * (me.extraHourRate || 0);
    });
    res.json({ totalEarnings: total, jobCount: jobs.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
