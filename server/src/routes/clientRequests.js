import { Router } from 'express';
import { Customer, User } from '../models/index.js';
import { ClientRequest, CLIENT_REQUEST_STATUSES, CLIENT_REQUEST_TEAMS, CLIENT_REQUEST_TYPES, CLOSED_STATUSES, OPEN_STATUSES } from '../models/clientRequest.js';
import {
  ROW_POPULATE, addNote, assign, backfillClientRequests, canSee, claim, detailView, messageCustomer, rowView, runAction, setStatus,
  teamMembers, teamsOf, visibleFilter,
} from '../services/clientRequests.js';
import { escapeRegex } from '../services/warehouse.js';

/**
 * /api/client-requests — the staff inbox for what customers do in the app.
 * See services/clientRequests.js.
 *
 * Who sees what is by team (warehouse, sales, accounts), read from the account
 * on every request rather than the token, so a permission granted or taken
 * away bites at once — the same rule the service-request routes keep.
 */
const router = Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };

router.use(asyncRoute(async (req, res, next) => {
  if (!req.user?.id || !/^[a-f0-9]{24}$/i.test(String(req.user.id))) return res.status(401).json({ error: 'Employee authentication required.' });
  const user = await User.findById(req.user.id).select('name email role permissions isActive').lean();
  if (!user || user.isActive === false) return res.status(401).json({ error: 'Employee authentication required.' });
  if (!teamsOf(user).length) return res.status(403).json({ error: 'Client requests are not part of your role.' });
  req.staffUser = user;
  next();
}));

const page = (v, dflt, max) => Math.min(max, Math.max(1, Number.parseInt(v, 10) || dflt));

async function customerIdsMatching(q) {
  const rx = new RegExp(escapeRegex(q), 'i');
  const or = [{ fullName: rx }, { phone: rx }, { phones: rx }];
  // Phones are stored as +971…; someone types 050… or the last digits.
  // Only when it looks like a number, so "CR-0001" is not read as a phone.
  const digits = q.replace(/\D/g, '');
  if (/^[+\d\s()-]+$/.test(q) && digits.length >= 4) {
    const local = new RegExp(escapeRegex(digits.replace(/^0/, '')));
    or.push({ phone: local }, { phones: local });
  }
  return (await Customer.find({ $or: or }).select('_id').limit(500).lean()).map((c) => c._id);
}

router.get('/', asyncRoute(async (req, res) => {
  const user = req.staffUser;
  const scope = ['mine', 'team', 'all', 'done'].includes(req.query.scope) ? req.query.scope : 'team';
  const and = [visibleFilter(user)];
  if (scope === 'mine') and.push({ assignee: user._id, status: { $in: OPEN_STATUSES } });
  if (scope === 'team') and.push({ team: { $in: teamsOf(user) }, status: { $in: OPEN_STATUSES } });
  if (scope === 'done') and.push({ status: { $in: CLOSED_STATUSES } });
  if (req.query.type) { if (!CLIENT_REQUEST_TYPES.includes(req.query.type)) fail('Invalid type.'); and.push({ type: req.query.type }); }
  if (req.query.status) { if (!CLIENT_REQUEST_STATUSES.includes(req.query.status)) fail('Invalid status.'); and.push({ status: req.query.status }); }
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    and.push({ $or: [{ ref: rx }, { title: rx }, { customer: { $in: await customerIdsMatching(q) } }] });
  }
  const filter = { $and: and };
  const p = page(req.query.page, 1, 10_000);
  const limit = page(req.query.limit, 50, 200);
  const now = new Date();

  // Open: overdue first, then soonest due. Closed: most recently touched.
  const sort = scope === 'done'
    ? [{ $sort: { updatedAt: -1, _id: -1 } }]
    : [
      {
        $addFields: {
          _rank: {
            $switch: {
              branches: [
                { case: { $and: [{ $in: ['$status', ['new', 'in_progress']] }, { $lt: ['$dueAt', now] }, { $ne: ['$dueAt', null] }] }, then: 0 },
                { case: { $in: ['$status', OPEN_STATUSES] }, then: 1 },
              ],
              default: 2,
            },
          },
        },
      },
      { $addFields: { _due: { $cond: [{ $lt: ['$_rank', 2] }, '$dueAt', null] } } },
      { $sort: { _rank: 1, _due: 1, updatedAt: -1, _id: -1 } },
    ];
  const [rows, total] = await Promise.all([
    ClientRequest.aggregate([{ $match: filter }, ...sort, { $skip: (p - 1) * limit }, { $limit: limit }, { $project: { activity: 0 } }]),
    ClientRequest.countDocuments(filter),
  ]);
  await ClientRequest.populate(rows, ROW_POPULATE);
  res.json({ items: rows.map((r) => rowView(r, now)), total, page: p, limit });
}));

router.get('/counts', asyncRoute(async (req, res) => {
  const user = req.staffUser;
  const teams = { team: { $in: teamsOf(user) }, status: { $in: OPEN_STATUSES } };
  const [mine, team, overdue, byTypeRows] = await Promise.all([
    ClientRequest.countDocuments({ ...visibleFilter(user), assignee: user._id, status: { $in: OPEN_STATUSES } }),
    ClientRequest.countDocuments(teams),
    ClientRequest.countDocuments({ team: teams.team, status: { $in: ['new', 'in_progress'] }, dueAt: { $lt: new Date() } }),
    ClientRequest.aggregate([{ $match: teams }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
  ]);
  const byType = Object.fromEntries(CLIENT_REQUEST_TYPES.map((t) => [t, 0]));
  for (const row of byTypeRows) byType[row._id] = row.n;
  res.json({ mine, team, overdue, byType });
}));

router.get('/assignees', asyncRoute(async (req, res) => {
  const team = String(req.query.team || '');
  if (!CLIENT_REQUEST_TEAMS.includes(team)) fail('Choose a team: warehouse, sales or accounts.');
  if (!teamsOf(req.staffUser).includes(team)) fail('You are not on that team.', 403);
  const users = await teamMembers(team);
  res.json(users.map((u) => ({ id: String(u._id), name: u.name || u.email, role: u.role })));
}));

router.post('/backfill', asyncRoute(async (req, res) => {
  if (!['admin', 'accounts_admin'].includes(req.staffUser.role)) fail('Admin access required.', 403);
  res.json(await backfillClientRequests());
}));

async function load(req) {
  if (!/^[a-f0-9]{24}$/i.test(req.params.id)) fail('Request not found.', 404);
  const r = await ClientRequest.findById(req.params.id);
  if (!r) fail('Request not found.', 404);
  if (!canSee(req.staffUser, r)) fail('This request belongs to another team.', 403);
  return r;
}
const respond = async (req, res) => res.json(await detailView(req.params.id, req.staffUser));

router.get('/:id', asyncRoute(async (req, res) => { await load(req); await respond(req, res); }));

router.post('/:id/claim', asyncRoute(async (req, res) => { await claim(await load(req), req.staffUser); await respond(req, res); }));

router.post('/:id/assign', asyncRoute(async (req, res) => {
  await assign(await load(req), req.staffUser, req.body?.userId ?? null);
  await respond(req, res);
}));

router.post('/:id/status', asyncRoute(async (req, res) => {
  await setStatus(await load(req), req.staffUser, req.body?.status);
  await respond(req, res);
}));

router.post('/:id/note', asyncRoute(async (req, res) => {
  await addNote(await load(req), req.staffUser, req.body?.text);
  await respond(req, res);
}));

router.post('/:id/message', asyncRoute(async (req, res) => {
  const r = await load(req);
  if (!OPEN_STATUSES.includes(r.status)) fail(`This request is already ${r.status}.`, 409);
  await messageCustomer(r, req.staffUser, req.body?.text);
  await respond(req, res);
}));

router.post('/:id/action', asyncRoute(async (req, res) => {
  await runAction(await load(req), req.staffUser, req.body || {});
  await respond(req, res);
}));

router.use((error, _req, res, _next) => {
  const status = error.status || (['ValidationError', 'CastError'].includes(error.name) ? 400 : 500);
  if (status === 500) console.error('[client-requests]', error);
  res.status(status).json({ error: status === 500 ? 'Could not update the client request.' : error.message });
});

export default router;
