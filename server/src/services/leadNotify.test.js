import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLeadNotice, leadLabel } from './leadNotify.js';

const lead = { _id: 'abc123', fullName: 'Najwa Darwish', phone: '971528409889', source: 'whatsapp' };

test('a lead is named by their name where there is one', () => {
   assert.equal(leadLabel(lead), 'Najwa Darwish');
});

test('a placeholder name is not a name', () => {
   /* Every inbound chat creates a lead called "WhatsApp Contact 5521". Pushing
      that to somebody's phone tells them nothing they can act on. */
   assert.equal(leadLabel({ fullName: 'WhatsApp Contact 5521', phone: '971554644265' }), '971554644265');
   assert.equal(
      leadLabel({ fullName: 'whatsapp contact 1234', whatsappProfileName: 'Tk Technical Services' }),
      'Tk Technical Services',
      'their own WhatsApp profile name beats the number',
   );
   assert.equal(leadLabel({}), 'a new enquiry');
});

test('the push says who and what, in the space a phone gives you', () => {
   const n = buildLeadNotice({ lead, firstMessage: 'Hi, do you have a 50 sqft unit available from next week?' });
   assert.equal(n.push.title, 'New lead: Najwa Darwish');
   assert.match(n.push.body, /50 sqft/);
   assert.equal(n.push.url, '/leads/abc123');
   assert.ok(n.push.title.length < 50, 'a title that is cut off mid-word is worse than a short one');
});

test('a hand-off says who handed it over', () => {
   const n = buildLeadNotice({ lead, assignedByName: 'Mase Rasti' });
   assert.equal(n.push.title, 'Mase Rasti gave you a lead');
});

test('with no first message it says what is known instead of quoting nothing', () => {
   const n = buildLeadNotice({ lead });
   assert.match(n.push.body, /came in on whatsapp/);
   assert.doesNotMatch(n.push.body, /“”/);
});

test('the email carries the number, the source and why it is theirs', () => {
   const n = buildLeadNotice({ lead, reason: '50% share, 2 of 5 today' });
   assert.match(n.subject, /New lead · Najwa Darwish/);
   assert.match(n.text, /971528409889/);
   assert.match(n.text, /Why you: 50% share, 2 of 5 today/);
   assert.match(n.html, /971528409889/);
});

test('a link is only offered when there is somewhere to send them', () => {
   assert.doesNotMatch(buildLeadNotice({ lead }).html, /<a href/);
   const withUrl = buildLeadNotice({ lead, appUrl: 'https://office.purplebox.ae' });
   assert.match(withUrl.html, /https:\/\/office\.purplebox\.ae\/leads\/abc123/);
   assert.match(withUrl.text, /https:\/\/office\.purplebox\.ae\/leads\/abc123/);
});

test('a customer message cannot inject markup into the email', () => {
   const n = buildLeadNotice({
      lead: { ...lead, fullName: '<script>alert(1)</script>' },
      firstMessage: '<img src=x onerror=alert(1)>',
   });
   assert.doesNotMatch(n.html, /<script>/);
   assert.doesNotMatch(n.html, /<img src=x/);
   assert.match(n.html, /&lt;script&gt;/);
});

test('a long first message is trimmed rather than filling the screen', () => {
   const n = buildLeadNotice({ lead, firstMessage: 'x'.repeat(500) });
   assert.ok(n.push.body.length <= 95, `push body was ${n.push.body.length}`);
   assert.ok(n.text.includes('x'.repeat(400)) && !n.text.includes('x'.repeat(401)));
});

test('one notification per lead, so a re-send replaces rather than stacks', () => {
   assert.equal(buildLeadNotice({ lead }).push.tag, 'lead-abc123');
});
