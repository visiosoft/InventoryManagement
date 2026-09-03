import {
    AiBotConfig, AiBotThread, WhatsAppMessage, Unit, Lead, Task, User,
} from '../models/index.js';
import { openaiConfigured, openaiModel, chatJson, parseAvailabilityQuery } from './openai.js';
import { computeUnitAvailability } from './unitAvailability.js';
import { sendWhatsAppText, whatsappSendConfigured } from './whatsapp.js';
import { understandMedia } from './mediaUnderstanding.js';

// WhatsApp only permits a free-form reply inside 24 hours of the customer's
// last message. Replying at 23h59 would race that limit and fail at Meta, so
// the assistant stops short of it and leaves the thread to a human.
const REPLY_WINDOW_HOURS = 23;

// How much of the conversation the model sees.
//
// Sized against the real inbox rather than guessed: across 200 conversations
// the median is 4 messages and the largest is 104, and because WhatsApp
// messages are short the biggest thread comes to roughly 340 tokens. Two
// hundred therefore holds every conversation here in full, at a cost not worth
// counting — and twelve, the original, was cutting real conversations in half.
const HISTORY_TURNS = 200;

// Past this, a conversation is not context, it is archaeology. Someone who
// asked about a 50 sqft unit last winter has different needs now, and feeding
// that back risks the assistant answering the old question.
const HISTORY_DAYS = 90;

// Message types that carry no question. A thumbs-up reaction, a system notice
// or something this WhatsApp version cannot render is not a customer asking
// for help — treating them as unreadable content handed whole conversations
// to a person and silenced the assistant on them for good.
const IGNORED_TYPES = new Set(['reaction', 'system', 'unsupported', 'ephemeral', 'sticker']);

/* What the assistant can make sense of itself: speech becomes text, a photo
   becomes a description. A video and a document still go to a person. */
const READABLE_TYPES = new Set(['audio', 'voice', 'image']);

// Real content a customer sent that the assistant genuinely cannot read, so a
// person should look at it.
const MEDIA_LABELS = {
    image: 'a photo',
    video: 'a video',
    audio: 'an audio message',
    voice: 'a voice note',
    document: 'a document',
    location: 'a location',
    contacts: 'a contact card',
    order: 'an order',
};

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

    const history = await WhatsAppMessage.find({
        phoneNormalized,
        type: 'text',
        text: { $ne: '' },
        occurredAt: { $gte: new Date(Date.now() - HISTORY_DAYS * 86_400_000) },
    })
        // Newest first with a limit takes the most recent slice; reversed below
        // so the model reads it in the order it happened.
        .sort({ occurredAt: -1 })
        .limit(HISTORY_TURNS)
        .select('direction text')
        .lean();

    const messages = history
        .reverse()
        .map((m) => ({ role: m.direction === 'inbound' ? 'user' : 'assistant', content: m.text }));

    // The message being answered must always be the last thing the model sees.
    // In production the webhook has usually stored it already, but depending on
    // that write ordering meant the model sometimes got no question at all and
    // just introduced itself.
    const text = String(inboundText || '').trim();
    const last = messages[messages.length - 1];
    if (text && !(last && last.role === 'user' && last.content === text)) {
        messages.push({ role: 'user', content: text });
    }

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
        '- Every factual claim must come from the facts above or from the instructions at the top. That covers prices, sizes and availability, and equally opening hours, the address, access arrangements, insurance, notice periods, deposits and payment terms.',
        '- If a detail is not given to you, say you will check and set needsHuman true. Never estimate, round, or fill in something plausible.',
        '- If the facts do not answer the question, set needsHuman true instead of guessing.',
        '- Never confirm a booking, hold a unit, agree a discount, or promise a refund.',
        '- For questions about an existing contract, invoice, payment or complaint, set needsHuman true.',
        '- If the customer asks for a person, set needsHuman true.',
        '- Read the conversation above before replying. Never ask for something the customer has already told you, and never re-introduce yourself in a conversation that has already started.',
        '- If your own last message already answered them and they have said nothing new, do not send a near-identical message again.',
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
export async function noteInboundForBot({ phoneNormalized, messageId, text, type, occurredAt, mediaId = '' }) {
    if (!phoneNormalized || !messageId) return;
    // Filtered here as well as in decideAction, so noise never even queues.
    if (IGNORED_TYPES.has(type)) return;
    await AiBotThread.findOneAndUpdate(
        { phoneNormalized },
        {
            $set: {
                pendingMessageId: messageId,
                pendingText: String(text || ''),
                pendingType: type || 'text',
                pendingMediaId: String(mediaId || ''),
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

    // Reactions and system notices are noise, not questions. They must be
    // ignored rather than handed over: escalating mutes the thread, so a
    // single thumbs-up would stop the assistant answering that customer again.
    const type = thread.pendingType || 'text';
    if (IGNORED_TYPES.has(type)) {
        return { action: 'skip', reason: `Ignoring a ${type}` };
    }

    /* A voice note or a photo is read rather than handed over on sight.
     *
     * Both used to escalate immediately, which meant somebody saying out loud
     * what they would otherwise have typed always waited for a colleague. The
     * reading happens in handleThread — it needs a network call, and this
     * function is deliberately pure so the rules can be tested directly.
     *
     * Everything else still goes to a person: a video is too much to read for
     * what it usually says, and a document is a contract or a receipt, which is
     * exactly the sort of thing the assistant must not answer for. */
    const text = String(thread.pendingText || '').trim();
    if (READABLE_TYPES.has(type)) {
        return { action: 'read', reason: `Customer sent ${MEDIA_LABELS[type] || `a ${type}`}` };
    }
    if (type !== 'text') {
        return { action: 'escalate', reason: `Customer sent ${MEDIA_LABELS[type] || `a ${type}`}, which the assistant cannot read` };
    }
    if (!text) {
        return { action: 'skip', reason: 'Ignoring an empty message' };
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

    // Claim the message atomically. The previous read-then-write let two
    // workers — a restarted instance overlapping itself, or a second
    // deployment against the same database — both pass this point and both
    // reply, which is how a customer received the same answer twice within
    // seconds. The update only matches while handledMessageId is still what we
    // read, so exactly one worker wins.
    const claimed = await AiBotThread.findOneAndUpdate(
        { _id: thread._id, handledMessageId: thread.handledMessageId },
        { $set: { handledMessageId: thread.pendingMessageId } },
        { new: true },
    );
    if (!claimed) { aiBotState.skipped += 1; return; }
    thread.handledMessageId = thread.pendingMessageId;

    // If our own message is the most recent thing in the thread, their question
    // has already been answered. Without this, a backlog of four messages from
    // one person produced four separate replies, each repeating the last.
    const newest = await WhatsAppMessage.findOne({ phoneNormalized: thread.phoneNormalized })
        .sort({ occurredAt: -1 }).select('direction occurredAt').lean();
    if (newest && newest.direction === 'outbound'
        && new Date(newest.occurredAt) >= new Date(thread.pendingAt || 0)) {
        aiBotState.skipped += 1;
        return;
    }

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

    /* Speech and photos: read first, then answer the reading.
     *
     * The transcript replaces the message text, so everything downstream — the
     * history, the rules, the reply itself — works on words exactly as if the
     * customer had typed them. A photo becomes a description rather than words
     * put in their mouth, and either can still come back "a person is needed",
     * which is what a receipt or a damaged item should do. */
    let inboundText = thread.pendingText || '';
    if (action === 'read') {
        const read = await understandMedia({
            kind: thread.pendingType,
            mediaId: thread.pendingMediaId,
            sentAt: thread.pendingAt,
        });
        if (read.needsHuman || !read.text) {
            await escalate(thread, read.reason || `${reason}, which needs a person`, config);
            aiBotState.escalated += 1;
            return;
        }
        inboundText = read.text;
        /* Kept on the record. A colleague reading the thread later sees what
           the assistant heard, not just that it answered something. */
        thread.pendingText = inboundText;
        await WhatsAppMessage.updateOne(
            { messageId: thread.pendingMessageId },
            { $set: { transcript: inboundText } },
        ).catch(() => {});
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

    /* Last look before it speaks.
     *
     * A colleague replying pauses the assistant, whether they type in the
     * console or answer from the WhatsApp app on their phone. What neither
     * covers is the few seconds this reply spent being written: a rep can
     * answer in that window, and the assistant would then say its piece on top
     * of them. Cheap to check, and the alternative is the assistant talking
     * over somebody in front of a customer. */
    const humanSince = await WhatsAppMessage.findOne({
        phoneNormalized: thread.phoneNormalized,
        direction: 'outbound',
        sentByAi: { $ne: true },
        occurredAt: { $gt: thread.pendingAt || new Date(0) },
    }).select('_id').lean();
    if (humanSince) {
        thread.handledMessageId = thread.pendingMessageId;
        thread.draftText = '';
        thread.draftAt = null;
        await thread.save();
        await pauseBotForHuman(thread.phoneNormalized);
        aiBotState.skipped += 1;
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
/** How many conversations are answered at once. Enough that a small rush is
 *  handled together, few enough not to trip OpenAI's rate limit. */
const AI_CONCURRENCY = 5;

/**
 * Run `work` over everything, `size` at a time.
 *
 * Promise.all over the lot would be simpler and would put twenty requests to
 * OpenAI in flight at once; a rate-limit rejection there means nobody gets
 * answered, which is worse than the fourth person waiting a moment.
 */
async function inBatches(items, size, work) {
    for (let i = 0; i < items.length; i += size) {
        await Promise.all(items.slice(i, i + size).map(work));
    }
}

export async function runAiBotTick() {
    try {
        const config = await getAiBotConfig();
        if (!config.enabled) return { skipped: 'disabled' };
        if (!openaiConfigured()) return { skipped: 'openai not configured' };

        const threads = await AiBotThread.find({
            pendingMessageId: { $ne: '' },
            $expr: { $ne: ['$pendingMessageId', '$handledMessageId'] },
        }).limit(20);

        /* Everybody waiting is answered at the same time.
         *
         * This used to await each conversation in turn, so four people who
         * messaged together were answered one after another — each waiting on
         * the previous person's call to the model, which takes a few seconds.
         * The fourth could wait the better part of a minute for a reply the
         * system had all the information to write immediately.
         *
         * The conversations are genuinely independent: each reads its own
         * history and writes only its own thread, so there is nothing to
         * serialise for correctness. Capped anyway, because twenty simultaneous
         * calls to OpenAI is a good way to be rate-limited and answer nobody.
         */
        await inBatches(threads, AI_CONCURRENCY, async (thread) => {
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
        });

        aiBotState.at = new Date().toISOString();
        return { considered: threads.length };
    } catch (err) {
        aiBotState.errors += 1;
        aiBotState.lastError = err?.message || 'unknown error';
        return { error: aiBotState.lastError };
    }
}
