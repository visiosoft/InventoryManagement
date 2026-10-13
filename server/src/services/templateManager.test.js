import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTemplate, buildComponents } from './templateManager.js';

const ok = { name: 'winback_oct', bodyText: 'Hi {{1}}, a storage offer for you this month', bodyExamples: ['Sara'], headerType: 'image', imageKey: 'k', buttons: [] };

test('a complete template has no problems', () => assert.deepEqual(validateTemplate(ok), []));
test('bad name, missing example and edge variables are caught', () => {
  assert.ok(validateTemplate({ ...ok, name: 'Win Back' }).length);
  assert.ok(validateTemplate({ ...ok, bodyExamples: [] }).length);
  assert.ok(validateTemplate({ ...ok, bodyText: '{{1}} hello there' }).length);
  assert.ok(validateTemplate({ ...ok, imageKey: '' }).length);
});
test('components carry the image handle and examples', () => {
  const c = buildComponents({ ...ok, footerText: 'PurpleBox', buttons: [{ type: 'URL', text: 'Book', url: 'https://x.ae' }] }, 'H1');
  assert.equal(c[0].example.header_handle[0], 'H1');
  assert.deepEqual(c[1].example.body_text, [['Sara']]);
  assert.equal(c[2].type, 'FOOTER');
  assert.equal(c[3].buttons[0].type, 'URL');
});
