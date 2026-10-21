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

import { usableFirstName, stripUnusableNames } from '../services/leadNames.js';
import { WhatsAppMessage, Lead } from '../models/index.js';
import { chatWithTools, openaiConfigured, openaiModel, resolveModel } from '../services/openai.js';
import { buildFacts, historyToMessages } from '../services/aiBot.js';
import { figuresGrounded } from '../services/assistant/index.js';
import { listWhatsAppTemplates } from '../services/whatsapp.js';
import { agentTools, toOpenAiTools } from './tools.js';
import { transition, describeStage, DEFAULT_CADENCE, BUCKETS } from './buckets.js';
import { record, snapshotOf } from './log.js';
import { AgentAction } from './models.js';
import { pushConfigured, pushToUser } from '../services/push.js';
import { windowOpen, customerWritesArabic, templatesForLanguage } from './guards.js';

const HISTORY_DAYS = 90;
const HISTORY_TURNS = 60;
// A very long message is one person's essay, not context worth paying for twice.
const MAX_LINE_CHARS = 500;

const MEDIA_NAME = {
    image: 'photo', video: 'video', audio: 'voice note', voice: 'voice note', document: 'document',
    sticker: 'sticker', location: 'location', contacts: 'contact card', template: 'template message',
    interactive: 'message with buttons',
};

const mediaNote = (who, kinds) => {
    const counts = new Map();
    for (const k of kinds) counts.set(k, (counts.get(k) || 0) + 1);
    const parts = [...counts].map(([name, n]) => (n > 1 ? `${n} ${name}s` : `a ${name}`));
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
    return `[${who} sent ${list}]`;
};

/**
 * The conversation as the agent reads it: everything either side sent, in
 * order, not only what happens to be plain text.
 *
 * It used to read text and transcripts alone, so a video, a photo or a
 * document our own team had sent simply did not exist for it — and neither
 * did the fact that a colleague had already greeted the customer, described
 * the sizes and asked what they were storing. It then asked those questions
 * again.
 *
 * Kept cheap on purpose: nothing is opened or described by a model. A file is
 * a few words saying who sent what, a run of files from one side collapses to
 * a single note ("[our team sent a video and 2 photos]"), and a voice note
 * only counts for its words if it was already transcribed.
 */
export function agentHistoryMessages(docs, inboundText) {
    const rows = [];
    for (const m of docs) {
        const words = String(m.text || m.transcript || '').trim().slice(0, MAX_LINE_CHARS);
        const name = m.type && m.type !== 'text' ? MEDIA_NAME[m.type] : '';
        const last = rows[rows.length - 1];
        if (name && !words) {
            if (last && last.media && last.direction === m.direction) last.media.push(name);
            else rows.push({ direction: m.direction, media: [name] });
        } else {
            rows.push({ direction: m.direction, text: name ? `[${m.direction === 'inbound' ? 'the customer' : 'our team'} sent a ${name}] ${words}` : words });
        }
    }
    return historyToMessages(rows.map((r) => ({
        direction: r.direction,
        text: r.media ? mediaNote(r.direction === 'inbound' ? 'the customer' : 'our team', r.media) : r.text,
    })), inboundText);
}

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
    '- Read the WHOLE conversation above before replying. Lines from "assistant" are what our team already told the customer, and notes like [our team sent a video] are things they have already received. Never repeat them, never ask what has already been answered, and never re-send information already given.',
    '- Keep a reply under 600 characters, written as a WhatsApp message.',
].join('\n');

/** Real corrections a person taught it from a rehearsal (insights.js's
 *  teachFromRehearsal) — the closest thing this prototype has to training,
 *  short of a fine-tune. Newest few only: enough to set a tone, not so many
 *  that the prompt balloons. */
function trainingExamplesBlock(agent) {
    const examples = (agent.trainingExamples || []).slice(0, 6);
    if (!examples.length) return '';
    return [
        'EXAMPLES OF REPLIES A PERSON CORRECTED — match this tone and phrasing when the situation is similar:',
        ...examples.map((e) => `- Customer: "${e.customerText}" → You: "${e.reply}"`),
    ].join('\n');
}

function leadFileBlock(file, lead, cadence) {
    const n = file.need || {};
    const lines = [
        'THE LEAD FILE:',
        (() => {
            const greet = usableFirstName(lead?.fullName) || usableFirstName(lead?.whatsappProfileName);
            return greet
                ? `- Name: ${greet} (you may use this name once, at most)`
                : '- Name: not known, or not a real name. Do NOT address them by any name — no "Hi X", no "Thanks, X".';
        })(),
        `- Bucket: ${BUCKETS[file.bucket]?.label || file.bucket}${describeStage(file, cadence) ? ` (${describeStage(file, cadence)})` : ''}`,
        `- Needs: ${[n.sizeSqf && `${n.sizeSqf} sqft`, n.moveIn && `from ${n.moveIn}`, n.durationWeeks && `${n.durationWeeks} weeks`, n.budget && `budget AED ${n.budget}/month`, n.storing && `storing ${n.storing}`].filter(Boolean).join(', ') || 'not yet known'}`,
        `- Offered so far: ${(file.offers || []).map((o) => `${o.unitNumber} at AED ${o.monthlyPrice}/month`).join('; ') || 'nothing yet'}`,
        `- Open questions: ${(file.openQuestions || []).join('; ') || 'none'}`,
        file.lastSummary ? `- Last read: ${file.lastSummary}` : '',
    ];
    return lines.filter(Boolean).join('\n');
}

/** What the CRM knows about this lead that the chat does not: the date and
 *  reason the follow-up was set for, what the rep has tried, and the deal-check
 *  answers. Only given to a follow-up turn, where it is the whole point. */
export function crmBlock(lead, now = new Date()) {
    if (!lead) return '';
    const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' });
    const attempts = lead.attempts || [];
    const last = attempts[attempts.length - 1];
    return [
        'WHAT OUR TEAM HAS RECORDED (from the CRM, not the chat):',
        lead.followUpAt ? `- Follow-up was set for ${fmt(lead.followUpAt)}${lead.followUpNote ? ` — reason: "${lead.followUpNote}"` : ''}` : '',
        lead.siteVisitAt ? `- Site visit: ${fmt(lead.siteVisitAt)}` : '',
        attempts.length ? `- ${attempts.length} contact attempt(s) logged${last ? `; the last, on ${fmt(last.at)}, was ${last.outcome}${last.note ? ` ("${String(last.note).slice(0, 160)}")` : ''}` : ''}` : '',
        lead.decisionMaker ? `- Decision maker: ${lead.decisionMaker}${lead.decisionMakerSpoken ? ' (our team has spoken to them)' : ' (not yet spoken to)'}` : '',
        lead.whyTheyWant ? `- Why they want it, in their words: "${lead.whyTheyWant}"` : '',
    ].filter(Boolean).join('\n');
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
 * @param trigger  { kind: 'inbound' | 'touch' | 'refresh' | 'simulate', text }
 * @returns the decision, already persisted and logged unless persist=false
 */
export async function runAgent({ agent, lead, leadFile, trigger, now = new Date(), persist = true }) {
    if (!openaiConfigured()) throw new Error('No AI provider is configured');
    const cadence = cadenceFor(agent);
    const before = snapshotOf(leadFile);
    const isFollowup = trigger.kind === 'followup';
    const isRefresh = trigger.kind === 'refresh';

    // Working copy: tools mutate this, nothing is saved until the end.
    const work = leadFile.toObject ? leadFile.toObject() : { ...leadFile };
    const ctx = { leadFile: work, lead, now, cadence, changes: {}, scope: null, templates: [] };

    // A rehearsal replays the past: history stops at the moment being
    // replayed, so the agent cannot see what happened next.
    const history = await WhatsAppMessage.find({
        phoneNormalized: leadFile.phoneNormalized,
        occurredAt: { $gte: new Date(now.getTime() - HISTORY_DAYS * 86_400_000), ...(trigger.until ? { $lte: new Date(trigger.until) } : {}) },
        deletedAt: null,
        type: { $ne: 'reaction' },
    }).sort({ occurredAt: -1 }).limit(HISTORY_TURNS).select('direction type text transcript occurredAt').lean();

    // A follow-up that falls due is a free-text message while the customer's
    // 24-hour window is open and an approved template once it has closed —
    // the same rule Meta applies, decided here so the draft is always one a
    // person can actually send.
    const lastInbound = history.find((m) => m.direction === 'inbound');
    const insideWindow = windowOpen(lastInbound?.occurredAt, now);
    const isTouch = trigger.kind === 'touch' || (isFollowup && !insideWindow);

    if (isTouch) {
        const { templates = [] } = await listWhatsAppTemplates().catch(() => ({ templates: [] }));
        // A touch only ever fills one variable — the customer's first name —
        // there is no person in this flow to supply anything past that, so a
        // template needing 2+ variables can never be sent correctly here and
        // must never be offered (offering it just turns into a WhatsApp
        // #132000 failure, or worse, a mismatched send).
        const usable = templates.filter((t) => t.status === 'APPROVED' && (Number(t.variableCount) || 0) <= 1).map((t) => ({ name: t.name, language: t.language, bodyText: t.bodyText, variableCount: t.variableCount }));
        ctx.templates = templatesForLanguage(usable, customerWritesArabic(history));
    }

    // A refresh is asked while the conversation may already have moved on, so
    // the customer's last message is not repeated at the end as if new: the
    // history already ends wherever the conversation really ends.
    const messages = agentHistoryMessages(history.reverse(), isTouch || isRefresh || isFollowup ? '' : trigger.text);

    const facts = await buildFacts(trigger.text || '', { useAvailability: true });

    const task = isFollowup && !isTouch
        ? 'TASK: the follow-up date our team set for this lead has arrived. Write the follow-up WhatsApp message to send now — pick up where the conversation and the recorded reason left off, refer to what the customer actually said they wanted or when they said they would decide, and end with one easy next step. Do not re-introduce yourself and do not repeat what has already been sent. Use tools for anything factual. Answer with JSON only: {"reply": string, "needsHuman": boolean, "reason": string, "summary": one line on where this lead stands}.'
        : isTouch
        ? [
            `TASK: ${isFollowup
                ? 'the follow-up date our team set for this lead has arrived and the 24-hour window is closed, so a template is needed. Choose the approved template that best fits the reason recorded in WHAT OUR TEAM HAS RECORDED'
                : `it is time for the ${describeStage(work, cadence) || 'next'} follow-up touch to this lead, who has not replied. Choose the approved template that fits this stage's intent (early: a friendly check-in; middle: offer what is available; last: ask if they still need storage)`} by calling propose_follow_up_template. Then answer with JSON: {"summary": one line on where this lead stands, "needsHuman": boolean, "reason": string}.`,
            `APPROVED TEMPLATES: ${ctx.templates.length ? ctx.templates.map((t) => `${t.name} — "${(t.bodyText || '').slice(0, 90)}"`).join(' | ') : 'none are configured; call escalate and explain that a template is needed'}`,
        ].join('\n')
        : isRefresh
            ? 'TASK: a colleague asked for a fresh suggestion because the conversation may have moved on. Read the WHOLE conversation above, including what our team has already sent since the customer last wrote (messages, videos, photos). Write the best next message from where the conversation stands NOW, without repeating anything already said or sent. If our team has already fully answered and nothing is waiting on us, set reply to an empty string and needsHuman false. Use tools for anything factual. Answer with JSON only: {"reply": string, "needsHuman": boolean, "reason": string, "summary": one line on where this lead stands}.'
            : 'TASK: answer the customer\'s latest message. Use tools for anything factual. Then answer with JSON only: {"reply": string, "needsHuman": boolean, "reason": string, "summary": one line on where this lead stands}.';

    const system = [
        String(agent.systemPrompt || '').trim() || 'You are the sales assistant for PurpleBox Storage in Dubai, replying to customers on WhatsApp. Be brief and warm.',
        leadFileBlock(work, lead, cadence),
        isFollowup ? crmBlock(lead, now) : '',
        'FACTS YOU MAY USE — everything below is from the live system:',
        facts.text || '(no unit data available)',
        RULES,
        trainingExamplesBlock(agent),
        task,
    ].filter(Boolean).join('\n\n');

    const defs = agentTools(agent.enabledTools);
    const tools = toOpenAiTools(defs);
    const convo = [...messages];
    const toolLog = [];
    const toolResults = [];
    let content = '';
    let usage = null;

    for (let round = 0; round <= (agent.maxToolRounds || 4); round++) {
        // A touch has no "just reply" option — the whole point of the turn
        // is to either propose a template or escalate. Forcing this only on
        // round 0 was not enough: the model can spend round 0 on an
        // exploratory tool (update_lead_file, move_bucket) and then answer
        // with bare JSON on round 1 without ever calling either — which is
        // what let a touch fall through to "no template chosen" even when
        // its own reasoning said a template fit fine. So keep forcing a
        // tool call every round until it has actually committed to one.
        const mustCommit = isTouch && !ctx.changes.template && !ctx.changes.escalate;
        const res = await chatWithTools({
            system, messages: convo, tools, model: agent.model || undefined, effort: agent.effort || undefined,
            temperature: 0.3, maxTokens: 700,
            toolChoice: mustCommit ? 'required' : 'auto',
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
    // Never greet by a name that is only an abbreviation or handle, even if the model did.
    const reply = isTouch ? '' : stripUnusableNames(String(decision.reply || '').trim(), lead).slice(0, 900);
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
        mode: agent.mode, trigger: trigger.kind, insideWindow, reply, needsHuman, reason, summary,
        template: ctx.changes.template || null,
        bucketBefore: before.bucket, bucketAfter: work.bucket,
        toolCalls: toolLog, grounded, model: resolveModel(agent.model), promptVersion: agent.promptVersion, usage,
    };
    if (!persist) return result;

    // ---- persist the working copy, then log what happened, in order ----
    const detail = {
        system, messages, toolCalls: toolLog, rawContent: content, model: result.model, promptVersion: agent.promptVersion, usage, grounded,
        // What the inbox shows and what "approve" sends: kept whole here,
        // since the summary line is truncated.
        customerText: isTouch ? '' : String(trigger.text || ''), reply, template: ctx.changes.template || null, trigger: trigger.kind,
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
                ? `(shadow) ${isFollowup ? 'Follow-up due: would send' : 'Would send'} "${ctx.changes.template.name}" — ${ctx.changes.template.intent}.${isFollowup ? '' : ` ${describeStage(before, cadence)}.`}`
                : `(shadow) Could not pick a template for ${describeStage(before, cadence)}: ${reason}`,
            detail, bucketBefore: before.bucket, bucketAfter: after.bucket, revertible: false, at: now,
        });
    } else {
        /* One suggestion per conversation: a newer draft replaces the ones
           still waiting, rather than stacking up four replies to the same
           chat for somebody to wade through. Retired as 'skipped', the same
           way answering the chat retires them. */
        if (reply && leadFile?._id) {
            await AgentAction.updateMany(
                { leadFile: leadFile._id, kind: 'reply_drafted', resolution: null },
                { $set: { resolution: 'skipped', resolvedAt: now, resolvedBy: null } },
            ).catch((e) => console.error('[agents] retiring old drafts:', e.message));
        }
        await record({
            agent, lead, leadFile, kind: 'reply_drafted',
            summary: reply ? `(shadow) ${isFollowup ? 'Follow-up due: would send' : 'Would reply'}: "${reply.slice(0, 120)}${reply.length > 120 ? '…' : ''}"` : `(shadow) No reply drafted: ${reason}`,
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
        // The person this agent hands to hears about it, rather than finding
        // it in the inbox whenever they next look.
        if (agent.escalateTo && pushConfigured()) {
            pushToUser(agent.escalateTo, {
                title: `${agent.name} needs you`,
                body: `${lead?.fullName || 'A lead'}: ${String(reason || '').slice(0, 140)}`,
                url: `/agents/leads/${lead?._id || ''}`,
                tag: `agent-handover-${lead?._id || ''}`,
            }).catch(() => null);
        }
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
