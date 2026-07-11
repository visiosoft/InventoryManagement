const express = require('express');
const Lead = require('../models/Lead');
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { uploadFileToDrive } = require('../services/googleDrive');

const router = express.Router();
router.use(requireAuth);

const publicUrl = (req, filename) =>
  `${process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`}/uploads/${filename}`;

// GET /api/moves  — current user's leads (newest first)
router.get('/', async (req, res) => {
  const leads = await Lead.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json(leads);
});

// POST /api/moves  — create a draft lead
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const lead = await Lead.create({
      user: req.user._id,
      phone: req.user.phone || '',
      name: req.user.name || '',
      date: b.date ?? null,
      slot: b.slot ?? null,
      from: b.from ?? '',
      to: b.to ?? '',
      homeSize: b.homeSize ?? null,
      notes: b.notes ?? '',
      addons: b.addons ?? {},
      status: 'draft',
    });
    res.status(201).json(lead);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/moves/:id
router.get('/:id', async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, user: req.user._id });
  if (!lead) return res.status(404).json({ error: 'Not found' });
  res.json(lead);
});

// PATCH /api/moves/:id — update fields while building the request
router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['date', 'slot', 'from', 'to', 'homeSize', 'notes', 'addons'];
    const patch = {};
    allowed.forEach((k) => { if (k in req.body) patch[k] = req.body[k]; });
    const lead = await Lead.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: patch },
      { new: true }
    );
    if (!lead) return res.status(404).json({ error: 'Not found' });
    res.json(lead);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/moves/:id/media  (multipart: field "file")
router.post('/:id/media', upload.single('file'), async (req, res) => {
  try {
    const lead = await Lead.findOne({ _id: req.params.id, user: req.user._id });
    if (!lead) return res.status(404).json({ error: 'Not found' });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const kind = req.body.kind || (req.file.mimetype.startsWith('video') ? 'video' : 'photo');

    // Try Google Drive upload first, fall back to local
    const driveResult = await uploadFileToDrive(
      req.file.path,
      req.file.filename,
      req.file.mimetype,
      lead.reference
    );

    const url = driveResult ? driveResult.url : publicUrl(req, req.file.filename);
    const driveFileId = driveResult ? driveResult.fileId : null;

    if (driveResult && !lead.driveFolderId) {
      lead.driveFolderId = driveResult.folderId;
    }

    if (kind === 'video') {
      lead.video = { url, dur: req.body.dur || '', driveFileId };
    } else {
      lead.photos.push({ url, label: req.body.label || 'Item', driveFileId });
    }
    await lead.save();
    res.json(lead);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/moves/:id/submit — send for review
router.post('/:id/submit', async (req, res) => {
  const lead = await Lead.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { $set: { status: 'pending_review' } },
    { new: true }
  );
  if (!lead) return res.status(404).json({ error: 'Not found' });
  res.json(lead);
});

// POST /api/moves/:id/accept — customer accepts the quote
router.post('/:id/accept', async (req, res) => {
  const lead = await Lead.findOne({ _id: req.params.id, user: req.user._id });
  if (!lead) return res.status(404).json({ error: 'Not found' });
  if (lead.status !== 'quoted') return res.status(400).json({ error: 'No quote to accept' });
  lead.status = 'accepted';
  if (lead.tracking && lead.tracking.length) {
    lead.tracking[0].state = 'done';
    lead.tracking[0].sub = 'Just now';
  }
  await lead.save();
  res.json(lead);
});

module.exports = router;
