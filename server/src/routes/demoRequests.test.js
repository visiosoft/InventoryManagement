import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDemoRequest, demoRequestEmailText } from './demoRequests.js';

const valid = {
  name: 'Sam Lee', email: 'Sam@Acme.com ', company: 'Acme Storage',
  facilities: '2 to 5', country: 'Canada',
};

test('a complete request is accepted and the email is lower-cased', () => {
  const { fields, error } = parseDemoRequest(valid);
  assert.equal(error, undefined);
  assert.equal(fields.email, 'sam@acme.com');
  assert.equal(fields.phone, '');
});

test('missing or invalid required fields are refused', () => {
  assert.ok(parseDemoRequest({ ...valid, name: ' ' }).error);
  assert.ok(parseDemoRequest({ ...valid, email: 'not-an-email' }).error);
  assert.ok(parseDemoRequest({ ...valid, company: '' }).error);
  assert.ok(parseDemoRequest({ ...valid, country: '' }).error);
  assert.ok(parseDemoRequest({ ...valid, facilities: '7' }).error);
  assert.ok(parseDemoRequest().error);
});

test('over-long text is clipped rather than stored whole', () => {
  const { fields } = parseDemoRequest({ ...valid, message: 'x'.repeat(10_000) });
  assert.equal(fields.message.length, 3000);
});

test('the email lists the details and any ad tracking', () => {
  const { fields } = parseDemoRequest({ ...valid, phone: '+1 555', source: { utmCampaign: 'ca-search', gclid: 'abc' } });
  const text = demoRequestEmailText(fields);
  assert.match(text, /Company: Acme Storage/);
  assert.match(text, /Phone \/ WhatsApp: \+1 555/);
  assert.match(text, /Campaign: ca-search/);
  assert.match(text, /Google Ads click/);
});
