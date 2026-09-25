/**
 * One turn of an agent: read the lead file, gather the facts, call the
 * model with its tools, run what it asks for, check its numbers, and hand
 * back a decision. Persisting and logging happen once, at the end, so a
 * turn that fails halfway leaves nothing half-written.
 *
 * Shadow mode is the only mode the prototype knows: nothing here sends a
 * message. A reply becomes a `reply_drafted` action; a follow-up becomes a
 * `touch_proposed` action naming the approved template it would have used.
 */

import { WhatsAppMessage, Lead } from '../models/index.js';
import { chatWithTools, openaiConfigured, openaiModel } from '../services/openai.js';
import { buildFacts, historyToMessages } from '../services/aiBot.js';
import { figuresGrounded } from '../services/assistant/index.js';
import { listWhatsAppTemplates } from '../services/whatsapp.js';
import { agentTools, toOpenAiTools } from './tools.js';
import { transition, describeStage, DEFAULT_CADENCE, BUCKETS } from './buckets.js';
import { record, snapshotOf } from './log.js';

const HISTORY_DAYS = 90;
const HISTORY_TURNS = 60;

export function cadenceFor(agent) {
    const out = { ...DEFAULT_CADENCE };
    for (const k of Object.keys(DEFAULT_CADENCE)) {
        const own = agent?.cadence?.[k];
        if (Array.isArray(own) && own.length) out[k] = own.map(Number).filter((n) => n > 0);
    }
    return out;
}

const RULES = [
    'RULES (not editable, they are what keeps you from committing the business to something):',
    '- Every factual claim must come from the FACTS block or from a tool result. Prices, sizes, availability, opening hours, deposits, terms: if it is not there, say you will check and call escalate.',
    '- Never confirm a booking, hold a unit, agree a discount, or promise a refund. Never state a price you did not get from price_booking or the FACTS block.',
    '- Read THE LEAD FILE first. Never ask for something already in it. Never re-introduce yourself in a conversation that has started.',
    '- The moment you learn what they need, call update_lead_file. The moment you offer a unit and price, call note_offer.',
    '- Contracts, invoices, payments, complaints, discounts, or a request for a person: call escalate.',
    '- Keep a reply under 600 characters, written as a WhatsApp message.',
].join('\n');

function leadFileBlock(file, lead, cadence) {
    const n = file.need || {};
    const lines = [
        'THE LEAD FILE:',
        `- Name: ${lead?.fullName || 'unknown'}`,
        `- Bucket: ${BUCKETS[file.bucket]?.label || file.bucket}${describeStage(file, cadence) ? ` (${describeStage(file, cadence)})` : ''}`,
        `- Needs: ${[n.sizeSqf && `${n.sizeSqf} sqft`, n.moveIn && `from ${n.moveIn}`, n.durationWeeks && `${n.durationWeeks} weeks`, n.budget && `budget AED ${n.budget}/month`, n.storing && `storing ${n.storing}`].filter(Boolean).join(', ') || 'not yet known'}`,
        `- Offered so far: ${(file.offers || []).map((o) => `${o.unitNumber} at AED ${o.monthlyPrice}/month`).join('; ') || 'nothing yet'}`,
        `- Open questions: ${(file.openQuestions || []).join('; ') || 'none'}`,
        file.lastSummary ? `- Last read: ${file.lastSummary}` : '',
    ];
    return lines.filter(Boolean).join('\n');
}

function parseDecision(content) {
    const text = String(content || '').trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
        try { return JSON.parse(m[0]); } catch { /* fall through */ }
    }
    return { reply: text, needsHuman: false, reason: '' };
}

/**
 * @param trigger  { kind: 'inbound' | 'touch' | 'simulate', text }
 * @returns the decision, already persisted and logged unless persist=false
 */
export async function runAgent({ agent, lead, leadFile, trigger, now = new Date(), persist = true }) {
    if (!openaiConfigured()) throw new Error('OpenAI is not configured');
    const cadence = cadenceFor(agent);
    const before = snapshotOf(leadFile);
    const isTouch = trigger.kind === 'touch';

    // Working copy: tools mutate this, nothing is saved until the end.
    const work = leadFile.toObject ? leadFile.toObject() : { ...leadFile };
    const ctx = { leadFile: work, lead, now, cadence, changes: {}, scope: null, templates: [] };

    if (isTouch) {
        const { templates = [] } = await listWhatsAppTemplates().catch(() => ({ templates: [] }));
        ctx.templates = templates.filter((t) => t.status === 'APPROVED').map((t) => ({ name: t.name, language: t.language, bodyText: t.bodyText, variableCount: t.variableCount }));
    }

    // A rehearsal replays the past: history stops at the moment being
    // replayed, so the agent cannot see what happened next.
    const history = await WhatsAppMessage.find({
        phoneNormalized: leadFile.phoneNormalized,
        occurredAt: { $gte: new Date(now.getTime() - HISTORY_DAYS * 86_400_000), ...(trigger.until ? { $lte: new Date(trigger.until) } : {}) },
        $or: [{ type: 'text', text: { $ne: '' } }, { transcript: { $ne: '' } }],
    }).sort({ occurredAt: -1 }).limit(HISTORY_TURNS).select('direction text transcript').lean();
    const messages = historyToMessages(history.reverse(), isTouch ? '' : trigger.text);

    const facts = await buildFacts(trigger.text || '', { useAvailability: true });

    const task = isTouch
        ? [
            `TASK: it is time for the ${describeStage(work, cadence) || 'next'} follow-up touch to this lead, who has not replied. Choose the approved template that fits this stage's intent (early: a friendly check-in; middle: offer what is available; last: ask if they still need storage) by calling propose_follow_up_template. Then answer with JSON: {"summary": one line on where this lead stands, "needsHuman": boolean, "reason": string}.`,
            `APPROVED TEMPLATES: ${ctx.templates.length ? ctx.templates.map((t) => `${t.name} — "${(t.bodyText || '').slice(0, 90)}"`).join(' | ') : 'none are configured; call escalate and explain that a template is needed'}`,
        ].join('\n')
        : 'TASK: answer the customer\'s latest message. Use tools for anything factual. Then answer with JSON only: {"reply": string, "needsHuman": boolean, "reason": string, "summary": one line on where this lead stands}.';

    const system = [
        String(agent.systemPrompt || '').trim() || 'You are the sales assistant for PurpleBox Storage in Dubai, replying to customers on WhatsApp. Be brief and warm.',
        leadFileBlock(work, lead, cadence),
        'FACTS YOU MAY USE — everything below is from the live system:',
        facts.text || '(no unit data available)',
        RULES,
        task,
    ].join('\n\n');

    const defs = agentTools(agent.enabledTools);
    const tools = toOpenAiTools(defs);
    const convo = [...messages];
    const toolLog = [];
    const toolResults = [];
    let content = '';
    let usage = null;

    for (let round = 0; round <= (agent.maxToolRounds || 4); round++) {
        const res = await chatWithTools({
            system, messages: convo, tools, model: agent.model || undefined,
            temperature: 0.3, maxTokens: 700,
            toolChoice: round === 0 && !isTouch && messages.length > 0 ? 'auto' : 'auto',
        });
        usage = res.usage || usage;
        if (!res.toolCalls.length) { content = res.content; break; }
        convo.push(res.message);
        for (const call of res.toolCalls) {
            const def = defs.find((d) => d.name === call.name);
            let result;
            try {
                result = def ? await def.run(call.args || {}, ctx) : { error: `unknown tool ${call.name}` };
            } catch (e) {
                result = { error: e.message };
            }
            toolLog.push({ name: call.name, args: call.args, result });
            toolResults.push(result);
            convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
        if (round === (agent.maxToolRounds || 4)) content = '{"reply":"","needsHuman":true,"reason":"Ran out of tool rounds without answering"}';
    }

    const decision = parseDecision(content);
    const reply = isTouch ? '' : String(decision.reply || '').trim().slice(0, 900);
    let needsHuman = decision.needsHuman === true || Boolean(ctx.changes.escalate);
    let reason = ctx.changes.escalate || String(decision.reason || '').trim();

    // The same check the staff assistant makes: a number in the reply that
    // no tool or fact produced is a number the agent invented.
    const grounded = reply ? figuresGrounded(reply, [...toolResults, { facts: facts.text }]) : { ok: true, loose: [] };
    if (!grounded.ok) {
        needsHuman = true;
        reason = reason || `Reply contained figures not backed by a tool result: ${grounded.loose.join(', ')}`;
    }
    if (isTouch && !ctx.changes.template && !needsHuman) {
        needsHuman = true;
        reason = reason || 'No approved template was chosen for this touch';
    }

    const summary = String(decision.summary || '').trim().slice(0, 200);
    const result = {
        mode: agent.mode, trigger: trigger.kind, reply, needsHuman, reason, summary,
        template: ctx.changes.template || null,
        bucketBefore: before.bucket, bucketAfter: work.bucket,
        toolCalls: toolLog, grounded, model: agent.model || openaiModel(), promptVersion: agent.promptVersion, usage,
    };
    if (!persist) return result;

    // ---- persist the working copy, then log what happened, in order ----
    const detail = {
        system, messages, toolCalls: toolLog, rawContent: content, model: result.model, promptVersion: agent.promptVersion, usage, grounded,
        // What the inbox shows and what "approve" sends: kept whole here,
        // since the summary line is truncated.
        customerText: isTouch ? '' : String(trigger.text || ''), reply, template: ctx.changes.template || null,
    };
    const apply = (fields) => { for (const [k, v] of Object.entries(fields)) leadFile[k] = v; };

    if (ctx.changes.leadFile) {
        apply({ need: work.need, openQuestions: work.openQuestions });
    }
    if (ctx.changes.offer) apply({ offers: work.offers });
    if (summary) apply({ lastSummary: summary });

    if (ctx.changes.bucket) {
        apply({ bucket: work.bucket, previousBucket: work.previousBucket, touchCount: work.touchCount, anchorAt: work.anchorAt, nextTouchAt: work.nextTouchAt });
    }
    if (needsHuman) {
        const r = transition(leadFile, 'escalate', { now, cadence });
        if (r.changed) apply(r.state);
    }
    await leadFile.save();
    const after = snapshotOf(leadFile);

    if (ctx.changes.leadFile || ctx.changes.offer) {
        await record({
            agent, lead, leadFile, kind: ctx.changes.offer ? 'offer_noted' : 'lead_file_updated',
            summary: ctx.changes.offer
                ? `Offered ${ctx.changes.offer.unitNumber} at AED ${ctx.changes.offer.monthlyPrice}/month`
                : `Updated the lead file: ${Object.entries(work.need || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ') || 'open questions'}`,
            bucketBefore: before.bucket, bucketAfter: after.bucket, snapshotBefore: before, snapshotAfter: after, revertible: true, at: now,
        });
    }
    if (ctx.changes.bucket) {
        await record({
            agent, lead, leadFile, kind: 'bucket_moved',
            summary: `Moved ${BUCKETS[ctx.changes.bucket.from]?.label} → ${BUCKETS[ctx.changes.bucket.to]?.label}: ${ctx.changes.bucket.reason}${ctx.changes.bucket.why ? ` (${ctx.changes.bucket.why})` : ''}`,
            bucketBefore: ctx.changes.bucket.from, bucketAfter: ctx.changes.bucket.to, snapshotBefore: before, snapshotAfter: after, revertible: true, at: now,
        });
    }
    if (isTouch) {
        await record({
            agent, lead, leadFile, kind: 'touch_proposed',
            summary: ctx.changes.template
                ? `(shadow) Would send "${ctx.changes.template.name}" — ${ctx.changes.template.intent}. ${describeStage(before, cadence)}.`
                : `(shadow) Could not pick a template for ${describeStage(before, cadence)}: ${reason}`,
            detail, bucketBefore: before.bucket, bucketAfter: after.bucket, revertible: false, at: now,
        });
    } else {
        await record({
            agent, lead, leadFile, kind: 'reply_drafted',
            summary: reply ? `(shadow) Would reply: "${reply.slice(0, 120)}${reply.length > 120 ? '…' : ''}"` : `(shadow) No reply drafted: ${reason}`,
            detail, bucketBefore: before.bucket, bucketAfter: after.bucket, revertible: false, at: now,
        });
    }
    if (needsHuman) {
        await record({
            agent, lead, leadFile, kind: 'escalated',
            summary: `Handed to a person: ${reason}`,
            detail: { need: leadFile.need, offers: leadFile.offers, openQuestions: leadFile.openQuestions, lastSummary: leadFile.lastSummary },
            bucketBefore: before.bucket, bucketAfter: after.bucket, snapshotBefore: before, snapshotAfter: after, revertible: true, at: now,
        });
    }
    return result;
}

/** Lead basics the runtime needs, by id or phone. */
export async function findLead({ leadId, phone }) {
    if (leadId) return Lead.findById(leadId).lean();
    const phoneNormalized = String(phone || '').replace(/\D/g, '');
    if (!phoneNormalized) return null;
    return Lead.findOne({ phoneNormalized }).sort({ createdAt: -1 }).lean();
}
