import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from './provision.js';

/* Names, as customers actually type them.
 *
 * The slug is a subdomain and the database name is derived from it, so what
 * this function does to a company name decides both. Two of these cases come
 * from real input: a company that put its street address in, and two spellings
 * of one name that reduced to the same thing and briefly shared a database.
 */

test('a company name becomes a web address', () => {
   assert.equal(slugify('Acme Storage'), 'acme-storage');
   assert.equal(slugify('  Acme Storage  '), 'acme-storage');
   assert.equal(slugify('ACME  storage'), 'acme-storage');
});

test('punctuation a company name carries does not reach a URL', () => {
   assert.equal(slugify("O'Brien & Sons Self-Storage LLC"), 'o-brien-sons-self-storage-llc');
   assert.equal(slugify('Store-It! (Dubai)'), 'store-it-dubai');
   assert.equal(slugify('---Acme---'), 'acme', 'no leading or trailing hyphens');
});

test('a long name is cut to something usable', () => {
   /* Somebody typed a street address into this field. It became a
      forty-character subdomain, which is ugly but has to remain valid: a
      database name has a length limit and a URL has patience. */
   const long = slugify('Apartment No 602 Yasmeen Building Industrial Area 3 Sharjah');
   assert.ok(long.length <= 40, `got ${long.length}`);
   assert.ok(!long.endsWith('-'), 'never left ending in a hyphen by the cut');
});

test('a name with nothing usable in it yields nothing, rather than a bad name', () => {
   // Refused upstream with a message, which is better than a database called
   // "org_" or "org_---".
   assert.equal(slugify('!!!'), '');
   assert.equal(slugify(''), '');
   assert.equal(slugify(null), '');
});

test('what comes out is safe as both a database name and a subdomain', () => {
   for (const name of ['Acme Storage', "O'Brien & Sons", 'Store-It! (Dubai)', 'Über Lager']) {
      const slug = slugify(name);
      assert.match(slug, /^[a-z0-9-]*$/, `${slug} must be lowercase letters, digits and hyphens only`);
      // MongoDB refuses these in a database name; a subdomain refuses more.
      for (const bad of ['/', '\\', '.', ' ', '"', '$', '*', '<', '>', ':', '|', '?']) {
         assert.ok(!slug.includes(bad), `${slug} contains ${bad}`);
      }
   }
});
