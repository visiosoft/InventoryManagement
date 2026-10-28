import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeUnusable } from './openai.js';

test('out-of-credit and refused-key errors hand the call to OpenAI; others do not', () => {
   assert.ok(claudeUnusable(new Error('claude-sonnet-5-5: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}')));
   assert.ok(claudeUnusable(new Error('claude-opus-5-5: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')));
   assert.ok(!claudeUnusable(new Error('claude-opus-5-5: 529 overloaded')));
   assert.ok(!claudeUnusable(new Error('claude-opus-5-5 declined to answer (cyber)')));
});
