import { Router } from 'express';
import multer from 'multer';
import { Task, User } from '../models/index.js';
import { uploadFile } from '../services/drive.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Tasks is a sales-rep/admin tool — staff don't get it.
router.use((req, res, next) => {
  if (req.user?.role === 'staff') return res.status(403).json({ error: 'Not allowed' });
  next();
});

const ALLOWED_PRIORITY = new Set(['low', 'medium', 'high']);
const ALLOWED_STATUS = new Set(['todo', 'in_progress', 'done']);

function isSalesRep(req) {
  return req.user?.role === 'sales_rep';
}
function isPrivileged(req) {
  return req.user?.role === 'admin' || req.user?.role === 'staff';
}
function canEdit(req, task) {
  if (isPrivileged(req)) return true;
  return String(task.assignedTo) === String(req.user.id) || String(task.createdBy) === String(req.user.id);
}

router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.assignedTo) filter.assignedTo = String(req.query.assignedTo);
  // Reps see everything routed through them: tasks assigned to them, and
  // tasks they handed off to someone else (so "assign to another rep" work
  // doesn't just vanish from the assigner's own board).
  if (isSalesRep(req)) {
    delete filter.assignedTo;
    filter.$or = [{ assignedTo: req.user.id }, { createdBy: req.user.id }];
  }
  if (req.query.leadId) filter.leadId = String(req.query.leadId);
  if (req.query.leadType) filter.leadType = String(req.query.leadType);
  if (req.query.createdBy) filter.createdBy = String(req.query.createdBy);
  if (req.query.status) {
    const statuses = String(req.query.status).split(',').filter((s) => ALLOWED_STATUS.has(s));
    if (statuses.length) filter.status = { $in: statuses };
  }

  const tasks = await Task.find(filter)
    .populate('assignedTo', 'name email')
    .sort({ dueDate: 1, createdAt: -1 })
    .lean();
  res.json(tasks);
});

router.post('/', async (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const assignedTo = req.body?.assignedTo || req.user.id;
  const assignee = await User.findById(assignedTo).select('name email');
  if (!assignee) return res.status(400).json({ error: 'Assignee not found' });

  const priority = ALLOWED_PRIORITY.has(req.body?.priority) ? req.body.priority : 'medium';
  const status = ALLOWED_STATUS.has(req.body?.status) ? req.body.status : 'todo';
  const byName = req.user.name || req.user.email || 'user';

  const task = await Task.create({
    title,
    description: String(req.body?.description || '').trim(),
    assignedTo,
    createdBy: req.user.id,
    createdByName: byName,
    leadId: req.body?.leadId || null,
    leadType: req.body?.leadType || null,
    leadName: String(req.body?.leadName || '').trim(),
    dueDate: req.body?.dueDate ? new Date(req.body.dueDate) : null,
    priority,
    status,
    assignmentHistory: [{
      fromId: null, fromName: '',
      toId: assignedTo, toName: assignee.name || assignee.email,
      byId: req.user.id, byName,
      reason: String(req.body?.assignReason || '').trim() || 'Created',
    }],
  });

  res.status(201).json(await task.populate('assignedTo', 'name email'));
});

router.patch('/:id', async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!canEdit(req, task)) return res.status(403).json({ error: 'Not your task' });

  if (req.body?.title !== undefined) task.title = String(req.body.title).trim();
  if (req.body?.description !== undefined) task.description = String(req.body.description).trim();
  if (req.body?.dueDate !== undefined) task.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
  if (req.body?.priority !== undefined && ALLOWED_PRIORITY.has(req.body.priority)) task.priority = req.body.priority;
  if (req.body?.status !== undefined && ALLOWED_STATUS.has(req.body.status)) {
    task.status = req.body.status;
    task.doneAt = req.body.status === 'done' ? new Date() : null;
  }
  if (req.body?.assignedTo !== undefined && String(req.body.assignedTo) !== String(task.assignedTo)) {
    const [prevUser, nextUser] = await Promise.all([
      User.findById(task.assignedTo).select('name email'),
      User.findById(req.body.assignedTo).select('name email'),
    ]);
    if (!nextUser) return res.status(400).json({ error: 'Assignee not found' });
    const byName = req.user.name || req.user.email || 'user';
    task.assignmentHistory.push({
      fromId: task.assignedTo, fromName: prevUser?.name || prevUser?.email || '',
      toId: req.body.assignedTo, toName: nextUser.name || nextUser.email,
      byId: req.user.id, byName,
      reason: String(req.body?.reassignReason || '').trim() || 'Reassigned',
    });
    task.assignedTo = req.body.assignedTo;
  }

  await task.save();
  res.json(await task.populate('assignedTo', 'name email'));
});

router.get('/:id', async (req, res) => {
  const task = await Task.findById(req.params.id).populate('assignedTo', 'name email').populate('comments.user', 'name');
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

router.post('/:id/comments', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment text is required' });
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!canEdit(req, task)) return res.status(403).json({ error: 'Not your task' });
  task.comments.push({ user: req.user.id, userName: req.user.name || req.user.email || 'user', text });
  await task.save();
  res.status(201).json(await task.populate([{ path: 'assignedTo', select: 'name email' }, { path: 'comments.user', select: 'name' }]));
});

router.post('/:id/attachments', upload.array('files', 5), async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!canEdit(req, task)) return res.status(403).json({ error: 'Not your task' });
  if (!req.files?.length) return res.status(400).json({ error: 'No files provided' });

  for (const file of req.files) {
    const stored = await uploadFile({ buffer: file.buffer, filename: file.originalname, mimeType: file.mimetype });
    task.attachments.push({
      ...stored,
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      uploadedBy: req.user.name || req.user.email || 'user',
    });
  }
  await task.save();
  res.status(201).json(await task.populate([{ path: 'assignedTo', select: 'name email' }, { path: 'comments.user', select: 'name' }]));
});

router.delete('/:id', async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const isCreator = String(task.createdBy) === String(req.user.id);
  if (!isPrivileged(req) && !isCreator) return res.status(403).json({ error: 'Only the creator or an admin can delete this task' });
  await task.deleteOne();
  res.json({ ok: true });
});

export default router;
