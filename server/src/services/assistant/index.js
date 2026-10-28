import { reportNumbers, reportTexts } from './makeTools.js';
import { AssistantConfig } from '../../models/index.js';
import { chatWithTools, openaiConfigured, openaiModel, resolveModel } from '../openai.js';
import { siteScope } from '../../utils/siteScope.js';
import { redactDeep } from '../../utils/pii.js';
import { dayKeyFor } from '../dailyDigest.js';
import { toolDefinitions, toolByName } from './tools.js';
import { PROPOSAL_TOOLS, ACTION_TOOLS } from './actions.js';
// Registers the staff-app tools (follow-ups, chats, invoices, Zoho, sending) on import.
import './staffTools.js';
import './makeTools.js';
import './pricingTools.js';
import './connectorTools.js';

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
- A stay of N weeks checks out on the last day of the stay: the end date is the start date plus N×7 days minus one (4 weeks from 1 Nov ends 28 Nov — 28 days, not 29).
- Dates you pass to tools are YYYY-MM-DD. "Today" and relative dates are worked out from the date given below.
- Do not mention tools by name to the user. Speak as the system.
- Buttons to the relevant pages — a customer, a contract, a chat — are attached to your answer automatically. You may say "open it below". Do not write URLs yourself.
- Booking a unit, making a quotation or raising an invoice works like the booking form. First look up what you can (the customer or lead by name or phone, which units of the size are free and their prices). Then, if anything is still missing, show a form with ask_details — never a numbered list of questions — with every value you already know filled in: for a booking or quotation the customer's name and phone, the unit size (a select of the free sizes), the start date (today unless they said), how long in months (or the end date), any discount (optional) and send by (WhatsApp, email or just create it); for an invoice which contract, what for, the amount and the due date. When the answers come back, check them, look up anything new, and prepare it in the same turn and tell them to press Confirm. Ask again with a form only for what is still wrong or missing.
- When your message asks a question with a few set answers, end it with one line exactly like: Options: 25 sq ft | 50 sq ft | 100 sq ft — at most 6 short answers, separated by |. They become buttons, so leave them out of the rest of the message.
- You can make a PDF or Excel file of a list (leads, expiring contracts, tasks, free units, calls) with export_file, and of any other table from this conversation with make_file. You can draw a bar, line or pie chart with make_chart. When someone asks for a file, PDF, Excel, export, printout, graph or chart, make it — the download button or chart appears under your answer; say so in one line. Never say you cannot make files or charts. Copy every figure in them exactly from tool results.
- You can set up a new scheduled bot with create_bot when someone asks for one ("every day send me…"); "me" is the person asking.
- When the web is switched on you may search the internet with web_search for anything outside the system (competitors, market prices, news). Keep what came from the web apart from what came from the system, and name the source. When it is off and the question needs the internet, say they can switch on Web.
- WhatsApp free text only reaches someone who wrote in the last 24 hours. For anyone quieter, offer an approved template: list them with whatsapp_templates and prepare one with propose_whatsapp_template — marketing templates are fine for follow-ups.
- Lead housekeeping happens straight away when asked: a new lead, a follow-up date, a site visit, a lead's stage, a note.
- Anything that reaches a customer or moves money is only prepared: a WhatsApp message, an email, a quotation, a contract, an invoice, sending an invoice, a payment, extending a contract, a template. When you have prepared one, say so in a line and tell them to press Confirm in the card. Never say it has been created, booked, reserved, signed or sent — only a person's Confirm does that, and a contract is a draft until it is signed.
- Before writing to a customer or judging one (interested, lost, agreed to visit), read their conversation first. The latest message wins.
- A booking end to end is: find or quote the unit for the dates, then prepare the quotation or the contract. Do every lookup you need in the same turn, then prepare it — do not stop to ask for something a tool can find.
- If the person asking is a sales rep, "my leads", "my follow-ups" and "who is waiting for me" mean leads they own.
- Answers are read on a phone: short, the name or number first, no headings, no tables.`;

/** "…which size?\nOptions: 25 sq ft | 50 sq ft" → the message, and the answers as buttons. */
export function splitOptions(text) {
   const content = String(text || '');
   const m = /(?:^|\n)\s*Options:\s*(.+?)\s*$/i.exec(content);
   if (!m) return { content, options: [] };
   const options = m[1].split('|').map((o) => o.trim().replace(/^[-*•]\s*/, '').replace(/[.。]$/, '')).filter((o) => o && o.length <= 40).slice(0, 6);
   return { content: content.slice(0, m.index).trimEnd(), options };
}

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

/**
 * Charts and made files carry the model's numbers: each is checked against
 * what the other tools returned (and the question itself), like the answer.
 * Returns the charts that pass, the made files that do not, and how many fell.
 */
export function checkMade(results, question = '') {
   const madeBy = ['make_chart', 'make_file', 'make_report'];
   const evidence = [...results.filter((r) => !madeBy.includes(r.tool)), question];
   // Spaced, not comma-joined: "61,74" would read as one number with a thousands comma.
   const numbersIn = (rows) => rows.flat(2).filter((v) => typeof v === 'number').join(' ');
   const charts = [];
   const reports = [];
   const droppedFiles = [];
   for (const r of results) {
      if (r.tool === 'make_chart' && r.result?.chart) {
         if (figuresGrounded(numbersIn(r.result.chart.series.map((x) => x.values)), evidence).ok) charts.push(r.result.chart);
         else droppedFiles.push(null);
      }
      if (r.tool === 'make_file' && r.result?.file && !figuresGrounded(numbersIn(r.result.table.rows), evidence).ok) droppedFiles.push(r.result.generatedFileId);
      // A report card: every stated figure must match; a sentence with a
      // figure that does not is left off rather than shown.
      if (r.tool === 'make_report' && r.result?.report) {
         const card = { ...r.result.report };
         if (!figuresGrounded(numbersIn(reportNumbers(card)), evidence).ok) { droppedFiles.push(null); continue; }
         for (const [k, text] of Object.entries(reportTexts(card))) {
            if (!text || figuresGrounded(text, evidence).ok) continue;
            if (k === 'headline') card.headline = card.eyebrow || 'Report';
            else if (k.startsWith('action')) card.actions = card.actions.map((x, i) => (`action${i}` === k ? { ...x, detail: '' } : x));
            else if (k.startsWith('sub')) card.kpis = card.kpis.map((x, i) => (`sub${i}` === k ? { ...x, sub: '' } : x));
            else card[k] = '';
         }
         reports.push(card);
      }
   }
   return { charts, reports, droppedFiles: droppedFiles.filter(Boolean), dropped: droppedFiles.length };
}

/** What the person is looking at in the staff app, so "send her the quote" or
 *  "move this to Monday" needs no name. Only ever a pointer: the tools still
 *  look the lead up, nothing about it is taken from the client as fact. */
function contextLine(context) {
   if (!context || typeof context !== 'object') return '';
   const clip = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 80);
   const parts = [];
   if (context.screen) parts.push(`They are on the ${clip(context.screen)} screen of the staff mobile app.`);
   if (context.leadId || context.phone || context.name) {
      parts.push(`The lead on screen is ${clip(context.name) || 'unnamed'}${context.phone ? `, phone ${clip(context.phone)}` : ''}${context.leadId ? `, leadId ${clip(context.leadId)}` : ''}. "This customer", "him", "her", "them" mean this lead — pass the leadId to the tools.`);
   }
   return parts.join(' ');
}

function systemPromptFor(config, { user, now, context }) {
   const today = dayKeyFor(now);
   const weekday = new Date(now).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Asia/Dubai' });
   return [
      config.systemPrompt || DEFAULT_PROMPT,
      RULES,
      `Today is ${weekday} ${today} (Dubai). The person asking is ${user?.name || 'a member of staff'} (${user?.role || 'staff'}).`,
      contextLine(context),
   ].filter(Boolean).join('\n\n');
}

/**
 * Answer one question, with the last few turns for context.
 *
 * @returns {{ answer, tools: [{name, args, ok}], model, rounds, grounded }}
 */
export async function askAssistant({ question, history = [], siteId = null, user = null, now = new Date(), authHeader = '', context = null, web = false, rounds: roundsWanted = 0 }) {
   if (!openaiConfigured()) return { answer: 'The assistant is not set up — no AI provider is configured.', tools: [], model: '', rounds: 0, grounded: true };
   const config = await getAssistantConfig();
   if (!config.enabled) return { answer: 'The assistant is switched off.', tools: [], model: '', rounds: 0, grounded: true };

   const text = String(question || '').trim();
   if (!text) return { answer: 'Ask me something about the system.', tools: [], model: '', rounds: 0, grounded: true };

   const scope = await siteScope(siteId).catch(() => null);
   // Carried so a write tool can call the app's own API with the asking
   // user's own token — same reason the confirmed-proposal executor does:
   // whatever it creates is attributed exactly as if they had used the page.
   const ctx = { scope, user, now, authHeader, web: Boolean(web) };
   const model = resolveModel(config.model);
   const effort = config.effort || undefined;
   const system = systemPromptFor(config, { user, now, context });

   // Only the last few turns, and only their text — tool traffic is not replayed.
   const messages = [
      /* The last exchange in full — a long report ends with what it offered
         to do next, which is what "yes, do that" refers to; older turns shorter. */
      ...history.slice(-8).map((h, i, all) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content || '').slice(0, i >= all.length - 2 ? 8000 : 2000) })),
      { role: 'user', content: text.slice(0, 2000) },
   ];

   const used = [];
   const results = [];
   let content = '';
   let rounds = 0;
   // A booking end to end (find the person, price the unit, prepare it) needs
   // a few rounds; 6 is the floor so an old stored default of 4 does not cut it short.
   // A scheduled report may ask for more steps than a typed question gets.
   const maxRounds = Math.max(6, Number(config.maxToolRounds || 6), Math.min(16, Number(roundsWanted) || 0));

   /* Whether this person may even be offered an action. If not, the proposal
      tool is simply absent — the model cannot propose what it cannot see. */
   const mayAct = config.actionsEnabled !== false
      && (config.actionRoles?.length ? config.actionRoles : ['admin', 'sales_rep']).includes(user?.role);
   const tools = toolDefinitions()
      .filter((t) => mayAct || !ACTION_TOOLS.includes(t.function.name))
      // The internet only when the person switched it on for this question.
      .filter((t) => web || t.function.name !== 'web_search');
   let pending = null;

   for (; rounds < maxRounds; rounds += 1) {
      let turn = await chatWithTools({ system, messages, tools, model, effort, maxTokens: 1500 });

      /* It answered without looking. "Rikki is a lead" with no lookup is a
         guess whether or not it happens to be true, and a guess with no
         number in it slips past the figure check. So the first time round it
         is not allowed to answer at all — it has to pick a question to ask
         the database. A question none of them fits still ends in "I can't
         see that", but through a tool that came back empty, not from memory. */
      if (!turn.toolCalls.length && rounds === 0 && !/^\s*(hi|hello|hey|thanks|thank you|ok|okay)\b/i.test(text)) {
         turn = await chatWithTools({ system, messages, tools, model, effort, maxTokens: 1500, toolChoice: 'required' });
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
         messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(redactDeep(out)).slice(0, 12000) });
      }
      /* A form is the question: it goes on screen as it is, and the
         answers come back as the next message. */
      const asked = results.find((r) => r.result?.form);
      if (asked && !pending) { content = asked.result.form.intro; break; }
   }

   // Ran out of rounds mid-thought: ask once more for the answer, tools off.
   if (!content) {
      const final = await chatWithTools({ system, messages, tools: [], model, effort, maxTokens: 1500 });
      content = final.content;
   }

   /* Suggested answers to its own question — "Options: a | b | c" on the
      last line — become buttons. Taken off before the figure check: they are
      replies for the person to choose, not facts being stated. */
   let options;
   ({ content, options } = splitOptions(content));

   /* No tool, but a figure — that is a guess, whatever it reads like. */
   if (!used.length && NUMBERS.test(content)) {
      return { answer: "I can't see that in the system — none of the questions I can ask the database covers it. Try asking about units, prices, contracts, customers, leads, WhatsApp, documents or tasks.", tools: used, model, rounds, grounded: false };
   }

   /* A drafted email or WhatsApp is the model's words too, and it will reach
      a customer. Any figure in it must have come from a tool — or from the
      person's own question, since "tell him it's 1,200" is theirs to say. */
   const DRAFT_TOOLS = { propose_email: 'body', propose_whatsapp_message: 'message' };
   const drafted = results.find((r) => DRAFT_TOOLS[r.tool] && r.result?.proposalId);
   if (drafted) {
      const call = messages.filter((m) => m.role === 'assistant' && m.tool_calls)
         .flatMap((m) => m.tool_calls).reverse()
         .find((c) => c.function?.name === drafted.tool);
      let body = '';
      try { body = String(JSON.parse(call?.function?.arguments || '{}')[DRAFT_TOOLS[drafted.tool]] || ''); } catch { body = String(call?.function?.arguments || ''); }
      const inDraft = figuresGrounded(body, [...results.filter((r) => !DRAFT_TOOLS[r.tool]), text]);
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

   const formAsked = !pending && results.some((r) => r.result?.form);
   let check = figuresGrounded(content, formAsked ? [...results, text] : results);
   if (!check.ok && results.length) {
      messages.push({ role: 'assistant', content });
      messages.push({ role: 'user', content: `Your answer used figures that did not come from the tools: ${check.loose.join(', ')}. Rewrite it using only figures that appear in the tool results, exactly as returned. If a figure you need is not there, say so instead of stating it. Reply with the rewritten answer only — no remark about this check or about what you changed.` });
      const retry = await chatWithTools({ system, messages, tools: [], model, effort, maxTokens: 1500 });
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
      Built from the tool result, never from the model — so the recipients the
      composer selects are the ones the server's own query returned, not a
      list the model retyped. Nothing is sent by opening it; the composer's
      own Send button is still the only thing that mails or messages anybody.
      Two shapes travel through here: email's `customerIds` and WhatsApp's
      `contracts` — checked by whichever one the tool that ran actually
      filled in. */
   /* Files made for this answer: download buttons, built from the tool
      result, never from the model. */
   /* Charts and made files carry the model's numbers: each is checked against
      what the other tools returned (and the question itself), like the answer.
      One that does not match is dropped, and the answer says so. */
   const { charts, reports, droppedFiles, dropped } = checkMade(results, text);
   for (const r of results) {
      if (r.tool === 'make_file' && droppedFiles.includes(r.result?.generatedFileId)) {
         r.result.file = null;
         const { GeneratedFile } = await import('../../models/index.js');
         await GeneratedFile.deleteOne({ _id: r.result.generatedFileId }).catch(() => null);
      }
   }
   if (dropped) content = `${content}\n\n(${dropped === 1 ? 'A chart or file was' : `${dropped} charts or files were`} left out: a figure in it did not match the data.)`;

   const files = results.map((r) => r.result?.file).filter((f) => f?.path).slice(0, 4)
      .map((f) => ({ label: String(f.label || 'Download').slice(0, 60), path: String(f.path), format: f.format === 'excel' ? 'excel' : 'pdf' }));

   let compose = null;
   for (const r of results) {
      const c = r.result?.compose;
      if (c?.customerIds?.length || c?.contracts?.length) { compose = c; break; }
   }

   /* A structured card for the couple of answers where a prose sentence
      throws away shape a screen can show better — a stat grid for
      inventory, a list for people found, a line-item breakdown for a
      price. Built from the actual tool result, same rule as links/compose:
      never from the model, so a card can't show a number the model made
      up. Anything not on this short list just reads as the plain answer —
      most questions are answered fine in a sentence and don't need one. */
   const CARD_TOOLS = { units_available: 'inventory', find_customer: 'contacts', price_booking: 'price' };
   let card = null;
   for (const r of results) {
      const type = CARD_TOOLS[r.tool];
      if (type && !r.result?.error) { card = { type, data: r.result }; break; }
   }

   /* The form it asked to show, cleaned by the tool, never retyped. */
   const form = pending ? null : (results.find((r) => r.result?.form)?.result.form ?? null);

   /* Pages from the web that the answer drew on, as links out. */
   const sources = [];
   for (const r of results) for (const w of (r.result?.web || [])) if (w?.url && !sources.some((x) => x.url === w.url)) sources.push({ label: String(w.label).slice(0, 80), url: String(w.url) });

   /* A connection that must be made once before it can do what was asked
      (SMS through Twilio): the page shows its own form for it. */
   const setup = results.find((r) => r.result?.setup)?.result.setup || null;

   return { answer: content, tools: used, model, rounds, grounded: true, pending, links, compose, card, files, charts: charts.slice(0, 4), reports: reports.slice(0, 1), form, setup, sources: sources.slice(0, 6), options: pending || form ? [] : options };
}
