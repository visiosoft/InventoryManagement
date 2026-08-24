import { Router } from 'express';
import { User } from '../models/index.js';

/**
 * Each user's own walkthrough state.
 *
 * Authenticated but not admin-only: staff and sales reps are the people these
 * are for, and an admin-gated route would lock out everyone who needs guiding.
 * Every handler acts on `req.user.id` alone, so nobody can read or change
 * anyone else's.
 */
const router = Router();

const shape = (u) => ({
    enabled: u?.walkthroughs?.enabled !== false,
    completed: u?.walkthroughs?.completed || [],
});

router.get('/me', async (req, res) => {
    const user = await User.findById(req.user.id).select('walkthroughs').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(shape(user));
});

router.put('/me', async (req, res) => {
    const user = await User.findByIdAndUpdate(
        req.user.id,
        { $set: { 'walkthroughs.enabled': Boolean(req.body?.enabled) } },
        { new: true },
    ).select('walkthroughs').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(shape(user));
});

// Finished or skipped — both mean "do not start this on its own again".
// $addToSet so replaying and finishing a second time changes nothing.
router.post('/me/complete', async (req, res) => {
    const id = String(req.body?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'A walkthrough id is required' });
    const user = await User.findByIdAndUpdate(
        req.user.id,
        { $addToSet: { 'walkthroughs.completed': id } },
        { new: true },
    ).select('walkthroughs').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(shape(user));
});

// Replay from the list should not require finishing again to clear it, so the
// reverse exists too.
router.post('/me/reset', async (req, res) => {
    const id = String(req.body?.id || '').trim();
    const update = id
        ? { $pull: { 'walkthroughs.completed': id } }
        : { $set: { 'walkthroughs.completed': [] } };
    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true })
        .select('walkthroughs').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(shape(user));
});

export default router;
