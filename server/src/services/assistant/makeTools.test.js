import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanChart, cleanTable } from './makeTools.js';
import { checkMade } from './index.js';
import { toolByName } from './tools.js';

test('a chart and a table are made safe before they are drawn or stored', () => {
   assert.deepEqual(cleanChart({ type: 'donut', labels: ['Mon', 'Tue'], series: [{ name: 'Leads', values: [12, '30'] }, { values: [0, 0] }] }),
      { type: 'bar', title: 'Chart', labels: ['Mon', 'Tue'], series: [{ name: 'Leads', values: [12, 30] }] });
   assert.equal(cleanChart({ labels: [], series: [] }), null);
   assert.equal(cleanChart({ type: 'pie', labels: ['a', 'b'], series: [{ values: [1, 2] }, { values: [3, 4] }] }).series.length, 1, 'a pie has one series');
   const t = cleanTable({ title: 'Competitors', columns: ['Company', { label: 'AED / month', numeric: true }], rows: [['Delight', 900], ['Ruby', 950]] });
   assert.deepEqual(t.rows, [['Delight', 900], ['Ruby', 950]]);
   assert.equal(cleanTable({ columns: [], rows: [[1]] }), null);
});

test('a chart or file whose figures are not in the data is dropped', () => {
   const results = [
      { tool: 'leads_recent', result: { days: [{ day: 'Mon', leads: 61 }, { day: 'Tue', leads: 74 }] } },
      { tool: 'make_chart', result: { chart: { type: 'bar', labels: ['Mon', 'Tue'], series: [{ name: 'Leads', values: [61, 74] }] } } },
      { tool: 'make_chart', result: { chart: { type: 'bar', labels: ['Mon', 'Tue'], series: [{ name: 'Leads', values: [61, 99] }] } } },
      { tool: 'make_file', result: { generatedFileId: 'f1', file: { path: '/assistant/file/f1' }, table: { rows: [['Mon', 61], ['Tue', 74]] } } },
      { tool: 'make_file', result: { generatedFileId: 'f2', file: { path: '/assistant/file/f2' }, table: { rows: [['Mon', 610]] } } },
   ];
   const out = checkMade(results, 'chart my leads');
   assert.equal(out.charts.length, 1);
   assert.deepEqual(out.charts[0].series[0].values, [61, 74]);
   assert.deepEqual(out.droppedFiles, ['f2']);
   assert.equal(out.dropped, 2);
});

test('a bot from a sentence is only prepared, for admins, with a file only when someone gets the email', async () => {
   const t = toolByName('create_bot');
   assert.match((await t.run({ name: 'x', instruction: 'Leads yesterday', cadence: 'daily' }, { user: { role: 'sales_rep' } })).error, /Only admins/);
   assert.match((await t.run({ name: 'Leads PDF', instruction: 'Yesterday\'s leads', cadence: 'daily', attach: 'pdf' }, { user: { role: 'admin', id: 'u1' } })).error, /who should it go to/);
   const ok = await t.run({ name: 'Leads PDF', icon: '📄', instruction: 'Yesterday\'s leads, all of them', cadence: 'daily', hour: 9, attach: 'pdf', emailTo: ['mase@purplebox.ae'] }, { user: { role: 'admin', id: 'u1' } });
   assert.ok(ok.proposalId);
   assert.deepEqual(ok.summary, ['New bot: 📄 Leads PDF', 'Runs: Daily 09:00', 'Each run: Yesterday\'s leads, all of them', 'Emails the result with a PDF file to mase@purplebox.ae']);
});
