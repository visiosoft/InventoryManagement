import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { orgOnToken } from './tenant.js';

/* The bug this guards against.
 *
 * A customer signed in and was shown the landlord's contracts. The tenancy
 * machinery was fine; the mounting was not. `withTenant` sits in front of every
 * API route while `requireAuth` runs per route, so `req.user` is not set yet
 * when the organisation has to be chosen. Reading it there made every request
 * look anonymous, and single mode pinned the deployment's own database for all
 * of them.
 *
 * The test that missed it built the app with the two mounted the other way
 * round, and passed against an arrangement the real server does not use. These
 * test the function that now decides, with the request shaped as it actually
 * arrives: a token, and no req.user.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const sign = (claims, secret = process.env.JWT_SECRET) => jwt.sign({ id: '1', email: 'x@y.z', ...claims }, secret);
const asRequest = (token, user) => ({ headers: token ? { authorization: `Bearer ${token}` } : {}, ...(user ? { user } : {}) });

test('the organisation is found on a request that has not been authenticated yet', () => {
   // No req.user, because requireAuth has not run. This is the shape that leaked.
   const req = asRequest(sign({ org: 'acme-id' }));
   assert.equal(req.user, undefined, 'the request must have no user — that is the point');
   assert.equal(orgOnToken(req), 'acme-id');
});

test('req.user still wins where something upstream has already decoded it', () => {
   assert.equal(orgOnToken(asRequest(sign({ org: 'from-token' }), { org: 'from-user' })), 'from-user');
});

test('one of our own users carries no organisation', () => {
   // A staff token from the live system predates organisations entirely.
   assert.equal(orgOnToken(asRequest(sign({ role: 'admin' }))), null);
});

test('a forged token chooses nothing rather than something', () => {
   /* The failure that matters: if a token signed with another key could name an
      organisation, anybody could read any customer's database by minting one. */
   assert.equal(orgOnToken(asRequest(sign({ org: 'somebody-elses' }, 'a-different-secret'))), null);
   assert.equal(orgOnToken(asRequest('not-a-token')), null);
   assert.equal(orgOnToken(asRequest(null)), null);
   assert.equal(orgOnToken({ headers: { authorization: 'Basic abc' } }), null);
});

test('an expired token is no longer an organisation', () => {
   const expired = jwt.sign({ org: 'acme-id' }, process.env.JWT_SECRET, { expiresIn: -10 });
   assert.equal(orgOnToken(asRequest(expired)), null);
});
