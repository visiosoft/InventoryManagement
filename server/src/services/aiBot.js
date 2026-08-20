import {
    AiBotConfig, AiBotThread, WhatsAppMessage, Unit, Lead, Task, User,
} from '../models/index.js';
import { openaiConfigured, openaiModel, chatJson, parseAvailabilityQuery } from './openai.js';
import { computeUnitAvailability } from './unitAvailability.js';
import { sendWhatsAppText, whatsappSendConfigured } from './whatsapp.js';

// WhatsApp only permits a free-form reply inside 24 hours of the customer's
// last message. Replying at 23h59 would race that limit and fail at Meta, so
// the assistant stops short of it and leaves the thread to a human.
const REPLY_WINDOW_HOURS = 23;

// How much of the conversation the model sees. Enough for context, bounded so
// a long-running thread cannot grow the prompt without limit.
const HISTORY_TURNS = 12;

const DEFAULT_PROMPT = [
    'You are the assistant for PurpleBox Storage in Dubai, replying to customers on WhatsApp.',
    '',
    'Introduce yourself as PurpleBox\'s automated assistant in your first message of a conversation, and offer to pass the customer to a colleague whenever they would prefer one.',
    '',
    'Be brief and warm. WhatsApp messages should be a few short lines, not paragraphs.',
    'Answer questions about unit sizes, prices, availability and how renting works.',
    'For anything about an existing contract, an invoice, a payment or a complaint, hand over to a colleague.',
].join('\n');

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

/** The singleton config, created on first read so Settings always has a document. */
export async function getAiBotConfig() {
    let config = await AiBotConfig.findOne();
    if (!config) config = await AiBotConfig.create({ systemPrompt: DEFAULT_PROMPT });
    return config;
}

export { DEFAULT_PROMPT };

/**
 * What the assistant is allowed to state as fact. Everything here comes from
 * the database — the model is told to answer from this block and nothing else,
 * because a price or a free unit it invented is a commitment the business did
 * not make.
 */
export async function buildFacts(inboundText, config) {
    const units = await Unit.find({ status: { $ne: 'maintenance' } })
        .select('unitNumber floor sizeSqf price status')
        .lean();

    const floors = [...new Set(units.map((u) => u.floor).filter(Boolean))].sort();
    const sizes = [...new Set(units.map((u) => u.sizeSqf).filter((n) => Number(n) > 0))].sort((a, b) => a - b);

    // Price per size, as a range — the same size can be priced differently by
    // floor, and quoting a single number would be wrong half the time.
    const bySize = new Map();
    for (const u of units) {
        if (!(Number(u.sizeSqf) > 0)) continue;
        const row = bySize.get(u.sizeSqf) || { total: 0, prices: [] };
        row.total += 1;
        if (Number(u.price) > 0) row.prices.push(Number(u.price));
        bySize.set(u.sizeSqf, row);
    }

    const lines = [];
    lines.push('SIZES AND MONTHLY PRICES (AED):');
    for (const size of sizes) {
        const row = bySize.get(size);
        if (!row?.prices.length) { lines.push(`- ${size} sqft: price on request`); continue; }
        const min = Math.min(...row.prices);
        const max = Math.max(...row.prices);
        lines.push(`- ${size} sqft: ${min === max ? `AED ${min}` : `AED ${min}–${max}`} per month (${row.total} units)`);
    }
    if (floors.length) lines.push(`FLOORS: ${floors.join(', ')}`);

    let window = null;
    if (config.useAvailability && openaiConfigured()) {
        // Reuse the availability parser rather than asking this model to invent
        // dates: it validates floors and sizes against what the site really has.
        const parsed = await parseAvailabilityQuery(inboundText, { floors, sizes }).catch(() => null);
        const f = parsed?.filters;
        if (f?.from && f?.to) {
            const { allUnits, bookedUnitIds } = await computeUnitAvailability({
                from: new Date(f.from),
                to: new Date(f.to),
            });
            const freeBySize = new Map();
            for (const u of allUnits) {
                if (bookedUnitIds.has(String(u._id))) continue;
                if (f.floor && u.floor !== f.floor) continue;
                if (f.sizeSqf && Number(u.sizeSqf) !== f.sizeSqf) continue;
                freeBySize.set(u.sizeSqf, (freeBySize.get(u.sizeSqf) || 0) + 1);
            }
            window = { from: f.from, to: f.to, floor: f.floor, sizeSqf: f.sizeSqf };
            lines.push('', `AVAILABILITY for ${f.from} to ${f.to}${f.floor ? ` on floor ${f.floor}` : ''}:`);
            if (freeBySize.size === 0) {
                lines.push('- nothing free matching that request');
            } else {
                for (const [size, n] of [...freeBySize.entries()].sort((a, b) => a[0] - b[0])) {
                    lines.push(`- ${size} sqft: ${n} free`);
                }
            }
        }
    }

    return { text: lines.join('\n'), window, floors, sizes };
}

/**
 * Compose a reply. Returns `{ reply, needsHuman, reason }`; `needsHuman` is the
 * only honest outcome when the model fails, so every failure path sets it
 * rather than sending a guess or nothing at all.
 */
export async function generateReply({ phoneNormalized, inboundText, config }) {
    if (!openaiConfigured()) return { reply: '', needsHuman: true, reason: 'OpenAI is not configured' };

    const facts = await buildFacts(inboundText, config);

    const history = await WhatsAppMessage.find({ phoneNormalized, type: 'text', text: { $ne: '' } })
        .sort({ occurredAt: -1 })
        .limit(HISTORY_TURNS)
        .select('direction text')
        .lean();

    const messages = history
        .reverse()
        .map((m) => ({ role: m.direction === 'inbound' ? 'user' : 'assistant', content: m.text }));

    // The operator writes the voice; these rules are ours and are not editable
    // in Settings, because they are what keeps the assistant from committing
    // the business to something.
    const system = [
        String(config.systemPrompt || DEFAULT_PROMPT).trim(),
        '',
        'FACTS YOU MAY USE — everything below is from the live system:',
        facts.text || '(no unit data available)',
        '',
        'RULES:',
        '- Use only the facts above for any price, size or availability. Never estimate, round or invent one.',
        '- If the facts do not answer the question, set needsHuman true instead of guessing.',
        '- Never confirm a booking, hold a unit, agree a discount, or promise a refund.',
        '- For questions about an existing contract, invoice, payment or complaint, set needsHuman true.',
        '- If the customer asks for a person, set needsHuman true.',
        '- Keep the reply under 600 characters and write it as a WhatsApp message.',
        '',
        'Reply with JSON only: {"reply": string, "needsHuman": boolean, "reason": string}',
        'When needsHuman is true, `reason` says what a colleague needs to pick up, and `reply` may be a short holding message.',
    ].join('\n');

    let parsed;
    try {
        parsed = await chatJson({ system, messages, temperature: 0.3, maxTokens: 400 });
    } catch (err) {
        const detail = err?.response?.data?.error?.message || err?.message || 'unknown error';
        return { reply: '', needsHuman: true, reason: `OpenAI request failed: ${detail}` };
    }

    if (!parsed) return { reply: '', needsHuman: true, reason: 'The model did not return usable JSON' };

    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim().slice(0, 900) : '';
    const needsHuman = parsed.needsHuman === true || !reply;

    return {
        reply,
        needsHuman,
        reason: typeof parsed.reason === 'string' && parsed.reason.trim()
            ? parsed.reason.trim()
            : (needsHuman ? 'The assistant did not produce an answer' : ''),
        model: openaiModel(),
        facts: facts.text,
    };
}

/** Hand the thread to a person, with a task so it is not just a silent flag. */
async function escalate(thread, reason, config, draft = '') {
    thread.status = 'escalated';
    thread.escalatedAt = new Date();
    thread.escalationReason = reason;
    thread.draftText = draft;
    thread.draftAt = draft ? new Date() : null;

    const assignee = config.escalateTo
        ? await User.findById(config.escalateTo).select('_id name email isActive')
        : null;

    // Without a valid assignee there is no task to raise. The thread is still
    // escalated — the assistant must not carry on — and the reason records why
    // nobody was told, rather than failing silently.
    if (!assignee) {
        thread.lastError = 'No escalation assignee is set in Settings, so no task was created';
        await thread.save();
        return null;
    }

    const lead = await Lead.findOne({ phoneNormalized: thread.phoneNormalized }).select('_id fullName').lean();
    const recent = await WhatsAppMessage.find({ phoneNormalized: thread.phoneNormalized, type: 'text' })
        .sort({ occurredAt: -1 }).limit(6).select('direction text occurredAt').lean();

    const transcript = recent.reverse()
        .map((m) => `${m.direction === 'inbound' ? 'Customer' : 'Us'}: ${String(m.text).slice(0, 300)}`)
        .join('\n');

    const who = lead?.fullName || thread.phoneNormalized;
    const task = await Task.create({
        title: `WhatsApp needs a person — ${who}`,
        description: [`Reason: ${reason}`, '', `Number: ${thread.phoneNormalized}`, '', 'Recent messages:', transcript].join('\n'),
        assignedTo: assignee._id,
        createdByName: 'PurpleBox AI',
        leadId: lead?._id || null,
        leadType: lead ? 'storage' : null,
        leadName: who,
        priority: 'high',
        assignmentHistory: [{
            fromId: null, fromName: '',
            toId: assignee._id, toName: assignee.name || assignee.email,
            byId: null, byName: 'PurpleBox AI',
            reason: 'WhatsApp assistant escalation',
        }],
    });

    thread.escalationTask = task._id;
    thread.lastError = '';
    await thread.save();
    return task;
}

/** Record an inbound message for the worker to consider. Called by the webhook. */
export async function noteInboundForBot({ phoneNormalized, messageId, text, type, occurredAt }) {
    if (!phoneNormalized || !messageId) return;
    await AiBotThread.findOneAndUpdate(
        { phoneNormalized },
        {
            $set: {
                pendingMessageId: messageId,
                pendingText: String(text || ''),
                pendingType: type || 'text',
                pendingAt: occurredAt || new Date(),
            },
            $setOnInsert: { phoneNormalized },
        },
        { upsert: true },
    );
}

/**
 * A colleague replied by hand, so the assistant steps back for a while. Also
 * clears any draft, which is now stale — the human has already said something.
 */
export async function pauseBotForHuman(phoneNormalized) {
    if (!phoneNormalized) return;
    const config = await getAiBotConfig();
    const hours = Number(config.humanPauseHours) > 0 ? Number(config.humanPauseHours) : 12;
    await AiBotThread.findOneAndUpdate(
        { phoneNormalized },
        {
            $set: {
                status: 'paused',
                pausedUntil: new Date(Date.now() + hours * 3600_000),
                draftText: '',
                draftAt: null,
            },
            $setOnInsert: { phoneNormalized },
        },
        { upsert: true },
    );
}

/**
 * Whether to answer this message, hand it over, or leave it alone — decided
 * before anything is sent and without touching the database, so the rules that
 * keep the assistant out of trouble can be tested directly.
 *
 * Returns `{ action: 'skip' | 'escalate' | 'generate', reason }`.
 */
export function decideAction({ thread, config, now = new Date() }) {
    if (thread.status === 'escalated') {
        return { action: 'skip', reason: 'Already handed over to a person' };
    }
    if (thread.status === 'paused' && thread.pausedUntil && new Date(thread.pausedUntil) > now) {
        return { action: 'skip', reason: 'A colleague replied recently' };
    }

    const inboundAt = thread.pendingAt ? new Date(thread.pendingAt) : now;
    if ((now - inboundAt) / 3600_000 > REPLY_WINDOW_HOURS) {
        // `notable` because this one leaves a customer unanswered for a reason
        // nobody can see from the console — the others are the system working.
        return { action: 'skip', reason: 'Message is outside the 24-hour WhatsApp reply window', notable: true };
    }

    // Media carries meaning the assistant cannot read. Guessing at a photo of a
    // damaged item or a payment receipt would be worse than handing it over.
    const text = String(thread.pendingText || '').trim();
    if (thread.pendingType !== 'text') {
        return { action: 'escalate', reason: `Customer sent a ${thread.pendingType}, which the assistant cannot read` };
    }
    if (!text) {
        return { action: 'escalate', reason: 'Customer sent an empty message' };
    }

    // The budget resets when the date string changes, so a stale count from
    // yesterday never blocks today.
    const today = dayKey(now);
    const usedToday = thread.repliesOn === today ? Number(thread.repliesCount || 0) : 0;
    if (usedToday >= Number(config.maxRepliesPerThreadPerDay || 20)) {
        return { action: 'escalate', reason: `The assistant has already sent ${usedToday} replies to this number today` };
    }

    const lower = text.toLowerCase();
    const keyword = (config.handoverKeywords || []).find((k) => k && lower.includes(String(k).toLowerCase()));
    if (keyword) {
        return { action: 'escalate', reason: `Customer asked for a person ("${keyword}")` };
    }

    return { action: 'generate', reason: '' };
}

export const aiBotState = {
    at: null, considered: 0, drafted: 0, sent: 0, escalated: 0, skipped: 0, errors: 0, lastError: '',
};

async function handleThread(thread, config) {
    const now = new Date();

    // Claim the message before doing anything slow. If this process dies during
    // generation the message is already marked handled, so the customer gets
    // silence rather than the same reply twice.
    const inboundText = thread.pendingText;
    thread.handledMessageId = thread.pendingMessageId;
    await thread.save();

    const { action, reason, notable } = decideAction({ thread, config, now });

    if (action === 'skip') {
        thread.lastError = notable ? reason : '';
        await thread.save();
        aiBotState.skipped += 1;
        return;
    }

    if (action === 'escalate') {
        await escalate(thread, reason, config);
        aiBotState.escalated += 1;
        return;
    }

    // A pause that has run out is lifted only once we are actually going to
    // answer, so a skipped message does not silently resume the assistant.
    if (thread.status === 'paused') {
        thread.status = 'bot';
        thread.pausedUntil = null;
    }

    const today = dayKey(now);
    if (thread.repliesOn !== today) { thread.repliesOn = today; thread.repliesCount = 0; }

    const result = await generateReply({ phoneNormalized: thread.phoneNormalized, inboundText, config });

    if (result.needsHuman) {
        await escalate(thread, result.reason || 'The assistant was not confident', config, result.reply);
        aiBotState.escalated += 1;
        return;
    }

    if (config.mode === 'draft') {
        thread.draftText = result.reply;
        thread.draftAt = now;
        thread.lastError = '';
        await thread.save();
        aiBotState.drafted += 1;
        return;
    }

    if (!whatsappSendConfigured()) {
        thread.lastError = 'WhatsApp sending is not configured';
        await thread.save();
        aiBotState.errors += 1;
        return;
    }

    const sent = await sendWhatsAppText({ to: thread.phoneNormalized, body: result.reply });
    await WhatsAppMessage.create({
        messageId: sent?.messages?.[0]?.id || '',
        phone: thread.phoneNormalized,
        phoneNormalized: thread.phoneNormalized,
        direction: 'outbound',
        type: 'text',
        text: result.reply,
        status: 'sent',
        occurredAt: new Date(),
        sentByAi: true,
        raw: sent,
    });

    thread.repliesCount += 1;
    thread.draftText = '';
    thread.draftAt = null;
    thread.lastError = '';
    await thread.save();
    aiBotState.sent += 1;
}

/**
 * One pass over the threads with an unanswered message.
 *
 * This runs on an interval rather than inside the webhook: an OpenAI round trip
 * in front of Meta's ACK would make the webhook slow enough for Meta to retry
 * it, and the retry would produce a second reply. Waiting a few seconds also
 * means a customer who fires off three messages gets one considered answer.
 */
export async function runAiBotTick() {
    try {
        const config = await getAiBotConfig();
        if (!config.enabled) return { skipped: 'disabled' };
        if (!openaiConfigured()) return { skipped: 'openai not configured' };

        const threads = await AiBotThread.find({
            pendingMessageId: { $ne: '' },
            $expr: { $ne: ['$pendingMessageId', '$handledMessageId'] },
        }).limit(20);

        for (const thread of threads) {
            aiBotState.considered += 1;
            try {
                await handleThread(thread, config);
            } catch (err) {
                aiBotState.errors += 1;
                aiBotState.lastError = err?.message || 'unknown error';
                try {
                    thread.lastError = aiBotState.lastError;
                    await thread.save();
                } catch { /* the tick must survive a bad thread */ }
            }
        }

        aiBotState.at = new Date().toISOString();
        return { considered: threads.length };
    } catch (err) {
        aiBotState.errors += 1;
        aiBotState.lastError = err?.message || 'unknown error';
        return { error: aiBotState.lastError };
    }
}
