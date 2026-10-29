import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { Platform, Usage } from './models.js';
import { decrypt } from './security.js';

/**
 * Model providers behind one call: `llm.json({ system, user, maxTokens, effort })`
 * returns the parsed JSON object the model wrote.
 *
 * Which key: the organisation's own (bring your own key), else the platform
 * key the platform admin set, else the server's environment. Every call is
 * counted per organisation, day, feature and model, with whether the
 * platform paid for it — the basis for metered billing later.
 */

// OpenAI's default is the one the PurpleBox CRM already runs on; any model can be set per organisation.
export const DEFAULT_MODELS = { anthropic: 'claude-opus-5-5', openai: 'gpt-4o-mini' };

/** The first JSON object in a model's text. Pure. */
export function firstJson(text) {
   const s = String(text || '');
   const start = s.indexOf('{');
   if (start < 0) throw new Error('The model did not return JSON');
   let depth = 0; let inStr = false; let esc = false;
   for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{') depth += 1; else if (c === '}') { depth -= 1; if (depth === 0) return JSON.parse(s.slice(start, i + 1)); }
   }
   throw new Error('The model returned incomplete JSON');
}

/** Which provider, model and key an organisation uses. */
export async function resolveProvider(org) {
   if (org?.ai?.keyEnc && org.ai.provider) {
      return { provider: org.ai.provider, model: org.ai.model || DEFAULT_MODELS[org.ai.provider], key: decrypt(org.ai.keyEnc), platformKey: false };
   }
   const p = await Platform.findOne({ key: 'platform' }).lean();
   const provider = p?.provider || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : 'anthropic');
   const key = provider === 'openai'
      ? (p?.openaiKeyEnc ? decrypt(p.openaiKeyEnc) : process.env.OPENAI_API_KEY)
      : (p?.anthropicKeyEnc ? decrypt(p.anthropicKeyEnc) : process.env.ANTHROPIC_API_KEY);
   return { provider, model: org?.ai?.model || p?.model || DEFAULT_MODELS[provider], key, platformKey: true };
}

async function count(orgId, feature, r, usage) {
   if (!orgId) return;
   const day = new Date().toISOString().slice(0, 10);
   await Usage.updateOne(
      { org: orgId, day, feature, provider: r.provider, model: r.model, platformKey: r.platformKey },
      { $inc: { calls: 1, inputTokens: usage.input || 0, outputTokens: usage.output || 0 } },
      { upsert: true },
   ).catch(() => null);
}

async function anthropicJson({ key, model, system, user, maxTokens, effort }) {
   const client = new Anthropic({ apiKey: key, timeout: 180_000, maxRetries: 2 });
   const res = await client.beta.messages.create({
      model, max_tokens: Math.max(maxTokens, 4000), system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort },
      // A safety decline is retried on a suitable model inside the same call.
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
   });
   if (res.stop_reason === 'refusal') throw new Error(`The model declined${res.stop_details?.category ? ` (${res.stop_details.category})` : ''}`);
   if (res.stop_reason === 'max_tokens') throw new Error('The model ran out of room; try a smaller batch');
   const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
   return { out: firstJson(text), usage: { input: res.usage?.input_tokens, output: res.usage?.output_tokens } };
}

async function openaiJson({ key, model, system, user, maxTokens }) {
   const { data } = await axios.post('https://api.openai.com/v1/chat/completions', {
      model, response_format: { type: 'json_object' }, max_completion_tokens: Math.max(maxTokens, 4000),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
   }, { headers: { Authorization: `Bearer ${key}` }, timeout: 180_000 });
   return { out: firstJson(data.choices?.[0]?.message?.content), usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens } };
}

/**
 * The `llm` the training pipeline uses, for one organisation. `feature`
 * labels the usage ("cluster", "suggest", "judge", "agent").
 */
export function llmFor(org, feature = 'other') {
   return {
      async json({ system, user, maxTokens = 2000, effort }) {
         const r = await resolveProvider(org);
         if (!r.key) throw new Error('No AI key is set. Add one in Settings → AI provider, or ask the platform admin to set a platform key.');
         const level = effort || (['cluster', 'judge'].includes(feature) ? 'low' : 'medium');
         const call = r.provider === 'openai' ? openaiJson : anthropicJson;
         const { out, usage } = await call({ key: r.key, model: r.model, system, user, maxTokens, effort: level });
         await count(org?._id, feature, r, usage);
         return out;
      },
   };
}

/** Checks a key works before saving it: one tiny call. */
export async function verifyKey(provider, key, model) {
   const m = model || DEFAULT_MODELS[provider];
   try {
      if (provider === 'openai') await openaiJson({ key, model: m, system: 'Reply with JSON.', user: 'Return {"ok": true}', maxTokens: 50 });
      else await anthropicJson({ key, model: m, system: 'Reply with JSON only.', user: 'Return {"ok": true}', maxTokens: 50, effort: 'low' });
      return { ok: true };
   } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e?.response?.status === 401) return { ok: false, error: 'That key was rejected' };
      if (e instanceof Anthropic.NotFoundError || e?.response?.status === 404) return { ok: false, error: `Model ${m} is not available on that key` };
      return { ok: false, error: e.message };
   }
}
