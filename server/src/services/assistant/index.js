import { AssistantConfig } from '../../models/index.js';
import { chatWithTools, openaiConfigured, openaiModel } from '../openai.js';
import { siteScope } from '../../utils/siteScope.js';
import { dayKeyFor } from '../dailyDigest.js';
import { toolDefinitions, toolByName } from './tools.js';
import { PROPOSAL_TOOLS } from './actions.js';

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

Answer only from the tools. If no tool can answer, say plainly that you cannot see it in the system — never estimate, never fill a gap from general knowledge. When a question is close to something you can answer, answer the nearest thing and say what you did: "I can't see it by the hour, but today so far…". Be brief and concrete: lead with the number or the name, then one line of context. Use AED for money. When a list is long, give the count and the first few, and offer the rest.`;

const RULES = `RULES YOU CANNOT BREAK:
- Every figure you state must come from a tool result in this conversation. Do not compute, round, extrapolate or recall figures.
- Never say that a person, contract, unit or message exists, or describe it, without having looked it up in this conversation.
- If a question has several parts, look each part up before you answer. Never say you cannot see something you have not asked a tool for.
- If the tools returned nothing useful, say you cannot see it in the system. Do not answer from general knowledge.
- Dates you pass to tools are YYYY-MM-DD. "Today" and relative dates are worked out from the date given below.
- Do not mention tools by name to the user. Speak as the system.
- Buttons to the relevant pages — a customer, a contract, a chat — are attached to your answer automatically. You may say "open it below". Do not write URLs yourself.
- You can draft an email to customers or leads, and prepare a quotation or a contract for a person — but you cannot create or send any of them yourself. When you have prepared one, say so in a line and tell them to press Confirm in the card. Never say it has been created, booked, reserved, signed or sent — only a person's Confirm does that, and a contract is a draft until it is signed.`;

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

   /* Whether this person may even be offered an action. If not, the proposal
      tool is simply absent — the model cannot propose what it cannot see. */
   const mayAct = config.actionsEnabled !== false
      && (config.actionRoles?.length ? config.actionRoles : ['admin']).includes(user?.role);
   const tools = toolDefinitions().filter((t) => mayAct || !PROPOSAL_TOOLS.includes(t.function.name));
   let pending = null;

   for (; rounds < maxRounds; rounds += 1) {
      let turn = await chatWithTools({ system, messages, tools, model, maxTokens: 700 });

      /* It answered without looking. "Rikki is a lead" with no lookup is a
         guess whether or not it happens to be true, and a guess with no
         number in it slips past the figure check. So the first time round it
         is not allowed to answer at all — it has to pick a question to ask
         the database. A question none of them fits still ends in "I can't
         see that", but through a tool that came back empty, not from memory. */
      if (!turn.toolCalls.length && rounds === 0 && !/^\s*(hi|hello|hey|thanks|thank you|ok|okay)\b/i.test(text)) {
         turn = await chatWithTools({ system, messages, tools, model, maxTokens: 700, toolChoice: 'required' });
      }

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
         if (PROPOSAL_TOOLS.includes(call.name) && out?.proposalId) {
            pending = { id: out.proposalId, kind: out.kind || 'create_quotation', summary: out.summary, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
         }
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

   /* A drafted email is the model's words too, and it will reach a customer.
      Any figure in it must have come from a tool, exactly like an answer. */
   const drafted = results.find((r) => r.tool === 'propose_email' && r.result?.proposalId);
   if (drafted) {
      const body = String(messages.find((m) => m.role === 'assistant' && m.tool_calls)?.tool_calls
         ?.find((c) => c.function?.name === 'propose_email')?.function?.arguments || '');
      const inDraft = figuresGrounded(body, results.filter((r) => r.tool !== 'propose_email'));
      if (!inDraft.ok) {
         const { dropProposal } = await import('./actions.js');
         dropProposal(drafted.result.proposalId);
         pending = null;
         return {
            answer: `I drafted it, but it stated figures the system did not give me (${inDraft.loose.slice(0, 3).join(', ')}), so I have not put it up for sending. Ask me for the exact figures first, then ask for the draft again.`,
            tools: used, model, rounds, grounded: false, links: [],
         };
      }
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

   /* Pages for what the tools returned, deduplicated, a handful at most.
      Built from tool results rather than written by the model, so a button
      always goes somewhere real. */
   const seen = new Set();
   const links = [];
   for (const r of results) {
      for (const l of (r.result?.links || [])) {
         if (!l?.path || seen.has(l.path)) continue;
         seen.add(l.path);
         links.push({ label: String(l.label || l.path).slice(0, 60), path: String(l.path) });
         if (links.length >= 6) break;
      }
      if (links.length >= 6) break;
   }

   /* A screen the answer wants opened, with what it should open with.
      Built from the tool result, never from the model — so the people the
      composer selects are the ones the server's own query returned, not a list
      the model retyped. Nothing is sent by opening it; the composer's own Send
      button is still the only thing that mails anybody. */
   let compose = null;
   for (const r of results) {
      if (r.result?.compose?.customerIds?.length) { compose = r.result.compose; break; }
   }

   return { answer: content, tools: used, model, rounds, grounded: true, pending, links, compose };
}
