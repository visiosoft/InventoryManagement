import { AssistantConfig } from '../../models/index.js';
import { chatWithTools, openaiConfigured, openaiModel } from '../openai.js';
import { siteScope } from '../../utils/siteScope.js';
import { dayKeyFor } from '../dailyDigest.js';
import { toolDefinitions, toolByName } from './tools.js';

/**
 * The assistant in the corner of every page.
 *
 * It answers only from tools the server runs against this database. The
 * model decides which tool answers the question and phrases the result; it
 * never reads a collection and never does arithmetic. Two checks make that
 * true rather than hoped for:
 *
 *   - an answer that used no tool may not contain a figure. A question the
 *     tools cannot answer gets "I can't see that in the system", not a guess.
 *   - every number in the answer must appear in what the tools returned. One
 *     retry with a sterner instruction; then it fails closed and says so.
 */

export const DEFAULT_PROMPT = `You are the assistant inside PurpleBox Storage's office system in Dubai. Staff ask you questions about units, prices, contracts, customers, leads, WhatsApp, documents and tasks.

Answer only from the tools. If no tool can answer, say plainly that you cannot see it in the system — never estimate, never fill a gap from general knowledge. Be brief and concrete: lead with the number or the name, then one line of context. Use AED for money. When a list is long, give the count and the first few, and offer the rest.`;

const RULES = `RULES YOU CANNOT BREAK:
- Every figure you state must come from a tool result in this conversation. Do not compute, round, extrapolate or recall figures.
- If the tools returned nothing useful, say you cannot see it in the system. Do not answer from general knowledge.
- Dates you pass to tools are YYYY-MM-DD. "Today" and relative dates are worked out from the date given below.
- Do not mention tools by name to the user. Speak as the system.
- Never claim to have sent a message, made a booking, or changed anything. You can only read.`;

/** Any figure that could be mistaken for a fact: money, counts, sizes, dates. */
const NUMBERS = /\d[\d,]*(?:\.\d+)?/g;

export async function getAssistantConfig() {
   let config = await AssistantConfig.findOne();
   if (!config) config = await AssistantConfig.create({ systemPrompt: DEFAULT_PROMPT });
   return config;
}

/**
 * Whether every number in the answer was actually returned by a tool.
 *
 * Deliberately blunt: strip separators, compare digit strings. A tool result
 * of 1647 legitimately becomes "AED 1,647" — and "about 1,600" does not.
 */
export function figuresGrounded(answer, toolResults) {
   const haystack = JSON.stringify(toolResults).replace(/[,\s]/g, '');
   const found = String(answer).match(NUMBERS) || [];
   const loose = [];
   for (const raw of found) {
      const n = raw.replace(/,/g, '');
      // Single digits are ordinals and list markers as often as facts.
      if (n.length < 2) continue;
      if (!haystack.includes(n)) loose.push(raw);
   }
   return { ok: loose.length === 0, loose };
}

function systemPromptFor(config, { user, now }) {
   const today = dayKeyFor(now);
   const weekday = new Date(now).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Asia/Dubai' });
   return [
      config.systemPrompt || DEFAULT_PROMPT,
      RULES,
      `Today is ${weekday} ${today} (Dubai). The person asking is ${user?.name || 'a member of staff'} (${user?.role || 'staff'}).`,
   ].join('\n\n');
}

/**
 * Answer one question, with the last few turns for context.
 *
 * @returns {{ answer, tools: [{name, args, ok}], model, rounds, grounded }}
 */
export async function askAssistant({ question, history = [], siteId = null, user = null, now = new Date() }) {
   if (!openaiConfigured()) return { answer: 'The assistant is not set up — OpenAI is not configured.', tools: [], model: '', rounds: 0, grounded: true };
   const config = await getAssistantConfig();
   if (!config.enabled) return { answer: 'The assistant is switched off.', tools: [], model: '', rounds: 0, grounded: true };

   const text = String(question || '').trim();
   if (!text) return { answer: 'Ask me something about the system.', tools: [], model: '', rounds: 0, grounded: true };

   const scope = await siteScope(siteId).catch(() => null);
   const ctx = { scope, user, now };
   const model = config.model || openaiModel();
   const system = systemPromptFor(config, { user, now });

   // Only the last few turns, and only their text — tool traffic is not replayed.
   const messages = [
      ...history.slice(-8).map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content || '').slice(0, 2000) })),
      { role: 'user', content: text.slice(0, 2000) },
   ];

   const used = [];
   const results = [];
   let content = '';
   let rounds = 0;
   const maxRounds = Math.max(1, Number(config.maxToolRounds || 4));

   for (; rounds < maxRounds; rounds += 1) {
      const turn = await chatWithTools({ system, messages, tools: toolDefinitions(), model, maxTokens: 700 });
      if (!turn.toolCalls.length) { content = turn.content; break; }

      messages.push(turn.message);
      for (const call of turn.toolCalls) {
         const t = toolByName(call.name);
         let out;
         try {
            out = t ? await t.run(call.args || {}, ctx) : { error: `No tool called ${call.name}` };
         } catch (e) {
            out = { error: e.message };
         }
         used.push({ name: call.name, args: call.args, ok: !out?.error });
         results.push({ tool: call.name, result: out });
         messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out).slice(0, 12000) });
      }
   }

   // Ran out of rounds mid-thought: ask once more for the answer, tools off.
   if (!content) {
      const final = await chatWithTools({ system, messages, tools: [], model, maxTokens: 700 });
      content = final.content;
   }

   /* No tool, but a figure — that is a guess, whatever it reads like. */
   if (!used.length && NUMBERS.test(content)) {
      return { answer: "I can't see that in the system — none of the questions I can ask the database covers it. Try asking about units, prices, contracts, customers, leads, WhatsApp, documents or tasks.", tools: used, model, rounds, grounded: false };
   }

   let check = figuresGrounded(content, results);
   if (!check.ok && results.length) {
      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: `Your answer used figures that did not come from the tools: ${check.loose.join(', ')}. Rewrite it using only figures that appear in the tool results, exactly as returned. If a figure you need is not there, say so instead of stating it.` });
      const retry = await chatWithTools({ system, messages, tools: [], model, maxTokens: 700 });
      content = retry.content;
      check = figuresGrounded(content, results);
   }

   if (!check.ok) {
      /* Fail closed. A confident number nobody can trace is worse than no
         answer, and the person can see exactly which questions were run. */
      return {
         answer: `I have the data but could not phrase an answer I can stand behind — some figures did not match what the database returned (${check.loose.slice(0, 3).join(', ')}). Try asking more specifically.`,
         tools: used, model, rounds, grounded: false,
      };
   }

   return { answer: content, tools: used, model, rounds, grounded: true };
}
