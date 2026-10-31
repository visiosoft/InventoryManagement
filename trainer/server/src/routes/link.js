import express, { Router } from 'express';
import crypto from 'node:crypto';
import * as M from '../models.js';
import { scoped } from '../repo.js';
import { encrypt, sha256, sameHash, randomToken } from '../security.js';
import { assertPublicUrl, connectorClient } from '../connector.js';
import { audit } from '../service.js';

/**
 * One-click connection for a system on the same machine (the PurpleBox CRM).
 * It hands over its connector address and token and gets back an API key, so
 * nobody copies secrets between the two.
 *
 * Only reachable on this machine: mounted outside /api (the CRM's public
 * proxy only ever forwards to /api/*), refused when a proxy forwarded it, and
 * it needs TRAINER_LINK_TOKEN, which deploy.sh writes into this server's .env.
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const KEY_LABEL = 'Connected system (one-click)';

/** Whether a request may link: local, not proxied, right token. Pure. */
export function linkAllowed({ remote, forwarded, token, expected }) {
   if (!expected || !token || forwarded || !LOOPBACK.has(String(remote))) return false;
   return sameHash(sha256(token), sha256(expected));
}

/** The organisation to link: the oldest whose name or slug matches. Pure. */
export function pickOrg(orgs, match) {
   const re = new RegExp(String(match || '').replace(/[^a-z0-9]/gi, '').split('').join('[^a-z0-9]*'), 'i');
   return [...orgs].filter((o) => re.test(o.name) || re.test(o.slug)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0] || null;
}

const router = Router();
router.post('/link', express.json({ limit: '10kb' }), async (req, res) => {
   try {
      const ok = linkAllowed({ remote: req.socket.remoteAddress, forwarded: req.headers['x-forwarded-for'], token: String(req.headers['x-link-token'] || ''), expected: process.env.TRAINER_LINK_TOKEN });
      if (!ok) return res.status(403).json({ error: 'Not allowed' });
      const { url, token, org: match = 'purplebox' } = req.body || {};
      const clean = String(url || '').trim().replace(/\/+$/, '');
      try { await assertPublicUrl(clean); } catch (e) { return res.status(400).json({ error: e.message }); }
      if (!token) return res.status(400).json({ error: 'A connector token is required' });
      const org = pickOrg(await M.Org.find({}).select('name slug createdAt').lean(), match);
      if (!org) return res.status(404).json({ error: 'Sign up in the AI Training Center first and name the organisation PurpleBox Storage' });

      await M.Org.updateOne({ _id: org._id }, { $set: { 'connector.url': clean, 'connector.enabled': true, 'connector.tokenEnc': encrypt(String(token)) } });
      const fresh = await M.Org.findById(org._id).lean();
      let check = 'saved';
      try { const h = await connectorClient(fresh)?.health(); check = h?.ok ? `connected${h.name ? ` to ${String(h.name).slice(0, 60)}` : ''}` : 'no answer'; } catch (e) { check = `could not reach it: ${e.response?.status || e.message}`; }

      // One key per link: the previous one-click key is revoked.
      const id = crypto.randomBytes(6).toString('hex');
      const secret = randomToken(24);
      await M.Org.updateOne({ _id: org._id }, { $set: { 'connector.lastCheckAt': new Date(), 'connector.lastCheck': check, 'apiKeys.$[k].revokedAt': new Date() } }, { arrayFilters: [{ 'k.label': KEY_LABEL, 'k.revokedAt': null }] });
      await M.Org.updateOne({ _id: org._id }, { $push: { apiKeys: { id, label: KEY_LABEL, hash: sha256(secret), last4: secret.slice(-4), createdAt: new Date() } } });
      await audit(scoped(M, org._id), { name: 'One-click connect' }, 'connector.link', clean, { check });
      res.json({ org: org.name, check, key: `tq_${id}_${secret}` });
   } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
