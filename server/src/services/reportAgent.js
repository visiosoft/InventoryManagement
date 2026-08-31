/**
 * Turning a question into a report.
 *
 * The model is given the catalogue of building blocks and asked for a plan:
 * which blocks to run, with what filters, in what order, and the words around
 * them. It gets no data and returns no data. The server runs the blocks and
 * fills in the figures.
 *
 * That split is the whole point. A model asked for numbers will eventually
 * produce one that is wrong and perfectly plausible, and a report is exactly
 * the place nobody would catch it. A model asked which tested function to run
 * can only be wrong in ways that are visible: it picks the wrong block, and
 * the report obviously answers the wrong question.
 */

import { chatJson, openaiConfigured } from './openai.js';
import { BLOCKS, blockCatalogue } from './reportBlocks.js';
import { siteScope } from '../utils/siteScope.js';
import { Contract } from '../models/index.js';

const MAX_SECTIONS = 6;

/* When the business's records actually start.
 *
 * Without this the model guesses a range, and it guesses badly: asked which
 * rep converted best it chose 2023, three years before the first record, and
 * every block dutifully returned nothing. An empty report reads as "no such
 * business" rather than "wrong dates", which is the worst way to be wrong.
 *
 * Cached for the life of the process — the first contract does not move. */
let eraCache = null;
async function dataEra() {
    if (eraCache) return eraCache;
    const first = await Contract.findOne().sort({ createdAt: 1 }).select('createdAt').lean().catch(() => null);
    eraCache = (first?.createdAt ?? new Date(2025, 0, 1)).toISOString().slice(0, 10);
    return eraCache;
}

function systemPrompt(era) {
    const catalogue = blockCatalogue()
        .map((b) => `- ${b.name} (${b.shape}) — ${b.summary}\n  parameters: ${JSON.stringify(b.params)}`)
        .join('\n');

    return `You plan reports for PurpleBox, a self-storage business in Dubai.

You do not have the data and you never state a figure. You choose which of the
blocks below should be run and how the report should read. The system runs them
and fills in the real numbers.

Blocks you may use:
${catalogue}

Reply with JSON only, in this shape:
{
  "title": "short report title",
  "intro": "one or two sentences saying what this report covers",
  "sections": [
    { "type": "stat" | "table" | "chart", "block": "<block name>", "params": { }, "caption": "one line" }
  ],
  "closing": "one sentence on what to look at",
  "answerable": true
}

Rules:
- Use only block names from the list. Never invent one.
- Use only the parameters a block declares. Dates are YYYY-MM-DD.
- "stat" suits a stat block, "chart" a series block, "table" a table block.
- At most ${MAX_SECTIONS} sections. Fewer is better; answer the question asked.

Dates, which is where this most often goes wrong:
- Today is ${new Date().toISOString().slice(0, 10)}. The business has no records
  before ${era}. A range starting earlier returns nothing at all.
- **Omit "from" and "to" entirely unless the question names a period.** Left out,
  a block covers everything it has, which is almost always what was meant.
- Never invent a year. "this quarter", "last month", "before October" are
  computed from today's date above; anything vaguer takes no dates.

Before you decline, read the list again. Most questions about this business are
answerable even when the wording does not match a block name:
- anything about reps, performance, conversion or "who is best" → leads_by_rep
  and rep_performance
- anything about enquiries, sources or stages → leads_funnel
- anything about space, sizes, what is free → units_available, unit_size_demand,
  occupancy_now
- anything about who is leaving, renewals or expiry → contracts_expiring
- anything about past tenants or how long people stay → contracts_ended
- anything about money in → revenue_collected; money owed → revenue_outstanding

A block that answers most of the question is the right answer. Say what you are
showing in the caption and let the reader judge.

Only reply { "answerable": false, "reason": "<one sentence>" } when the data
genuinely is not here — a prediction, something outside this business, or a
figure nothing in the list produces. Never invent a number to avoid declining,
and never answer a different question than the one asked.`;
}

/**
 * Check the model's plan against the catalogue before anything runs.
 *
 * Rejects rather than repairs. A silently corrected plan produces a report
 * that answers a question nobody asked, which is harder to notice than an
 * outright refusal.
 */
export function validateSpec(spec) {
    const errors = [];
    if (!spec || typeof spec !== 'object') return { ok: false, errors: ['The model returned nothing usable.'] };

    if (spec.answerable === false) {
        return { ok: false, unanswerable: true, reason: String(spec.reason || 'That cannot be answered from the data available.') };
    }

    const sections = Array.isArray(spec.sections) ? spec.sections : [];
    if (sections.length === 0) errors.push('The plan contained no sections.');
    if (sections.length > MAX_SECTIONS) errors.push(`The plan asked for ${sections.length} sections; the limit is ${MAX_SECTIONS}.`);

    const clean = [];
    for (const [i, s] of sections.entries()) {
        const where = `section ${i + 1}`;
        const block = BLOCKS[s?.block];
        if (!block) {
            errors.push(`${where}: no such block "${s?.block}".`);
            continue;
        }
        const declared = Object.keys(block.params || {});
        const given = Object.keys(s.params || {});
        const unknown = given.filter((k) => !declared.includes(k));
        if (unknown.length) {
            errors.push(`${where}: block "${s.block}" has no parameter ${unknown.map((u) => `"${u}"`).join(', ')}.`);
            continue;
        }
        for (const [key, value] of Object.entries(s.params || {})) {
            const kind = String(block.params[key] || '').replace('?', '');
            if (kind === 'date' && value && Number.isNaN(new Date(value).getTime())) {
                errors.push(`${where}: "${key}" is not a date.`);
            }
            if (kind === 'number' && value !== undefined && !Number.isFinite(Number(value))) {
                errors.push(`${where}: "${key}" is not a number.`);
            }
        }
        clean.push({
            type: ['stat', 'table', 'chart'].includes(s.type) ? s.type : shapeToType(block.shape),
            block: s.block,
            params: s.params || {},
            caption: String(s.caption || ''),
        });
    }

    if (errors.length) return { ok: false, errors };
    return {
        ok: true,
        spec: {
            title: String(spec.title || 'Report'),
            intro: String(spec.intro || ''),
            closing: String(spec.closing || ''),
            sections: clean,
        },
    };
}

const shapeToType = (shape) => (shape === 'series' ? 'chart' : shape === 'stat' ? 'stat' : 'table');

/* How many rows of a table reach the page.
 *
 * Not a guess: outstanding payments alone is 1,374 rows today. Rendered whole
 * that is a page nobody scrolls and a PDF nobody reads. The block's own totals
 * are computed over everything and stay truthful, so the summary figures are
 * unaffected — only the listing is shortened, and it says so. */
const MAX_ROWS = 200;

/** Run a validated plan and attach the real figures. */
export async function runSpec(spec, siteId) {
    const scope = siteId && siteId !== 'all' ? await siteScope(siteId) : null;
    const sections = [];
    for (const section of spec.sections) {
        const block = BLOCKS[section.block];
        const data = await block.run(section.params, scope);
        if (Array.isArray(data.rows) && data.rows.length > MAX_ROWS) {
            data.rowsTotal = data.rows.length;
            data.truncated = true;
            data.rows = data.rows.slice(0, MAX_ROWS);
        }
        sections.push({ ...section, shape: block.shape, data });
    }
    return {
        ...spec,
        sections,
        // Shown on the page so any figure can be traced back to what produced it.
        blocksUsed: spec.sections.map((s) => ({ block: s.block, params: s.params })),
        scope: siteId && siteId !== 'all' ? siteId : 'all',
        generatedAt: new Date().toISOString(),
    };
}

/** Question in, finished report out. */
export async function buildReport({ question, siteId }) {
    if (!openaiConfigured()) {
        return { ok: false, reason: 'ChatGPT is not connected — add the key in Settings → Integrations.' };
    }
    const text = String(question || '').trim();
    if (!text) return { ok: false, reason: 'Ask a question first.' };

    const raw = await chatJson({
        system: systemPrompt(await dataEra()),
        messages: [{ role: 'user', content: text }],
        // A plan is longer than a chat reply; the default of 400 truncates it
        // mid-JSON, which parses as nothing and reads as the model failing.
        maxTokens: 1200,
        timeout: 45000,
    });

    const checked = validateSpec(raw);
    if (!checked.ok) {
        return {
            ok: false,
            reason: checked.unanswerable
                ? checked.reason
                : `That produced a plan I could not run: ${checked.errors.join(' ')}`,
            question: text,
        };
    }

    return { ok: true, report: await runSpec(checked.spec, siteId), question: text };
}
