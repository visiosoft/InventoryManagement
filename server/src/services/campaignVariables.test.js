import test from 'node:test';
import assert from 'node:assert/strict';
import { fillVariables } from './campaignSender.js';

test('{first_name} and {name} become the person\'s own name', () => {
  assert.deepEqual(fillVariables(['Hi {first_name}', '{name}'], 'Sara Khan'), ['Hi Sara', 'Sara Khan']);
});
test('a missing name falls back to "there", other text is untouched', () => {
  assert.deepEqual(fillVariables(['Hello {first_name}', '20% off'], ''), ['Hello there', '20% off']);
});
