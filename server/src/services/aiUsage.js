import { AsyncLocalStorage } from 'node:async_hooks';
import { AiUsage } from '../models/index.js';

/**
 * Every AI call, logged: provider, model, tokens, an estimated cost and which
 * part of the CRM made it (a bot, an agent, the Ask box). Written from the two
 * provider files, so nothing that calls a model can skip it.
 *
 * The feature label rides along with the request (AsyncLocalStorage), so the
 * callers deep inside the assistant, its tools and the agents need no extra
 * argument: runBot, askBot, the Ask route and runAgent set it once.
 */

const store = new AsyncLocalStorage();

/** Run `fn` with every AI call inside it labelled `feature` (e.g. "bot:Morning summary"). */
export function withAiFeature(feature, fn) {
   return store.run({ feature: String(feature || 'other').slice(0, 80) }, fn);
}

export const currentAiFeature = () => store.getStore()?.feature || 'other';

/**
 * List price, US dollars per million tokens (input, output). Claude prices
 * from Anthropic's published rates; models without a known price log tokens
 * with no cost rather than a guessed one.
 */
const PRICES = {
   'claude-fable-5-1': [10, 50],
   'claude-fable-5': [10, 50],
   'claude-opus-5-5': [4, 20],
   'claude-opus-5': [5, 25],
   'claude-sonnet-5-5': [2, 10],
   'claude-sonnet-5': [2, 10],
   'claude-haiku-5-5': [0.1, 0.5],
   'gpt-4o-mini': [0.15, 0.6],
};

/** Estimated cost in US dollars, or null when the model's price is not known. Pure. */
export function costUsd(model, inputTokens, outputTokens, cachedTokens = 0) {
   const p = PRICES[String(model || '')];
   if (!p) return null;
   // Cached input is read back at about a tenth of the price.
   const cached = Math.min(cachedTokens || 0, inputTokens || 0);
   return Math.round((((inputTokens || 0) - cached) * p[0] + cached * p[0] * 0.1 + (outputTokens || 0) * p[1]) / 10_000) / 100;
}

/** Log one call. Never throws and never delays the caller. */
export function recordAiUsage({ provider, model, inputTokens = 0, cachedTokens = 0, outputTokens = 0, kind = 'chat', webSearches = 0 }) {
   try {
      void AiUsage.create({
         at: new Date(), provider, model: String(model || ''), feature: currentAiFeature(), kind,
         inputTokens, cachedTokens, outputTokens, webSearches, costUsd: costUsd(model, inputTokens, outputTokens, cachedTokens),
      }).catch(() => {});
   } catch { /* logging must never break a reply */ }
}
