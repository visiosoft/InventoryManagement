import { Router } from 'express';
import { mediaFromRaw } from './whatsappMedia.js';
import { WhatsAppMessage, Lead, Customer, User, AiBotThread, WhatsAppLabel, WhatsAppChatLabel, MessageTemplate } from '../models/index.js';
import { sendWhatsAppText, sendWhatsAppMedia, sendWhatsAppLocation, uploadWhatsAppMedia, whatsappMediaKind, whatsappSendConfigured, whatsappSendMissing } from '../services/whatsapp.js';
import { pauseBotForHuman } from '../services/aiBot.js';
import { containerMismatch, needsRemux, webmToOggOpus } from '../services/audioRemux.js';
import multer from 'multer';
import { createLeadFromWhatsAppPhone } from '../services/whatsappLeadSync.js';
import { summariseConversation, summariseRecent } from '../services/conversationSummary.js';
import { ensureDigest, dayKeyFor, previousDay } from '../services/dailyDigest.js';
import { DailyDigest } from '../models/index.js';
import { askInbox } from '../services/inboxAsk.js';

const router = Router();

/** A name the sync invented, not one a person gave us. */
const isPlaceholderLeadName = (n) => !n || /^whatsapp\s*contact/i.test(String(n).trim());


/**
 * The WhatsApp thread belonging to a customer, for the Chat tab on a contract.
 *
 * Resolved here rather than in the browser because the numbers are stored
 * inconsistently — +971…, 0…, 971… — so matching is done on the last nine
 * digits, the same rule the inbox and the Zoho matcher already use. A customer
 * can have several numbers; whichever has been messaged most recently wins.
 */
router.get('/customer-thread/:customerId', async (req, res) => {
    const customer = await Customer.findById(req.params.customerId).select('fullName phone phones').lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const suffixes = [...(customer.phones || []), customer.phone]
        .map((p) => String(p || '').replace(/\D/g, ''))
        .filter((d) => d.length >= 9)
        .map((d) => d.slice(-9));

    if (suffixes.length === 0) {
        return res.json({ phoneNormalized: '', numbersTried: [], messages: [] });
    }

    const unique = [...new Set(suffixes)];
    const match = { $or: unique.map((sfx) => ({ phoneNormalized: { $regex: `${sfx}$` } })) };

    // Which of their numbers actually has a conversation, most recent first.
    const newest = await WhatsAppMessage.findOne(match).sort({ occurredAt: -1 }).select('phoneNormalized').lean();
    if (!newest) return res.json({ phoneNormalized: '', numbersTried: unique, messages: [] });

    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 300);
    const messages = await WhatsAppMessage.find({ phoneNormalized: newest.phoneNormalized })
        .sort({ occurredAt: -1 })
        .limit(limit)
        .lean();

    res.json({
        phoneNormalized: newest.phoneNormalized,
        numbersTried: unique,
        messages: messages.map((m) => {
            const media = mediaFromRaw(m.raw);
            const { raw, ...rest } = m;
            return media
                ? { ...rest, media: { kind: media.kind, mimeType: media.mimeType, filename: media.filename, caption: media.caption, link: media.link ?? '' } }
                : rest;
        }),
    });
});

// ── Chat labels ──────────────────────────────────────────────────────────────
// Named tags a person puts on a conversation, the way the WhatsApp Business
// app does, so a chat can be found again later.

router.get('/labels', async (_req, res) => {
    const labels = await WhatsAppLabel.find({}).sort({ sortOrder: 1, name: 1 }).lean();
    // How many chats carry each one, so an unused label is obvious.
    const counts = await WhatsAppChatLabel.aggregate([
        { $unwind: '$labels' },
        { $group: { _id: '$labels', n: { $sum: 1 } } },
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json(labels.map((l) => ({ ...l, chatCount: byId.get(String(l._id)) || 0 })));
});

router.post('/labels', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'A label name is required' });
    const existing = await WhatsAppLabel.findOne({ name });
    if (existing) return res.status(409).json({ error: `There is already a label called "${name}"` });
    const label = await WhatsAppLabel.create({
        name,
        color: String(req.body?.color || '#5B2BC9'),
        sortOrder: Number(req.body?.sortOrder) || 0,
    });
    res.status(201).json({ ...label.toObject(), chatCount: 0 });
});

router.patch('/labels/:id', async (req, res) => {
    const label = await WhatsAppLabel.findById(req.params.id);
    if (!label) return res.status(404).json({ error: 'Label not found' });
    if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim();
        if (!name) return res.status(400).json({ error: 'A label name is required' });
        const clash = await WhatsAppLabel.findOne({ name, _id: { $ne: label._id } });
        if (clash) return res.status(409).json({ error: `There is already a label called "${name}"` });
        label.name = name;
    }
    if (req.body?.color !== undefined) label.color = String(req.body.color);
    if (req.body?.sortOrder !== undefined) label.sortOrder = Number(req.body.sortOrder) || 0;
    await label.save();
    res.json(label);
});

router.delete('/labels/:id', async (req, res) => {
    const label = await WhatsAppLabel.findById(req.params.id);
    if (!label) return res.status(404).json({ error: 'Label not found' });
    // Take it off every chat too, or those chats keep a reference to nothing.
    await WhatsAppChatLabel.updateMany({ labels: label._id }, { $pull: { labels: label._id } });
    await label.deleteOne();
    res.json({ ok: true });
});

// Set the labels on one conversation — the whole set, not a delta, so the
// picker can send exactly what is ticked.
router.put('/conversations/:phoneNormalized/labels', async (req, res) => {
    const phoneNormalized = String(req.params.phoneNormalized || '').replace(/\D/g, '');
    if (!phoneNormalized) return res.status(400).json({ error: 'A phone number is required' });

    const wanted = Array.isArray(req.body?.labelIds) ? req.body.labelIds.map(String) : [];
    // Only ids that still exist, so a label deleted in another tab cannot be
    // written back onto a chat.
    const valid = await WhatsAppLabel.find({ _id: { $in: wanted } }).select('_id').lean();
    const labels = valid.map((l) => l._id);

    await WhatsAppChatLabel.findOneAndUpdate(
        { phoneNormalized },
        { $set: { labels }, $setOnInsert: { phoneNormalized } },
        { upsert: true },
    );
    res.json({ ok: true, labels: labels.map(String) });
});

router.get('/messages', async (req, res) => {
    const phone = String(req.query.phone || '').trim();
    const q = {};

    if (phone) {
        q.phoneNormalized = phone.replace(/\D/g, '');
    }

    /* One conversation comes back whole.
     *
     * The limit defaulted to 100 for both cases, so opening a chat with more
     * than a hundred messages silently dropped its oldest ones. The history was
     * in the database the whole time — it was simply never sent. A single
     * thread is naturally bounded, so it gets a ceiling high enough not to bite
     * rather than a page size.
     *
     * The whole-inbox feed keeps a small one: it drives unread counts and the
     * ping, and does not need every message ever sent to do that.
     */
    const limit = phone
        ? Math.min(Math.max(Number(req.query.limit) || 2000, 1), 5000)
        : Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    /* No populate on `lead` here.
     *
     * It resolved a lead onto every message and nothing ever read it — the
     * console decides which lead a thread belongs to by phone number, not by
     * the id stored on a message, precisely because that id goes stale. It
     * cost an extra round trip on the endpoint polled hardest in the app. */
    const messages = await WhatsAppMessage.find(q)
        .sort({ occurredAt: -1, createdAt: -1 })
        .limit(limit)
        .lean();

    // Attachments are described inside the stored webhook payload. Surface a
    // small descriptor so the client can render the right element without
    // shipping the whole raw payload to the browser.
    res.json(messages.map((m) => {
        const media = mediaFromRaw(m.raw);
        const { raw, ...rest } = m;
        return media
            ? { ...rest, media: { kind: media.kind, mimeType: media.mimeType, filename: media.filename, caption: media.caption, link: media.link ?? '' } }
            : rest;
    }));
});

/**
 * Delete one of our own messages from this console.
 *
 * Meta's Cloud API has no unsend endpoint — a business-sent WhatsApp message
 * cannot be recalled from the customer's phone, only a person's own WhatsApp
 * app can do that. This removes it from our record: the bubble collapses to
 * "This message was deleted", same as when a customer revokes one of theirs.
 * Restricted to outbound messages, so a colleague can correct a mistake of
 * their own without anyone being able to erase what a customer actually said.
 */
router.delete('/messages/:id', async (req, res) => {
    const message = await WhatsAppMessage.findById(req.params.id);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.direction !== 'outbound') {
        return res.status(400).json({ error: 'Only messages we sent can be deleted here' });
    }
    if (message.deletedAt) return res.json(message);
    message.deletedAt = new Date();
    await message.save();
    res.json(message);
});

/**
 * The conversation list.
 *
 * Every thread is grouped first and only trimmed at the end, because the list
 * used to be cut to the 200 most recent inside the database — which quietly
 * put every older conversation out of reach. There was nothing wrong with the
 * messages; the sidebar simply stopped listing them, and the search box only
 * ever filtered what had already been sent, so searching could not reach them
 * either. Both are why staff reported "losing" old chats.
 *
 * `q` searches every conversation by number and by the name on the lead or
 * customer behind it. `phone` guarantees the open chat is in the response even
 * when it falls outside the window, so opening one from a lead always works.
 */
/**
 * Correct a message we sent.
 *
 * WhatsApp gives a business no way to change a message once it has gone: the
 * consumer app can edit for about fifteen minutes, the Cloud API cannot edit
 * at all, and there is no unsend either. So this does not rewrite the old
 * message on the customer's phone — nothing can. It sends the corrected
 * wording as a reply quoting the wrong one, which is what a person does by
 * hand, and threads it against the original in the customer's chat.
 *
 * The original is then marked here as superseded, so nobody reading back
 * through the thread takes the mistake for the current position.
 */
router.post('/messages/:id/correct', async (req, res) => {
    try {
        const original = await WhatsAppMessage.findById(req.params.id);
        if (!original) return res.status(404).json({ error: 'Message not found' });
        if (original.direction !== 'outbound') {
            return res.status(400).json({ error: 'Only a message we sent can be corrected' });
        }
        if (original.deletedAt) return res.status(400).json({ error: 'This message was deleted' });

        const text = String(req.body?.text || '').trim();
        if (!text) return res.status(400).json({ error: 'The corrected wording is required' });
        if (text === String(original.text || '').trim()) {
            return res.status(400).json({ error: 'The wording is unchanged' });
        }
        if (!whatsappSendConfigured()) {
            return res.status(400).json({ error: `WhatsApp not configured. Missing: ${whatsappSendMissing().join(', ')}` });
        }

        /* Quoting needs the id Meta gave the original. A message sent from
           another device and echoed to us has one; anything we failed to
           record an id for cannot be quoted, so it goes as a plain message
           rather than failing outright. */
        const result = await sendWhatsAppText({
            to: original.phone || original.phoneNormalized,
            body: text,
            replyTo: original.messageId || undefined,
        });

        const sent = await WhatsAppMessage.create({
            messageId: result?.messages?.[0]?.id || '',
            phone: original.phone,
            phoneNormalized: original.phoneNormalized,
            direction: 'outbound',
            type: 'text',
            text,
            status: 'sent',
            occurredAt: new Date(),
            sentByAi: false,
            replyToMessageId: original.messageId || '',
            raw: result,
        });

        original.correctedByMessageId = sent.messageId || String(sent._id);
        original.correctedAt = new Date();
        await original.save();

        await pauseBotForHuman(original.phoneNormalized);
        res.json({ ok: true, quoted: Boolean(original.messageId), message: sent });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

router.get('/conversations', async (req, res) => {
    // Numbers are stored inconsistently (+971 …, 0…, 971…), so people are
    // matched on the last 9 digits — the same rule the Zoho matcher uses.
    const suffix = (v) => {
        const d = String(v || '').replace(/\D/g, '');
        return d.length >= 9 ? d.slice(-9) : '';
    };

    const q = String(req.query.q || '').trim().toLowerCase();
    const keepPhone = String(req.query.phone || '').replace(/\D/g, '');
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 2000);

    /* These three do not depend on each other, so they go together.
     *
     * Every query here costs a round trip to Atlas whatever it asks for —
     * counting 331 customers takes about as long as counting nothing. Run one
     * after another the six trips this route makes added up to roughly 900 ms;
     * issued in two waves it is nearer 200. Same queries, same results, only
     * the waiting is shared. This endpoint is polled every ten seconds by
     * every open console, so it is the one worth doing this to. */
    const [rows, leads, customers] = await Promise.all([
        WhatsAppMessage.aggregate([
            { $sort: { occurredAt: -1 } },
            {
                $group: {
                    _id: '$phoneNormalized',
                    lastAt: { $max: '$occurredAt' },
                    count: { $sum: 1 },
                    phone: { $first: '$phone' },
                    /* When they last wrote to us.
                     *
                     * WhatsApp only allows free text within 24 hours of this;
                     * after it, only an approved template gets through and
                     * anything typed is rejected by Meta. The console had no
                     * idea, so a rep could write a careful reply to somebody
                     * who last messaged last week and simply have it bounce. */
                    lastInboundAt: {
                        $max: { $cond: [{ $eq: ['$direction', 'inbound'] }, '$occurredAt', null] },
                    },
                    /* And when we last wrote back. The two together say
                       whether anybody still owes this person an answer, which
                       is the one thing the inbox could not tell you. */
                    lastOutboundAt: {
                        $max: { $cond: [{ $eq: ['$direction', 'outbound'] }, '$occurredAt', null] },
                    },
                },
            },
            { $sort: { lastAt: -1 } },
            // A ceiling well above any real inbox, so one runaway import cannot
            // turn this into an unbounded read.
            { $limit: 5000 },
        ]),
        /* Which lead a thread belongs to, decided by the number.
         *
         * This used to read the lead id denormalised onto the newest message,
         * which is only as good as whatever wrote it. A lead deleted and made
         * again left every message pointing at an id that no longer resolves,
         * so a chat with a perfectly good lead — right name, right owner —
         * showed as a bare number with no badge.
         *
         * The number is the fact. Matched on the last nine digits, the same
         * rule used for customers and everywhere else people are matched. */
        Lead.find({}).select('fullName status owner assignedAt autoAssigned assignedBy whatsappProfileName phone phoneNormalized').lean(),
        /* `stage` as well: a record existing no longer means they are a
           tenant. Somebody quoted last week and gone quiet is a prospect, and
           the inbox must not badge them green — a rep reading "Customer"
           treats the conversation completely differently. */
        Customer.find({}).select('fullName phone phones stage').lean(),
    ]);

    const byLeadPhone = new Map();
    for (const l of leads) {
        for (const candidate of [l.phoneNormalized, l.phone]) {
            const k = suffix(candidate);
            // A named lead wins over a placeholder for the same number.
            if (!k) continue;
            const held = byLeadPhone.get(k);
            if (!held || (isPlaceholderLeadName(held.fullName) && !isPlaceholderLeadName(l.fullName))) {
                byLeadPhone.set(k, l);
            }
        }
    }

    const byPhone = new Map();
    for (const c of customers) {
        for (const p of [...(c.phones || []), c.phone]) {
            const k = suffix(p);
            if (k && !byPhone.has(k)) byPhone.set(k, c);
        }
    }


    /* Search covers every thread, not just the ones that would have been
       returned — the whole point is to reach a conversation that has fallen
       past the window. Matched on the number and on whatever name the sidebar
       would show for it, which is what people actually type. */
    const nameFor = (id) => {
        const lead = byLeadPhone.get(suffix(id));
        const customer = byPhone.get(suffix(id));
        const leadName = isPlaceholderLeadName(lead?.fullName) ? '' : (lead?.fullName || '');
        return (customer?.fullName || leadName || lead?.whatsappProfileName || '').toLowerCase();
    };

    let visible = rows;
    if (q) {
        /* Numbers are matched on their digits, wherever they appear.
         *
         * The leading zero of the local form is dropped first: 055 464 4265 is
         * stored as 971554644265, and searching the digits raw looked for
         * "0554644265" inside it and found nothing. Anyone typing a number the
         * way it is written on a card got no result.
         *
         * Contains, not equals, so a fragment works - the last four digits are
         * how people usually remember a number they are looking for. */
        const digits = q.replace(/\D/g, '').replace(/^0+/, '');
        visible = rows.filter((r) => (
            nameFor(r._id).includes(q)
            || (digits && r._id.includes(digits))
            || String(r.phone || '').toLowerCase().includes(q)
        ));
    }

    /* Whose chats to return, and how many there are of each.
     *
     * The inbox used to load the 200 most recent and count the tabs from those,
     * so a rep with 275 chats was told they had four — the other 271 were
     * simply outside the window. Both the filter and the counts are worked out
     * here, over every conversation, so "My leads" means all of them however
     * old and the number beside it is true.
     */
    const ownerOf = (r) => {
        const lead = byLeadPhone.get(suffix(r._id));
        return lead?.owner ? String(lead.owner) : '';
    };
    const me = String(req.user?.id || '');

    /* Waiting on us: they wrote last and nobody has answered.
     *
     * Forty-four conversations were sitting in this state when it was measured,
     * with no way to see them — they were scattered down a list sorted by
     * recency, indistinguishable from the ones already handled. Every one is a
     * customer who asked something and heard nothing back.
     */
    /* Bounded to a month. Measured over the whole inbox, 141 conversations had
       the customer speaking last, but 5 of them were older than thirty days —
       those are history, not work, and a queue that can only grow is one people
       stop opening. Meta's free-text window closed on them long ago anyway. */
    const waitingCutoff = new Date(Date.now() - 30 * 864e5);
    const waitingOn = (r) => Boolean(r.lastInboundAt)
        && r.lastInboundAt > waitingCutoff
        && (!r.lastOutboundAt || r.lastInboundAt > r.lastOutboundAt);

    const ownerCounts = { all: visible.length, mine: 0, unassigned: 0, waiting: 0 };
    for (const r of visible) {
        const owner = ownerOf(r);
        if (!owner) ownerCounts.unassigned += 1;
        else if (owner === me) ownerCounts.mine += 1;
        if (waitingOn(r)) ownerCounts.waiting += 1;
    }
    /* Also in the body, below.
     *
     * In production nginx adds the CORS headers, and a custom one is only
     * readable by the browser if it is named in Access-Control-Expose-Headers
     * there — which this is not. The tabs read 0 next to a list that was
     * plainly not empty, and then read the filtered page as if it were the
     * whole inbox. Anything the page needs travels in the body. */
    res.setHeader('X-Owner-Counts', JSON.stringify(ownerCounts));

    const ownerFilter = String(req.query.owner || '').trim();
    if (ownerFilter === 'mine') visible = visible.filter((r) => ownerOf(r) === me);
    else if (ownerFilter === 'unassigned') visible = visible.filter((r) => !ownerOf(r));
    else if (ownerFilter === 'waiting') {
        /* Oldest first, which is the opposite of every other tab and the whole
           point of this one: the person who has been waiting since Tuesday is
           the one to answer, not the one who wrote a minute ago. */
        visible = visible.filter(waitingOn).sort((a, b) => new Date(a.lastInboundAt) - new Date(b.lastInboundAt));
    } else if (ownerFilter && ownerFilter !== 'all') visible = visible.filter((r) => ownerOf(r) === ownerFilter);

    const total = visible.length;
    visible = visible.slice(0, limit);

    // The chat someone has open must be in the response even if it sorts below
    // the window, or opening an old thread from a lead shows a stranger.
    if (keepPhone && !visible.some((r) => r._id === keepPhone)) {
        const pinned = rows.find((r) => r._id === keepPhone);
        if (pinned) visible = [pinned, ...visible];
    }

    // Who is working each lead. The inbox showed a bare "Lead" badge, which
    // told you somebody had saved this person but not who is meant to answer
    // them — so a thread with an owner looked exactly like an unclaimed one.
    /* Owners, and whoever handed a lead over — an admin who assigns but owns
       nothing is still a name the row has to print. */
    const ownerIds = [...new Set(
        visible.flatMap((r) => {
            const lead = byLeadPhone.get(suffix(r._id));
            return [lead?.owner, lead?.assignedBy];
        }).filter(Boolean).map(String),
    )];
    const phones = visible.map((r) => r._id);

    // The second wave: these three need `visible`, but not each other.
    const [botThreads, owners, chatLabels] = await Promise.all([
        // The AI assistant's state per thread — whether it has a suggestion
        // waiting and whether it has handed the conversation over.
        AiBotThread.find({ phoneNormalized: { $in: phones } })
            .select('phoneNormalized status draftText escalationReason').lean(),
        ownerIds.length ? User.find({ _id: { $in: ownerIds } }).select('name email').lean() : [],
        WhatsAppChatLabel.find({ phoneNormalized: { $in: phones } })
            .populate('labels', 'name color sortOrder').lean(),
    ]);

    const byThread = new Map(botThreads.map((t) => [t.phoneNormalized, t]));
    const byOwner = new Map(owners.map((u) => [String(u._id), u.name || u.email || '']));
    const byLabels = new Map(chatLabels.map((c) => [c.phoneNormalized, c.labels || []]));

    // How many exist beyond what is being returned, so the page can offer to
    // show more rather than pretending this is all there is.
    res.setHeader('X-Total-Conversations', String(rows.length));
    res.setHeader('X-Matched-Conversations', String(total));

    const payload = visible.map((r) => {
        const lead = byLeadPhone.get(suffix(r._id)) || null;
        const customer = byPhone.get(suffix(r._id)) || null;
        const leadName = isPlaceholderLeadName(lead?.fullName) ? '' : lead.fullName;
        const bot = byThread.get(r._id) || null;
        return {
            phoneNormalized: r._id,
            phone: r.phone,
            count: r.count,
            lastAt: r.lastAt,
            lastInboundAt: r.lastInboundAt || null,
            lastOutboundAt: r.lastOutboundAt || null,
            // Since when they have been owed an answer; null when they are not.
            waitingSince: waitingOn(r) ? r.lastInboundAt : null,
            lead: lead
                ? {
                    _id: lead._id,
                    fullName: lead.fullName,
                    status: lead.status,
                    ownerName: byOwner.get(String(lead.owner)) || '',
                    // The id as well as the name: the inbox lets you reassign
                    // from the chat, and matching a person by name would pick
                    // the wrong one the day two share a first name.
                    ownerId: lead.owner ? String(lead.owner) : null,
                    /* Whether a person put it on somebody, as opposed to the
                       owner every auto-created contact is given at birth. The
                       inbox shows the owner badge on this, so a chat handed to
                       a rep says so even while it is still called
                       "WhatsApp Contact 5521". */
                    assigned: Boolean(lead.assignedAt),
                    /* How it came to be theirs. "Why is this mine?" deserves an
                       answer on the row rather than in a timeline note. */
                    autoAssigned: Boolean(lead.autoAssigned),
                    assignedByName: lead.assignedBy ? (byOwner.get(String(lead.assignedBy)) || '') : '',
                    profileName: lead.whatsappProfileName || '',
                }
                : null,
            customer: customer
                ? {
                    _id: customer._id,
                    fullName: customer.fullName,
                    // Absent means tenant, which is what it meant before the
                    // field existed. See services/customerStage.js.
                    stage: customer.stage === 'prospect' ? 'prospect' : 'customer',
                }
                : null,
            // What the inbox should show: a name somebody here decided on
            // first, then the name they set on their own WhatsApp profile,
            // and only then the number. Never the placeholder.
            displayName: customer?.fullName || leadName || lead?.whatsappProfileName || (r.phone || r._id),
            labels: byLabels.get(r._id) || [],
            botStatus: bot?.status || '',
            botDraft: bot?.draftText || '',
            botEscalationReason: bot?.escalationReason || '',
        };
    });

    /* An object, where it used to be a bare array. The client accepts either,
       so the two halves can be deployed in any order. */
    res.json({ list: payload, total: rows.length, matched: total, ownerCounts });
});

// Link a chat to a lead. Inbound chats usually get one automatically from the
// webhook sync, so this is the manual path for numbers that don't have one yet
// (e.g. a thread we started outbound). Idempotent — returns the existing lead
// rather than creating a duplicate.
/* ── Daily digest ─────────────────────────────────────────────────────────
   One day's conversations as read that morning. Declared before /:phone routes
   so "digest" is never taken for a phone number. */

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Which days have been built, newest first.
router.get('/digest/days', async (_req, res) => {
    try {
        const days = await DailyDigest.find().sort({ day: -1 }).select('day builtAt stats').limit(90).lean();
        res.json({ days, today: dayKeyFor(), yesterday: previousDay(dayKeyFor()) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/digest/:day', async (req, res) => {
    try {
        const day = String(req.params.day || '');
        if (!DAY_KEY.test(day)) return res.status(400).json({ error: 'Expected a day as YYYY-MM-DD' });
        const stored = await DailyDigest.findOne({ day }).lean();
        // Never built rather than nothing happened — the page says which.
        if (!stored) return res.json({ day, built: false, stats: null, chats: [] });
        res.json({ ...stored, built: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Build on demand, so today can be read before tomorrow morning.
router.post('/digest/:day/build', async (req, res) => {
    try {
        const day = String(req.params.day || '');
        if (!DAY_KEY.test(day)) return res.status(400).json({ error: 'Expected a day as YYYY-MM-DD' });
        const out = await ensureDigest(day, { rebuild: req.query.rebuild === '1' });
        res.json({ ...out, built: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Read every conversation that moved in the last couple of days.
 *
 * Bounded by window and by count, so one click cannot become a large bill.
 */
router.post('/summarise-recent', async (req, res) => {
    try {
        const days = Math.min(Math.max(1, Number(req.body?.days) || 2), 14);
        res.json(await summariseRecent({ days }));
    } catch (e) {
        res.status(500).json({ error: e.message || 'Could not summarise' });
    }
});

/**
 * Ask a question of the whole inbox.
 *
 * Most questions are answered straight from the database and cost nothing;
 * `usedModel` in the response says which. Read-only.
 */
router.get('/ask', async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (!q) return res.status(400).json({ error: 'Ask a question' });
        res.json(await askInbox(q));
    } catch (e) {
        res.status(500).json({ error: e.message || 'Could not answer that' });
    }
});

/**
 * A short read of one thread, for the strip above the chat.
 *
 * GET returns the stored summary and generates one only if the conversation
 * has moved since — so clicking through an inbox does not pay for the same
 * summary again. `?force=1` regenerates on demand.
 *
 * Read-only: it writes nothing to the Lead and sends nothing.
 */
router.get('/conversations/:phoneNormalized/summary', async (req, res) => {
    try {
        const phoneNormalized = String(req.params.phoneNormalized || '').replace(/\D/g, '');
        if (!phoneNormalized) return res.status(400).json({ error: 'A phone number is required' });
        const out = await summariseConversation(phoneNormalized, { force: req.query.force === '1' });
        res.json(out);
    } catch (e) {
        res.status(500).json({ error: e.message || 'Could not summarise this conversation' });
    }
});

/**
 * Turn a chat into a real lead.
 *
 * Every inbound conversation already has a Lead behind it — the sync creates
 * one so messages have something to hang off — but it carries a generated name
 * like "WhatsApp Contact 7425" and belongs to nobody. That is bookkeeping, not
 * a lead somebody decided to work.
 *
 * So this fills the placeholder in rather than refusing because a record
 * exists. A lead that already has a real name is left alone.
 */
router.post('/conversations/:phoneNormalized/lead', async (req, res) => {
    try {
        const phoneNormalized = String(req.params.phoneNormalized || '').replace(/\D/g, '');
        if (!phoneNormalized) return res.status(400).json({ error: 'A phone number is required' });

        const fullName = String(req.body?.fullName || '').trim();
        const email = String(req.body?.email || '').trim();
        const ownerId = String(req.body?.owner || '').trim();
        const notes = String(req.body?.notes || '').trim();

        if (ownerId && !(await User.exists({ _id: ownerId }))) {
            return res.status(400).json({ error: 'That person no longer exists' });
        }

        const existing = await Lead.findOne({ phoneNormalized });

        if (existing) {
            const generated = isPlaceholderLeadName(existing.fullName);
            // A name somebody typed is never overwritten by this.
            if (!generated && !ownerId && !email && !notes) {
                return res.json({ action: 'exists', lead: { _id: existing._id, fullName: existing.fullName, status: existing.status } });
            }
            // Promoting a placeholder is when this becomes a lead somebody
            // decided to work, so that is what "Added" should say. Until now
            // it kept the moment WhatsApp first heard from them, which could
            // be weeks earlier and made a brand new lead look stale.
            //
            // The original is not lost: it goes in the timeline, and the
            // messages themselves are still dated.
            if (generated && fullName) {
                existing.fullName = fullName;
                const firstHeard = existing.leadDateTime;
                existing.leadDateTime = new Date();
                if (firstHeard) {
                    existing.timeline = existing.timeline || [];
                    existing.timeline.push({
                        type: 'note',
                        text: `First message from this number: ${new Date(firstHeard).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
                        user: req.user.id,
                    });
                }
            }
            if (email) existing.email = email;
            // Saving a chat onto a rep makes it new to them, and starts their
            // clock — this is somebody choosing an owner, which is exactly what
            // the response window is measured from.
            if (ownerId && String(existing.owner) !== ownerId) {
                existing.owner = ownerId;
                existing.ownerSeenAt = null;
                existing.assignedAt = new Date();
                existing.firstResponseAt = null;
                existing.assignedBy = req.user.id;
                existing.autoAssigned = false;
            }
            // Appended, never replaced: whatever was already noted about this
            // person is part of the record.
            if (notes) existing.notes = [existing.notes, notes].filter(Boolean).join('\n');
            existing.timeline = existing.timeline || [];
            existing.timeline.push({
                type: 'note',
                text: generated ? 'Saved as a lead from the WhatsApp inbox' : 'Updated from the WhatsApp inbox',
                user: req.user.id,
            });
            await existing.save();
            await WhatsAppMessage.updateMany({ phoneNormalized, lead: null }, { $set: { lead: existing._id } });
            return res.json({ action: 'updated', lead: { _id: existing._id, fullName: existing.fullName, status: existing.status } });
        }

        const sample = await WhatsAppMessage.findOne({ phoneNormalized }).sort({ occurredAt: -1 }).select('phone');
        const lead = await createLeadFromWhatsAppPhone({
            phone: sample?.phone || phoneNormalized,
            phoneNormalized,
            fullName,
            ownerId: ownerId || req.user.id,
            timelineText: 'Lead created from the WhatsApp inbox',
        });
        if (!lead) return res.status(500).json({ error: 'Could not create the lead' });

        if (email || notes) {
            if (email) lead.email = email;
            if (notes) lead.notes = notes;
            await lead.save();
        }
        /* Choosing the owner at the moment of creation is the same act as
           choosing one later, so it starts the same clock. Without this the
           lead was owned but never marked assigned, which is what the board
           keys on to show a still-placeholder name - so assigning a chat
           created the lead and then hid it. */
        if (ownerId) {
            lead.assignedAt = new Date();
            lead.ownerSeenAt = null;
            lead.firstResponseAt = null;
            await lead.save();
        }
        await WhatsAppMessage.updateMany({ phoneNormalized, lead: null }, { $set: { lead: lead._id } });
        res.status(201).json({ action: 'created', lead: { _id: lead._id, fullName: lead.fullName, status: lead.status } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/send', async (req, res) => {
    if (!whatsappSendConfigured()) {
        return res.status(400).json({ error: `WhatsApp not configured. Missing: ${whatsappSendMissing().join(', ')}` });
    }
    const { to, body } = req.body || {};
    if (!to || !body) return res.status(400).json({ error: 'to and body are required' });

    const result = await sendWhatsAppText({ to, body });

    const phoneNormalized = String(to).replace(/\D/g, '');
    await WhatsAppMessage.create({
        messageId: result?.messages?.[0]?.id || '',
        phone: to,
        phoneNormalized,
        direction: 'outbound',
        type: 'text',
        text: body,
        status: 'sent',
        occurredAt: new Date(),
        // Set explicitly by the assistant's own send; a message from this route
        // is always someone typing it.
        sentByAi: false,
        raw: result,
    });

    // A colleague has taken the conversation, so the assistant steps back and
    // its pending suggestion — now stale — is dropped.
    await pauseBotForHuman(phoneNormalized);

    res.json({ ok: true, result });
});

/**
 * Send one quick reply — its file, its text, or both.
 *
 * Assembled on the server rather than the browser so the console does not need
 * to know whether a given reply carries a file, and so the URL is resolved
 * against what is actually stored rather than what the page happened to render.
 */
router.post('/send-quick-reply', async (req, res) => {
    try {
        if (!whatsappSendConfigured()) {
            return res.status(400).json({ error: `WhatsApp not configured. Missing: ${whatsappSendMissing().join(', ')}` });
        }
        const to = String(req.body?.to || '').trim();
        if (!to) return res.status(400).json({ error: 'to is required' });

        const template = await MessageTemplate.findById(req.body?.templateId).lean();
        if (!template) return res.status(404).json({ error: 'Quick reply not found' });

        const phoneNormalized = String(to).replace(/\D/g, '');
        const body = String(template.whatsappBody || '').trim();
        const sent = [];

        // A location quick reply sends WhatsApp's native pin — the point of it
        // over a Maps link is that tapping it lands only on our coordinates,
        // not a search page listing every storage place nearby.
        if (template.mediaKind === 'location') {
            if (!Number.isFinite(template.locationLat) || !Number.isFinite(template.locationLng)) {
                return res.status(400).json({ error: 'This quick reply is set to send a location but has no coordinates saved yet — add them under Settings → Message Templates.' });
            }
            const result = await sendWhatsAppLocation({
                to,
                latitude: template.locationLat,
                longitude: template.locationLng,
                name: template.locationName || undefined,
                address: template.locationAddress || undefined,
            });
            const summary = ['📍', template.locationName, template.locationAddress].filter(Boolean).join(' — ');
            await WhatsAppMessage.create({
                messageId: result?.messages?.[0]?.id || '',
                phone: to,
                phoneNormalized,
                direction: 'outbound',
                type: 'location',
                text: summary || '📍 Location shared',
                status: 'sent',
                occurredAt: new Date(),
                sentByAi: false,
                raw: {
                    location: { latitude: template.locationLat, longitude: template.locationLng, name: template.locationName, address: template.locationAddress },
                    sendResult: result,
                },
            });
            sent.push('location');
        }

        // The file goes first, with the text as its caption when both exist —
        // one message rather than two, which is how a person would send it.
        if (!sent.length && template.mediaUrl && template.mediaKind) {
            const captionable = ['image', 'video', 'document'].includes(template.mediaKind);
            const caption = captionable ? body : '';
            const result = await sendWhatsAppMedia({
                to,
                link: template.mediaUrl,
                kind: template.mediaKind,
                caption,
                filename: template.mediaFilename || undefined,
            });
            await WhatsAppMessage.create({
                messageId: result?.messages?.[0]?.id || '',
                phone: to,
                phoneNormalized,
                direction: 'outbound',
                type: template.mediaKind,
                text: caption,
                status: 'sent',
                occurredAt: new Date(),
                sentByAi: false,
                // Same shape the inbound webhook produces, so the thread renders
                // it and the media proxy can serve it back.
                raw: { [template.mediaKind]: { link: template.mediaUrl, caption, filename: template.mediaFilename || '' }, sendResult: result },
            });
            sent.push(template.mediaKind);
            if (caption) sent.push('text');
        }

        // Text on its own, or alongside a file that cannot carry a caption.
        const needsSeparateText = body && !sent.includes('text');
        if (needsSeparateText) {
            const result = await sendWhatsAppText({ to, body });
            await WhatsAppMessage.create({
                messageId: result?.messages?.[0]?.id || '',
                phone: to,
                phoneNormalized,
                direction: 'outbound',
                type: 'text',
                text: body,
                status: 'sent',
                occurredAt: new Date(),
                sentByAi: false,
                raw: result,
            });
            sent.push('text');
        }

        if (!sent.length) return res.status(400).json({ error: 'This quick reply has neither text nor a file' });

        await pauseBotForHuman(phoneNormalized);
        res.json({ ok: true, sent });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// Send a file. Stored as an outbound message carrying the same media shape
// the webhook produces for inbound ones, so the thread renders both the same
// way and the media proxy can serve it back.
/* What WhatsApp itself accepts, per kind.
 *
 * These are Meta's limits, not ours, and they differ by an order of magnitude:
 * a 40 MB document goes through, a 40 MB video does not. The old ceiling was a
 * flat 16 MB, which refused documents Meta would have taken and accepted images
 * it would not — the sender saw a rejection from Meta with no useful wording,
 * long after the file had finished uploading.
 *
 * The upload itself is capped at the largest of them; the per-kind check
 * happens once the type is known and says which limit was hit.
 */
const MEDIA_LIMITS = { image: 5, video: 16, audio: 16, sticker: 0.1, document: 100 };
const MB = 1024 * 1024;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * MB },
});

/* Multer throws before the handler runs, so without this an oversized file
   surfaces as an unhandled error and the sender is told nothing useful. */
function uploadOne(req, res, next) {
    upload.single('file')(req, res, (err) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'That file is over 100 MB, which is more than WhatsApp accepts for anything.' });
        }
        return res.status(400).json({ error: err.message || 'That file could not be read' });
    });
}

router.post('/send-media', uploadOne, async (req, res) => {
    try {
        if (!whatsappSendConfigured()) {
            return res.status(400).json({ error: `WhatsApp not configured. Missing: ${whatsappSendMissing().join(', ')}` });
        }
        const to = String(req.body?.to || '').trim();
        if (!to) return res.status(400).json({ error: 'to is required' });
        if (!req.file) return res.status(400).json({ error: 'A file is required' });

        const caption = String(req.body?.caption || '').trim();
        const kind = whatsappMediaKind(req.file.mimetype);

        /* Checked here rather than left to Meta, which rejects an oversized
           file only after the whole thing has been uploaded to it and answers
           with wording no sender can act on. */
        const limitMb = MEDIA_LIMITS[kind] ?? 100;
        if (req.file.size > limitMb * MB) {
            const sizeMb = (req.file.size / MB).toFixed(1);
            return res.status(413).json({
                error: `WhatsApp takes ${kind}s up to ${limitMb} MB. This one is ${sizeMb} MB.`
                    + (kind === 'video' ? ' Sending it as a document instead allows up to 100 MB.' : ''),
            });
        }

        let buffer = req.file.buffer;
        let mimeType = req.file.mimetype;
        let filename = req.file.originalname;

        /* A voice note recorded in the browser arrives as WebM/Opus, which Meta
         * refuses — it takes Ogg/Opus, holding the very same encoded frames.
         * Repackaging is done here rather than in the browser so every caller
         * gets it, and so a picked-up .webm file is handled too. */
        if (kind === 'audio' && needsRemux(mimeType)) {
            buffer = webmToOggOpus(buffer);
            mimeType = 'audio/ogg';
            filename = filename.replace(/\.[^.]+$/, '') + '.ogg';
        }

        /* Caught here rather than by Meta.
         *
         * Meta refuses a file whose bytes do not match its declared type, and
         * that refusal comes back by webhook minutes later as a failed
         * message. Saying it now means the sender can pick another file
         * instead of finding out from the customer. */
        const mismatch = containerMismatch(buffer, mimeType);
        if (mismatch) {
            return res.status(400).json({
                error: `That file says it is ${mimeType} but ${mismatch}. WhatsApp will refuse it — try another file, or record the note again.`,
            });
        }

        const mediaId = await uploadWhatsAppMedia({ buffer, mimeType, filename });
        const result = await sendWhatsAppMedia({
            to, mediaId, kind, caption, filename,
        });

        await WhatsAppMessage.create({
            messageId: result?.messages?.[0]?.id || '',
            phone: to,
            phoneNormalized: String(to).replace(/\D/g, ''),
            direction: 'outbound',
            type: kind,
            text: caption,
            status: 'sent',
            occurredAt: new Date(),
            // Mirror the inbound webhook shape so mediaFromRaw finds it and the
            // same proxy serves it back into the thread.
            raw: { [kind]: { id: mediaId, mime_type: mimeType, filename, caption }, sendResult: result },
        });

        await pauseBotForHuman(String(to).replace(/\D/g, ''));

        res.json({ ok: true, kind, mediaId });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

export default router;
