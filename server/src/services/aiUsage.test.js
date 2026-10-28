import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costUsd, withAiFeature, currentAiFeature } from './aiUsage.js';
import { summarise } from './aiUsageReport.js';

test('cost at list price; unknown models have no guessed cost', () => {
   assert.equal(costUsd('claude-opus-5-5', 1_000_000, 100_000), 6);
   assert.equal(costUsd('claude-haiku-5-5', 1_000_000, 1_000_000), 0.6);
   assert.equal(costUsd('gpt-6-sol', 1000, 1000), null);
});

test('the feature label follows the call, and is "other" outside', async () => {
   assert.equal(currentAiFeature(), 'other');
   const seen = await withAiFeature('bot:Morning summary', async () => { await new Promise((r) => setTimeout(r, 1)); return currentAiFeature(); });
   assert.equal(seen, 'bot:Morning summary');
});

test('summary groups by provider, model, feature and day', () => {
   const s = summarise([
      { day: '2026-10-27', provider: 'anthropic', model: 'claude-opus-5-5', feature: 'agent:Aisha', calls: 2, inputTokens: 1000, outputTokens: 100, costUsd: 0.01 },
      { day: '2026-10-28', provider: 'openai', model: 'gpt-6-sol', feature: 'ask', calls: 1, inputTokens: 500, outputTokens: 50, costUsd: null },
   ]);
   assert.equal(s.total.calls, 3);
   assert.equal(s.total.unpricedCalls, 1);
   assert.equal(s.byProvider[0].provider, 'anthropic');
   assert.deepEqual(s.byDay.map((d) => d.day), ['2026-10-27', '2026-10-28']);
});
