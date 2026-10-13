/**
 * Scheduled agents: the ones that run on a clock rather than when a
 * customer writes. A run reads what it needs through tools, sorts and
 * drafts, and leaves two things in the inbox for a person — a one-screen
 * report, and any drafts, each waiting for approve / edit / dismiss.
 * Nothing is sent from here.
 *
 * The first job is the executive assistant's morning: sort the inbox,
 * draft the replies. The email tools live here; a future bookkeeper or ads
 * manager is another tool pack on the same runner.
 */

import { chatWithTools, openaiConfigured, openaiModel } from '../services/openai.js';
import { listGmailInbox, readGmailMessage } from '../services/gmail.js';
import { figuresGrounded } from '../services/assistant/index.js';
import { buildFacts } from '../services/aiBot.js';
import { agentTools, toOpenAiTools } from './tools.js';
import { AgentProfile } from './models.js';
import { record } from './log.js';

/* ---------- pure: the clock ---------- */

const DUBAI_OFFSET_H = 4;
export function dubaiParts(now = new Date()) {
    const local = new Date(now.getTime() + DUBAI_OFFSET_H * 3600_000);
    return { hour: local.getUTCHours(), dayOfWeek: local.getUTCDay(), dayOfMonth: local.getUTCDate(), dayKey: local.toISOString().slice(0, 10) };
}

/** Whether a scheduled agent's moment has come and it has not run today. */
export function isDue(agent, now = new Date()) {
    if (agent.kind !== 'scheduled' || agent.mode === 'off' || agent.isActive === false) return false;
    const s = agent.schedule || {};
    if (!s.cadence || s.cadence === 'on_request') return false;
    const { hour, dayOfWeek, dayOfMonth, dayKey } = dubaiParts(now);
    if (agent.lastRunDay === dayKey) return false;
    if (hour !== Number(s.hour ?? 7)) return false;
    if (s.cadence === 'weekly' && dayOfWeek !== Number(s.dayOfWeek ?? 1)) return false;
    if (s.cadence === 'monthly' && dayOfMonth !== Number(s.dayOfMonth ?? 1)) return false;
    return true;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function describeSchedule(s) {
    if (!s || !s.cadence || s.cadence === 'on_request') return 'runs on request';
    const at = `${String(s.hour ?? 7).padStart(2, '0')}:00`;
    if (s.cadence === 'daily') return `runs daily at ${at}`;
    if (s.cadence === 'weekly') return `runs every ${DAYS[Number(s.dayOfWeek ?? 1)]} at ${at}`;
    return `runs on the ${Number(s.dayOfMonth ?? 1)}${['st', 'nd', 'rd'][Number(s.dayOfMonth ?? 1) - 1] || 'th'} of every month at ${at}`;
}

/* ---------- the email tool pack ---------- */

const CATEGORIES = ['lead', 'tenant', 'supplier', 'newsletter', 'spam', 'other'];

const EMAIL_TOOLS = [
    {
        name: 'list_inbox',
        description: 'The messages that arrived in the shared inbox recently — sender, subject, a one-line snippet. Start here.',
        parameters: { type: 'object', properties: { hours: { type: 'number', description: 'How far back, default 24' }, unreadOnly: { type: 'boolean', description: 'Default true' } } },
        async run(args) {
            const rows = await listGmailInbox({ hours: Number(args.hours) || 24, unreadOnly: args.unreadOnly !== false });
            return { count: rows.length, emails: rows.map((r) => ({ id: r.id, from: r.from, subject: r.subject, date: r.date, snippet: r.snippet })) };
        },
    },
    {
        name: 'read_email',
        description: 'The full text of one message, when the snippet is not enough to answer.',
        parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        async run(args, ctx) {
            const m = await readGmailMessage(String(args.id));
            ctx.read.set(m.id, m);
            return { id: m.id, from: m.from, subject: m.subject, date: m.date, text: m.text };
        },
    },
    {
        name: 'sort_email',
        description: 'File a message under a category with a one-line note for the report. Every message you looked at should be sorted.',
        parameters: { type: 'object', properties: { id: { type: 'string' }, category: { type: 'string', enum: CATEGORIES }, note: { type: 'string', description: 'What it is, in one line' } }, required: ['id', 'category', 'note'] },
        async run(args, ctx) {
            const item = { id: String(args.id), category: CATEGORIES.includes(args.category) ? args.category : 'other', note: String(args.note || '').slice(0, 200) };
            ctx.items.push(item);
            return { ok: true, sorted: ctx.items.length };
        },
    },
    {
        name: 'draft_reply',
        description: 'Draft a reply for a person to approve. Only for messages that deserve one: a lead, a tenant, a supplier with a question. Never for newsletters or spam.',
        parameters: { type: 'object', properties: { id: { type: 'string' }, to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string', description: 'Plain text, short, signed off as the company' }, why: { type: 'string', description: 'One line on what the sender wants' } }, required: ['id', 'to', 'subject', 'body', 'why'] },
        async run(args, ctx) {
            const d = { id: String(args.id), to: String(args.to || '').slice(0, 200), subject: String(args.subject || '').slice(0, 200), body: String(args.body || '').slice(0, 4000), why: String(args.why || '').slice(0, 200) };
            if (!d.to || !d.body) return { ok: false, error: 'A draft needs a recipient and a body' };
            ctx.drafts.push(d);
            return { ok: true, drafts: ctx.drafts.length };
        },
    },
    {
        name: 'flag_for_person',
        description: 'Something a person must handle themselves — a complaint, a legal notice, money, anything you cannot answer from the facts.',
        parameters: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] },
        async run(args, ctx) {
            ctx.items.push({ id: String(args.id), category: 'needs_person', note: String(args.why || '').slice(0, 200) });
            return { ok: true };
        },
    },
];

const JOB_RULES = [
    'RULES (not editable):',
    '- Nothing you draft is sent. A person reads every draft first. Write them as if they will be sent as-is, signed off as the company.',
    '- Every price, size, availability or policy claim must come from a tool result or the FACTS block. If it is not there, say a colleague will confirm, and flag it.',
    '- Never reply to newsletters, marketing or spam. Sort them and move on.',
    '- Money, contracts, complaints, legal notices, anything angry: flag_for_person, do not draft.',
    '- Sort every message you looked at. Finish with JSON only: {"summary": string (what came in and what you did, five lines at most), "needsHuman": boolean, "reason": string}.',
].join('\n');

function parseFinal(content) {
    const m = String(content || '').match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
    return { summary: String(content || '').slice(0, 800), needsHuman: false, reason: '' };
}

/**
 * One run of a scheduled agent. Persists a `report` action and one
 * `email_drafted` action per draft, then stamps lastRunAt. Never sends.
 */
export async function runJob({ agent, now = new Date(), reason = 'schedule' }) {
    if (!openaiConfigured()) throw new Error('OpenAI is not configured');
    const enabled = new Set(agent.enabledTools || []);
    const defs = [...agentTools(agent.enabledTools).filter((t) => ['units_available', 'price_booking', 'escalate'].includes(t.name)), ...EMAIL_TOOLS.filter((t) => enabled.has(t.name))];
    const tools = toOpenAiTools(defs);
    const ctx = { items: [], drafts: [], read: new Map(), changes: {}, now, leadFile: { need: {}, offers: [], openQuestions: [] }, cadence: {}, templates: [] };
    const facts = await buildFacts('', { useAvailability: false });
    const system = [
        String(agent.systemPrompt || '').trim() || `You are ${agent.name}, an assistant at PurpleBox Storage in Dubai.`,
        `TODAY'S TASK:\n${String(agent.task || '').trim() || 'Go through what arrived in the inbox since yesterday. Sort every message. Draft a reply for each one that deserves an answer. Flag anything a person must handle.'}`,
        'FACTS YOU MAY USE — everything below is from the live system:',
        facts.text || '(no unit data available)',
        JOB_RULES,
    ].join('\n\n');

    const convo = [{ role: 'user', content: `It is ${now.toLocaleString('en-GB', { timeZone: 'Asia/Dubai' })} in Dubai. Begin.` }];
    const toolLog = [];
    const toolResults = [];
    let content = '';
    let usage = null;
    const maxRounds = Math.max(4, (agent.maxToolRounds || 4) * 3); // a run reads many messages
    for (let round = 0; round <= maxRounds; round++) {
        const res = await chatWithTools({ system, messages: convo, tools, model: agent.model || undefined, temperature: 0.2, maxTokens: 900, timeout: 60_000, toolChoice: round === 0 ? 'required' : 'auto' });
        usage = res.usage || usage;
        if (!res.toolCalls.length) { content = res.content; break; }
        convo.push(res.message);
        for (const call of res.toolCalls) {
            const def = defs.find((d) => d.name === call.name);
            let result;
            try { result = def ? await def.run(call.args || {}, ctx) : { error: `unknown tool ${call.name}` }; } catch (e) { result = { error: e.message }; }
            toolLog.push({ name: call.name, args: call.args, result: call.name === 'read_email' ? { ...result, text: String(result.text || '').slice(0, 300) } : result });
            toolResults.push(result);
            convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
        if (round === maxRounds) content = '{"summary":"Ran out of tool rounds before finishing.","needsHuman":true,"reason":"Ran out of tool rounds"}';
    }
    const final = parseFinal(content);
    const summary = String(final.summary || '').slice(0, 1200);
    const model = agent.model || openaiModel();

    const reportRow = await record({
        agent, kind: 'report',
        summary: `${agent.name}'s ${reason === 'schedule' ? describeSchedule(agent.schedule).replace(/^runs /, '') : 'run'}: ${ctx.items.length} sorted, ${ctx.drafts.length} draft${ctx.drafts.length === 1 ? '' : 's'}, ${ctx.items.filter((i) => i.category === 'needs_person').length} for a person`,
        detail: { summary, items: ctx.items, draftCount: ctx.drafts.length, toolCalls: toolLog, model, promptVersion: agent.promptVersion, usage, needsHuman: Boolean(final.needsHuman), reason: String(final.reason || '') },
        at: now,
    });

    for (const d of ctx.drafts) {
        const grounded = figuresGrounded(d.body, [...toolResults, { facts: facts.text }]);
        const src = ctx.read.get(d.id);
        await record({
            agent, kind: 'email_drafted',
            summary: `(shadow) Would reply to ${d.to} — ${d.why}`,
            detail: { emailId: d.id, threadId: src?.threadId || '', to: d.to, subject: d.subject, body: d.body, why: d.why, from: src?.from || '', originalSubject: src?.subject || '', customerText: (src?.text || '').slice(0, 1500), grounded, model, promptVersion: agent.promptVersion, report: reportRow._id },
            at: now,
        });
    }

    const parts = dubaiParts(now);
    await AgentProfile.updateOne({ _id: agent._id }, { $set: { lastRunAt: now, lastRunDay: parts.dayKey } });
    return { summary, sorted: ctx.items.length, drafts: ctx.drafts.length, needsHuman: Boolean(final.needsHuman), reason: final.reason || '', report: reportRow._id };
}
