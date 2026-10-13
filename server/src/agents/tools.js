/**
 * What the agent may do, as tools.
 *
 * Same shape as the staff assistant's tools ({ name, description,
 * parameters, run(args, ctx) }), and the two read tools ARE the staff
 * assistant's — availability and pricing come from the same code the
 * screens use, so the agent cannot disagree with them.
 *
 * The write tools here only touch the lead file in memory (ctx.leadFile)
 * and set flags on ctx; runtime.js persists and logs after the model is
 * done, so a turn that fails halfway leaves nothing half-written.
 */

import { toolByName } from '../services/assistant/tools.js';
import { transition, BUCKETS } from './buckets.js';

const shared = (name) => {
    const t = toolByName(name);
    if (!t) throw new Error(`The staff assistant no longer defines the ${name} tool`);
    return t;
};

const OWN_TOOLS = [
    {
        name: 'update_lead_file',
        description: 'Write down what the customer needs, as soon as you learn it. Only pass fields you actually learned; leave the rest out.',
        parameters: {
            type: 'object',
            properties: {
                sizeSqf: { type: 'number', description: 'Unit size they need, in sqft' },
                moveIn: { type: 'string', description: 'When they want to start, YYYY-MM-DD or their words' },
                durationWeeks: { type: 'number', description: 'How long, in weeks' },
                budget: { type: 'number', description: 'Monthly budget in AED, if stated' },
                storing: { type: 'string', description: 'What they are storing' },
                openQuestions: { type: 'array', items: { type: 'string' }, description: 'Questions still unanswered, either way' },
            },
        },
        async run(args, ctx) {
            const need = { ...ctx.leadFile.need };
            for (const k of ['sizeSqf', 'moveIn', 'durationWeeks', 'budget', 'storing']) {
                if (args[k] !== undefined && args[k] !== null && args[k] !== '') need[k] = args[k];
            }
            ctx.leadFile.need = need;
            if (Array.isArray(args.openQuestions)) ctx.leadFile.openQuestions = args.openQuestions.map(String).slice(0, 10);
            ctx.changes.leadFile = true;
            return { ok: true, need, openQuestions: ctx.leadFile.openQuestions };
        },
    },
    {
        name: 'note_offer',
        description: 'Record a unit and price you have just offered the customer, so it is never forgotten or contradicted later.',
        parameters: {
            type: 'object',
            properties: {
                unitNumber: { type: 'string' },
                monthlyPrice: { type: 'number' },
                from: { type: 'string', description: 'YYYY-MM-DD' },
                to: { type: 'string', description: 'YYYY-MM-DD' },
            },
            required: ['unitNumber', 'monthlyPrice'],
        },
        async run(args, ctx) {
            const offer = { unitNumber: String(args.unitNumber), monthlyPrice: Number(args.monthlyPrice), from: args.from || '', to: args.to || '', at: ctx.now };
            ctx.leadFile.offers = [...(ctx.leadFile.offers || []), offer].slice(-10);
            ctx.changes.offer = offer;
            return { ok: true, offers: ctx.leadFile.offers };
        },
    },
    {
        name: 'move_bucket',
        description: 'Move the lead along the follow-up lifecycle. Use quote_sent when you have given a full written quotation, declined when they say no, opt_out when they ask not to be contacted.',
        parameters: {
            type: 'object',
            properties: {
                event: { type: 'string', enum: ['quote_sent', 'declined', 'opt_out'] },
                why: { type: 'string' },
            },
            required: ['event'],
        },
        async run(args, ctx) {
            const r = transition(ctx.leadFile, args.event, { now: ctx.now, cadence: ctx.cadence });
            if (!r.changed) return { ok: false, bucket: ctx.leadFile.bucket, note: `${args.event} does not apply from ${BUCKETS[ctx.leadFile.bucket].label}` };
            ctx.changes.bucket = { event: args.event, why: args.why || '', from: ctx.leadFile.bucket, to: r.state.bucket, reason: r.reason };
            Object.assign(ctx.leadFile, r.state);
            return { ok: true, bucket: r.state.bucket, nextTouchAt: r.state.nextTouchAt };
        },
    },
    {
        name: 'propose_follow_up_template',
        description: 'For a follow-up touch only: choose which approved WhatsApp template to send, by exact name from the list you were given, and say what it is meant to achieve.',
        parameters: {
            type: 'object',
            properties: {
                templateName: { type: 'string' },
                intent: { type: 'string', description: 'e.g. check in, offer availability, ask if they still need storage' },
            },
            required: ['templateName', 'intent'],
        },
        async run(args, ctx) {
            const tpl = (ctx.templates || []).find((t) => t.name === args.templateName);
            if (!tpl) return { ok: false, error: `No approved template named "${args.templateName}". Choose from: ${(ctx.templates || []).map((t) => t.name).join(', ') || 'none configured'}` };
            ctx.changes.template = { name: tpl.name, language: tpl.language, bodyText: tpl.bodyText, intent: args.intent };
            return { ok: true, template: tpl.name };
        },
    },
    {
        name: 'escalate',
        description: 'Hand this conversation to a person. Use it for contracts, invoices, payments, complaints, discounts, anything you cannot confirm from the facts, or when the customer asks for a person.',
        parameters: {
            type: 'object',
            properties: { reason: { type: 'string', description: 'One sentence a colleague picking this up needs' } },
            required: ['reason'],
        },
        async run(args, ctx) {
            ctx.changes.escalate = String(args.reason || 'the agent asked for a person');
            return { ok: true };
        },
    },
];

export function agentTools(enabled) {
    const all = [shared('units_available'), shared('price_booking'), ...OWN_TOOLS];
    const on = new Set(enabled || all.map((t) => t.name));
    return all.filter((t) => on.has(t.name));
}

export function toOpenAiTools(defs) {
    return defs.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}
