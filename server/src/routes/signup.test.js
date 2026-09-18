import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSignup } from './signup.js';

test('a business name is required', () => {
  assert.equal(validateSignup({ businessName: '', password: 'longenough' }), 'A business name is required');
  assert.equal(validateSignup({ businessName: '   ', password: 'longenough' }), 'A business name is required');
});

test('a password under 6 characters is refused', () => {
  assert.equal(validateSignup({ businessName: 'Acme', password: 'abc12' }), 'Password must be at least 6 characters');
  assert.equal(validateSignup({ businessName: 'Acme', password: '' }), 'Password must be at least 6 characters');
});

test('a real name and a long enough password pass', () => {
  assert.equal(validateSignup({ businessName: 'Acme Storage', password: 'abcdef' }), null);
});
