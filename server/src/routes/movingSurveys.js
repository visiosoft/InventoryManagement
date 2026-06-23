import { Router } from 'express';
import multer from 'multer';
import { MovingSurvey, MovingJob } from '../models/index.js';
import { uploadPublicImage } from '../services/drive.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// GET /api/moving-surveys/job/:jobId - get survey for a job (or empty shell)
router.get('/job/:jobId', async (req, res) => {
  try {
    let survey = await MovingSurvey.findOne({ job: req.params.jobId });
    if (!survey) {
      survey = { job: req.params.jobId, rooms: [], notes: '', totalEstimatedVolumeCbm: 0, recommendedTruckType: '' };
    }
    res.json(survey);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/moving-surveys/job/:jobId - upsert survey
router.put('/job/:jobId', async (req, res) => {
  try {
    const survey = await MovingSurvey.findOneAndUpdate(
      { job: req.params.jobId },
      { ...req.body, job: req.params.jobId },
      { upsert: true, new: true, runValidators: true }
    );
    // Update job status to survey_done
    await MovingJob.findByIdAndUpdate(req.params.jobId, { status: 'survey_done' });
    res.json(survey);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/moving-surveys/job/:jobId/photos - upload photos
router.post('/job/:jobId/photos', upload.array('photos', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const urls = [];
    for (const file of req.files) {
      const result = await uploadPublicImage({
        buffer: file.buffer,
        mimeType: file.mimetype,
        filename: `survey-${req.params.jobId}-${Date.now()}-${file.originalname}`,
        customerName: 'MovingSurveys',
      });
      urls.push({ url: result.url, viewUrl: result.viewUrl, name: file.originalname, mimeType: file.mimetype });
    }
    res.json({ photos: urls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
