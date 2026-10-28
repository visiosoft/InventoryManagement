import { GeneratedFile } from '../../models/index.js';
import { registerTool } from './tools.js';
import { holdProposal, registerRunner, markProposalTool } from './actions.js';

/**
 * Making things from what the tools found: a chart, a PDF or Excel file of
 * any table, and a new bot described in a sentence.
 *
 * Charts and files are built by the model from tool results, so index.js
 * checks every number in them against those results before they are shown —
 * the same rule as for the answer itself. A chart or file that carries a
 * figure no tool gave is dropped, and the answer says so.
 */

const CHART_TYPES = ['bar', 'line', 'pie'];
const str = (v, n) => String(v ?? '').trim().slice(0, n);

/** A chart made safe to draw: known type, up to 40 points, up to 5 series of numbers. */
export function cleanChart({ type, title, labels, series } = {}) {
   const lab = (Array.isArray(labels) ? labels : []).map((l) => str(l, 40)).slice(0, 40);
   if (!lab.length) return null;
   const ser = (Array.isArray(series) ? series : []).slice(0, 5).map((s) => ({
      name: str(s?.name, 40) || 'Value',
      values: lab.map((_, i) => { const v = Number((s?.values || [])[i]); return Number.isFinite(v) ? v : 0; }),
   })).filter((s) => s.values.some((v) => v !== 0));
   if (!ser.length) return null;
   const t = CHART_TYPES.includes(type) ? type : 'bar';
   return { type: t, title: str(title, 80) || 'Chart', labels: lab, series: t === 'pie' ? ser.slice(0, 1) : ser };
}

/** A table made safe to store: up to 20 columns and 2,000 rows, cells as numbers or short text. */
export function cleanTable({ title, subtitle, columns, rows } = {}) {
   const cols = (Array.isArray(columns) ? columns : []).slice(0, 20).map((c) => (typeof c === 'string' ? { label: str(c, 60), numeric: false } : { label: str(c?.label, 60), numeric: Boolean(c?.numeric) })).filter((c) => c.label);
   if (!cols.length) return null;
   const body = (Array.isArray(rows) ? rows : []).slice(0, 2000).map((r) => cols.map((c, i) => {
      const v = Array.isArray(r) ? r[i] : r?.[c.label];
      return typeof v === 'number' ? v : str(v, 300);
   }));
   if (!body.length) return null;
   return { title: str(title, 100) || 'Table', subtitle: str(subtitle, 160), columns: cols, rows: body };
}

registerTool({
   name: 'make_chart',
   description: 'Draw a chart (bar, line or pie) from figures that other tools returned in this conversation — leads per day, occupancy by size, wins by rep, ad results. Every value must be copied exactly from a tool result; the chart is checked and dropped if it is not. Use when asked for a graph or chart, or when a trend or comparison is clearer drawn. Then describe it in a line.',
   parameters: {
      type: 'object',
      properties: {
         type: { type: 'string', enum: CHART_TYPES },
         title: { type: 'string' },
         labels: { type: 'array', items: { type: 'string' }, description: 'The x-axis (or pie slices), e.g. dates, sizes, rep names' },
         series: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } }, required: ['values'] }, description: 'One or more lines/bar groups, one value per label' },
      },
      required: ['labels', 'series'],
   },
   async run(args) {
      const chart = cleanChart(args);
      if (!chart) return { error: 'A chart needs labels and at least one series of numbers' };
      return { chart, note: 'The chart is shown under the answer.' };
   },
});

registerTool({
   name: 'make_file',
   description: 'Put any table from this conversation into a PDF or Excel file to download — competitor prices, the Meta ads table, a rep scorecard, a pricing plan, anything the built-in export_file lists do not cover (use export_file for leads, expiring contracts, tasks, free units and calls). Columns, then rows, copied exactly from tool results; numbers as numbers. The file is checked against the results and dropped if a figure does not match.',
   parameters: {
      type: 'object',
      properties: {
         title: { type: 'string' },
         subtitle: { type: 'string', description: 'The period or filter, e.g. "Last 30 days"' },
         format: { type: 'string', enum: ['pdf', 'excel'] },
         columns: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, numeric: { type: 'boolean' } }, required: ['label'] } },
         rows: { type: 'array', items: { type: 'array', items: {} }, description: 'One array per row, in column order' },
      },
      required: ['title', 'columns', 'rows'],
   },
   async run(args, { user } = {}) {
      const table = cleanTable(args);
      if (!table) return { error: 'A file needs columns and at least one row' };
      const fmt = args.format === 'excel' ? 'excel' : 'pdf';
      const doc = await GeneratedFile.create({ ...table, user: user?.id || null });
      return {
         generatedFileId: String(doc._id),
         table,
         file: { label: `${table.title} (${fmt === 'pdf' ? 'PDF' : 'Excel'})`, path: `/assistant/file/${doc._id}?format=${fmt}`, format: fmt },
         note: 'The file is attached under the answer as a download button.',
      };
   },
});

/* ── a report card ──────────────────────────────────────────────────────── */

const FORMATS = ['number', 'money_aed', 'money_usd', 'percent'];
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/**
 * A report laid out as a card: headline, key figures, a breakdown, an insight,
 * numbered actions. Only figures go in as numbers — shares and bar lengths are
 * worked out by the app, never typed by the model. Pure.
 */
/** The people an action is about: a name and a phone, so the card can open their chat. Pure. */
export const cleanPeople = (list) => (Array.isArray(list) ? list : []).slice(0, 8)
   .map((p) => ({ name: str(p?.name, 40), phone: String(p?.phone ?? '').replace(/\D/g, '').slice(-15) }))
   .filter((p) => p.name && p.phone.length >= 9);

export function cleanReport(a = {}) {
   const kpis = (Array.isArray(a.kpis) ? a.kpis : []).slice(0, 4)
      .map((k) => ({ label: str(k?.label, 40), value: num(k?.value), format: FORMATS.includes(k?.format) ? k.format : 'number', sub: str(k?.sub, 60) }))
      .filter((k) => k.label && k.value != null);
   const b = a.breakdown || {};
   const columns = (Array.isArray(b.columns) ? b.columns : []).slice(0, 5).map((c) => str(c, 30)).filter(Boolean);
   const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 10)
      .map((r) => ({ label: str(r?.label, 50), tag: str(r?.tag, 24), values: (Array.isArray(r?.values) ? r.values : []).slice(0, columns.length).map(num) }))
      .filter((r) => r.label && r.values.length === columns.length && r.values.every((v) => v != null));
   const shareOf = Number.isInteger(b.shareOf) && b.shareOf >= 0 && b.shareOf < columns.length ? b.shareOf : (columns.length ? columns.length - 1 : null);
   const actions = (Array.isArray(a.actions) ? a.actions : []).slice(0, 5)
      .map((x) => ({ title: str(x?.title, 90), detail: str(x?.detail, 140), value: num(x?.value), of: num(x?.of), label: str(x?.label, 24), people: cleanPeople(x?.people) }))
      .filter((x) => x.title);
   const card = {
      eyebrow: str(a.eyebrow, 60), headline: str(a.headline, 110), badge: str(a.badge, 20),
      kpis, breakdown: rows.length ? { title: str(b.title, 60), columns, rows, shareOf } : null,
      callout: str(a.callout, 220), actions, footnote: str(a.footnote, 300),
   };
   return card.headline && (kpis.length || card.breakdown || actions.length) ? card : null;
}

/** Every figure the card states as a number, for checking against the tools. Pure. */
export const reportNumbers = (c) => [
   ...c.kpis.map((k) => k.value),
   ...(c.breakdown?.rows || []).flatMap((r) => r.values),
   ...c.actions.flatMap((x) => [x.value, x.of].filter((v) => v != null)),
];

/** The card's sentences, whose figures are checked too. Pure. */
export const reportTexts = (c) => ({ headline: c.headline, callout: c.callout, footnote: c.footnote, ...Object.fromEntries(c.actions.map((x, i) => [`action${i}`, x.detail])), ...Object.fromEntries(c.kpis.map((k, i) => [`sub${i}`, k.sub])) });

registerTool({
   name: 'make_report',
   description: 'Lay a report out as a card, for scheduled bot reports and any answer that is a summary of figures: a short eyebrow (e.g. "AI API USAGE · LAST 7 DAYS"), a one-line headline stating the main finding, up to 4 key figures, an optional breakdown table (columns of numbers per row; the app draws the share bar from the column given in shareOf), a one-line insight, and up to 5 numbered actions — each can carry a value and the total it is out of, which the app draws as a bar, and the people it is about (name and phone from the tools), which the app links to their chats. Every number must be copied exactly from tool results; the card is checked and anything that does not match is dropped. Put shares and percentages in only if a tool returned them; otherwise give the two numbers and let the app work them out. Then answer with one or two sentences.',
   parameters: {
      type: 'object',
      properties: {
         eyebrow: { type: 'string' }, headline: { type: 'string' }, badge: { type: 'string', description: 'e.g. Estimate, Live, Needs action' },
         kpis: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' }, format: { type: 'string', enum: FORMATS }, sub: { type: 'string' } }, required: ['label', 'value'] } },
         breakdown: { type: 'object', properties: {
            title: { type: 'string' }, columns: { type: 'array', items: { type: 'string' }, description: 'Number columns, e.g. ["Calls", "Input", "Output"]' },
            rows: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, tag: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } }, required: ['label', 'values'] } },
            shareOf: { type: 'number', description: 'Index of the column the share bar is worked out from' },
         } },
         callout: { type: 'string', description: 'The one thing to take away, one sentence' },
         actions: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' }, value: { type: 'number' }, of: { type: 'number' }, label: { type: 'string', description: 'e.g. "of input", "of calls"' },
            people: { type: 'array', description: 'The leads or customers this action is about, up to 8, each with the phone number exactly as a tool returned it — the app makes each one a link to their WhatsApp chat', items: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' } }, required: ['name', 'phone'] } } }, required: ['title'] } },
         footnote: { type: 'string' },
      },
      required: ['headline'],
   },
   async run(args) {
      const report = cleanReport(args);
      if (!report) return { error: 'A report card needs a headline and some figures, a breakdown or actions' };
      return { report, note: 'The card is shown with the answer.' };
   },
});

/* ── a bot from a sentence ────────────────────────────────────────────────── */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

registerTool({
   name: 'create_bot',
   description: 'Set up a new scheduled bot from what the person describes ("every day at 9 send me a PDF of yesterday\'s leads", "every Monday check competitor prices and email me"). It reports on a schedule: give it a short name, the question it answers each run in plain words, when it runs, whether it may search the web, who it emails, and whether to attach the main table as a PDF or Excel file. Only prepares it — the bot is created when the person confirms. Admins only.',
   parameters: {
      type: 'object',
      properties: {
         name: { type: 'string' },
         icon: { type: 'string', description: 'One emoji' },
         instruction: { type: 'string', description: 'What it finds out each run, in plain words, complete enough to run on its own' },
         cadence: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'manual'] },
         hour: { type: 'number', description: '0–23, Dubai time' },
         dayOfWeek: { type: 'string', description: 'For weekly: monday … sunday' },
         dayOfMonth: { type: 'number', description: 'For monthly: 1–28' },
         web: { type: 'boolean' },
         emailTo: { type: 'array', items: { type: 'string' }, description: 'Addresses to email each result to. "Me" means the person asking (their address is given below).' },
         attach: { type: 'string', enum: ['', 'pdf', 'excel'] },
      },
      required: ['name', 'instruction', 'cadence'],
   },
   async run(a, { user } = {}) {
      if (user?.role !== 'admin') return { error: 'Only admins can set up bots' };
      const { cleanBot } = await import('../../routes/bots.js');
      const { describeSchedule } = await import('../bots.js');
      const dow = DAYS.indexOf(String(a.dayOfWeek || '').toLowerCase());
      // "Me" is the person asking.
      let emailTo = (Array.isArray(a.emailTo) ? a.emailTo : []).map((e) => String(e).trim());
      if (emailTo.some((e) => /^(me|myself|my email)$/i.test(e))) {
         const { User } = await import('../../models/index.js');
         const me = user?.email || (await User.findById(user?.id).select('email').lean().catch(() => null))?.email;
         emailTo = emailTo.map((e) => (/^(me|myself|my email)$/i.test(e) ? me : e)).filter(Boolean);
      }
      const { bot, errors } = cleanBot({
         name: a.name, icon: a.icon || '🤖', kind: 'ai_report', instruction: a.instruction, web: Boolean(a.web),
         emailTo, attach: a.attach || '',
         schedule: { cadence: a.cadence, hour: a.hour ?? 9, dayOfWeek: dow >= 0 ? dow : 1, dayOfMonth: a.dayOfMonth ?? 1 },
      });
      if (errors.length) return { error: errors.join('. ') };
      if (bot.attach && !bot.emailTo.length) return { error: 'A file is attached to an email — who should it go to?' };
      const summary = [
         `New bot: ${bot.icon} ${bot.name}`,
         `Runs: ${describeSchedule(bot.schedule)}${bot.web ? ' · searches the web' : ''}`,
         `Each run: ${bot.instruction}`,
         ...(bot.emailTo.length ? [`Emails the result${bot.attach ? ` with a ${bot.attach === 'pdf' ? 'PDF' : 'Excel'} file` : ''} to ${bot.emailTo.join(', ')}`] : []),
      ];
      return { ...holdProposal({ user, kind: 'create_bot', summary, spec: bot }), instruction: 'Say in one line that the bot is ready to set up and nothing is created until they press Confirm.' };
   },
});
markProposalTool('create_bot');

registerRunner('create_bot', async (spec, { authHeader }) => {
   const base = `http://127.0.0.1:${process.env.PORT || 5010}/api`;
   const r = await fetch(`${base}/bots`, { method: 'POST', headers: { Authorization: authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify(spec) });
   const out = await r.json().catch(() => ({}));
   if (!r.ok) throw new Error(out.error || `Could not create it (${r.status})`);
   return { ok: true, message: `Bot “${spec.name}” is set up. It runs on its schedule; press Run now on the Bots page to try it.` };
});
