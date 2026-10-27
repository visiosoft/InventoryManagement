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
