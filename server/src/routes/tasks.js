import { Router } from 'express';
import { Task, User } from '../models/index.js';

const router = Router();

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
  if (isSalesRep(req)) filter.assignedTo = req.user.id;
  if (req.query.leadId) filter.leadId = String(req.query.leadId);
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

  const assignedTo = isSalesRep(req) ? req.user.id : (req.body?.assignedTo || req.user.id);
  const assignee = await User.findById(assignedTo).select('_id');
  if (!assignee) return res.status(400).json({ error: 'Assignee not found' });

  const priority = ALLOWED_PRIORITY.has(req.body?.priority) ? req.body.priority : 'medium';
  const status = ALLOWED_STATUS.has(req.body?.status) ? req.body.status : 'todo';

  const task = await Task.create({
    title,
    description: String(req.body?.description || '').trim(),
    assignedTo,
    createdBy: req.user.id,
    createdByName: req.user.name || req.user.email || 'user',
    leadId: req.body?.leadId || null,
    leadType: req.body?.leadType || null,
    leadName: String(req.body?.leadName || '').trim(),
    dueDate: req.body?.dueDate ? new Date(req.body.dueDate) : null,
    priority,
    status,
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

  await task.save();
  res.json(await task.populate('assignedTo', 'name email'));
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
