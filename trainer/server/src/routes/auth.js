import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { User, Org, Member, Invite, Platform } from '../models.js';
import { signSession, readSession, sha256, passwordProblem } from '../security.js';

/**
 * Accounts. Anyone can sign up (unless the platform admin turns it off) and
 * gets their own organisation; someone invited joins the inviting one
 * instead. The very first account on a fresh install runs the platform.
 */

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, max: 30, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test' });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const slugify = (s) => String(s || 'org').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'org';
export async function uniqueSlug(name) {
   const base = slugify(name); let s = base; let n = 2;
   while (await Org.exists({ slug: s })) s = `${base}-${n++}`;
   return s;
}

async function memberships(userId) {
   const ms = await Member.find({ user: userId }).populate('org', 'name slug').lean();
   return ms.filter((m) => m.org).map((m) => ({ id: String(m.org._id), name: m.org.name, slug: m.org.slug, role: m.role }));
}

const view = async (u) => ({ id: String(u._id), email: u.email, name: u.name, platformAdmin: Boolean(u.platformAdmin), orgs: await memberships(u._id) });

async function acceptInvite(user, token) {
   const inv = await Invite.findOne({ tokenHash: sha256(token), acceptedAt: null, expiresAt: { $gt: new Date() } });
   if (!inv) return { error: 'This invitation has expired or was already used' };
   if (inv.email !== user.email) return { error: `This invitation is for ${inv.email}` };
   await Member.updateOne({ org: inv.org, user: user._id }, { $set: { role: inv.role } }, { upsert: true });
   inv.acceptedAt = new Date(); await inv.save();
   return { org: String(inv.org) };
}

router.post('/signup', limiter, async (req, res) => {
   const { email, password, name, orgName, invite } = req.body || {};
   const e = String(email || '').toLowerCase().trim();
   if (!EMAIL.test(e)) return res.status(400).json({ error: 'Enter a valid email' });
   const bad = passwordProblem(password);
   if (bad) return res.status(400).json({ error: bad });
   const platform = await Platform.findOne({ key: 'platform' }).lean();
   const first = !(await User.estimatedDocumentCount());
   if (!first && platform && platform.allowSignup === false && !invite) return res.status(403).json({ error: 'Sign-up is by invitation only' });
   if (await User.exists({ email: e })) return res.status(409).json({ error: 'An account with this email exists — sign in instead' });
   if (!invite && !String(orgName || '').trim()) return res.status(400).json({ error: 'Name your organisation' });
   const user = await User.create({ email: e, name: String(name || '').trim().slice(0, 80), passwordHash: await bcrypt.hash(String(password), 11), platformAdmin: first });
   if (invite) {
      const out = await acceptInvite(user, invite);
      if (out.error) { await User.deleteOne({ _id: user._id }); return res.status(400).json(out); }
   } else {
      const org = await Org.create({ name: String(orgName).trim().slice(0, 80), slug: await uniqueSlug(orgName) });
      await Member.create({ org: org._id, user: user._id, role: 'owner' });
   }
   res.status(201).json({ token: signSession(user._id), user: await view(user) });
});

router.post('/login', limiter, async (req, res) => {
   const user = await User.findOne({ email: String(req.body?.email || '').toLowerCase().trim() });
   const ok = user && await bcrypt.compare(String(req.body?.password || ''), user.passwordHash);
   if (!ok) return res.status(401).json({ error: 'Wrong email or password' });
   user.lastLoginAt = new Date(); await user.save();
   res.json({ token: signSession(user._id), user: await view(user) });
});

/** Every request after sign-in: who is this. */
export async function requireUser(req, res, next) {
   const uid = readSession(req.headers.authorization);
   const user = uid ? await User.findById(uid).lean().catch(() => null) : null;
   if (!user) return res.status(401).json({ error: 'Please sign in' });
   req.user = { ...user, id: String(user._id) };
   next();
}

router.get('/me', requireUser, async (req, res) => res.json({ user: await view(req.user) }));

router.post('/accept-invite', requireUser, async (req, res) => {
   const out = await acceptInvite(req.user, String(req.body?.token || ''));
   res.status(out.error ? 400 : 200).json(out.error ? out : { ...out, user: await view(req.user) });
});

router.get('/invite/:token', async (req, res) => {
   const inv = await Invite.findOne({ tokenHash: sha256(req.params.token), acceptedAt: null, expiresAt: { $gt: new Date() } }).populate('org', 'name').lean();
   if (!inv) return res.status(404).json({ error: 'This invitation has expired or was already used' });
   res.json({ email: inv.email, role: inv.role, org: inv.org?.name, exists: Boolean(await User.exists({ email: inv.email })) });
});

router.post('/password', requireUser, async (req, res) => {
   const user = await User.findById(req.user._id);
   if (!(await bcrypt.compare(String(req.body?.current || ''), user.passwordHash))) return res.status(400).json({ error: 'Current password is wrong' });
   const bad = passwordProblem(req.body?.next);
   if (bad) return res.status(400).json({ error: bad });
   user.passwordHash = await bcrypt.hash(String(req.body.next), 11); await user.save();
   res.json({ ok: true });
});

/** A new organisation for an existing user (a second customer, say). */
router.post('/orgs', requireUser, async (req, res) => {
   const name = String(req.body?.name || '').trim();
   if (!name) return res.status(400).json({ error: 'Name the organisation' });
   const org = await Org.create({ name: name.slice(0, 80), slug: await uniqueSlug(name), business: String(req.body?.business || '').slice(0, 300) });
   await Member.create({ org: org._id, user: req.user._id, role: 'owner' });
   res.status(201).json({ org: { id: String(org._id), name: org.name, slug: org.slug, role: 'owner' }, user: await view(req.user) });
});

export default router;
