import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { toolByName, toolDefinitions, toolNames } from './tools.js';
import { DATASETS, exportPath } from './datasets.js';
import { tablePdf, tableWorkbook } from '../tableExport.js';

test('the new tools are offered to the assistant, each with a usable definition', () => {
   const names = toolNames();
   for (const n of ['export_file', 'leads_list', 'sales_summary', 'receivables', 'calls_summary', 'follow_ups_due', 'door_activity', 'roster_now']) {
      assert.ok(names.includes(n), `${n} is missing`);
   }
   assert.equal(new Set(names).size, names.length, 'no tool is listed twice');
   for (const d of toolDefinitions()) {
      assert.equal(d.function.parameters.type, 'object', d.function.name);
      assert.ok(d.function.description.length > 30, `${d.function.name} needs a description the model can choose by`);
   }
   const exp = toolByName('export_file');
   assert.deepEqual(exp.parameters.properties.dataset.enum, DATASETS);
   assert.deepEqual(exp.parameters.properties.format.enum, ['pdf', 'excel']);
});

test('a file\'s download address carries exactly what the answer used', () => {
   assert.equal(exportPath('leads', 'pdf', { from: '2026-10-26', to: '2026-10-27', owner: '', status: undefined }), '/assistant/export?dataset=leads&format=pdf&from=2026-10-26&to=2026-10-27');
   assert.equal(exportPath('tasks', 'excel', { when: 'overdue', mine: true }), '/assistant/export?dataset=tasks&format=excel&when=overdue&mine=true');
});

test('money and the door log are not shown to the wrong people', async () => {
   const rep = { user: { id: 'u', role: 'sales_rep' }, now: new Date() };
   assert.match((await toolByName('sales_summary').run({}, rep)).error, /admins and accounts/);
   assert.match((await toolByName('receivables').run({}, rep)).error, /admins and accounts/);
   assert.match((await toolByName('door_activity').run({}, rep)).error, /admins/);
});

test('a list as the assistant hands it over becomes a real PDF and a real workbook', async () => {
   const table = {
      title: 'Leads', subtitle: '2026-10-26 to 2026-10-27 · 2 leads',
      columns: [{ key: 'date', label: 'Date' }, { key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'status', label: 'Status' }, { key: 'owner', label: 'Owner' }, { key: 'size', label: 'Size (sq ft)' }],
      rows: [
         { id: 'a', date: '27 Oct 2026, 10:05', name: 'Daniel', phone: '971501112233', status: 'contact attempted', owner: 'Randa Mustafa', size: 50 },
         { id: 'b', date: '27 Oct 2026, 10:02', name: 'Ramy assem', phone: '971502223344', status: 'contacted', owner: 'Mahmoud Gohar', size: '' },
      ],
   };
   const pdf = await tablePdf(table);
   assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
   assert.ok(pdf.length > 1500);
   const xlsx = await tableWorkbook(table);
   const wb = new ExcelJS.Workbook();
   await wb.xlsx.load(xlsx);
   const ws = wb.worksheets[0];
   assert.equal(ws.getRow(1).getCell(1).value, 'Leads');
   assert.deepEqual(ws.getRow(4).values.slice(1), ['Date', 'Name', 'Phone', 'Status', 'Owner', 'Size (sq ft)']);
   assert.deepEqual(ws.getRow(5).values.slice(1), ['27 Oct 2026, 10:05', 'Daniel', '971501112233', 'contact attempted', 'Randa Mustafa', 50]);
   assert.equal(ws.getRow(6).getCell(2).value, 'Ramy assem');
});

import { splitOptions } from './index.js';

test('a question\'s set answers become buttons, and leave the message', () => {
   assert.deepEqual(splitOptions('Which size? 25 and 50 sq ft are free.\nOptions: 25 sq ft | 50 sq ft | Not sure'), {
      content: 'Which size? 25 and 50 sq ft are free.', options: ['25 sq ft', '50 sq ft', 'Not sure'],
   });
   assert.deepEqual(splitOptions('How should I send it?\n\noptions: WhatsApp | Email | Just create it.'), {
      content: 'How should I send it?', options: ['WhatsApp', 'Email', 'Just create it'],
   });
   assert.deepEqual(splitOptions('We received 61 leads yesterday.'), { content: 'We received 61 leads yesterday.', options: [] });
   assert.equal(splitOptions('Pick one\nOptions: a | b | c | d | e | f | g | h').options.length, 6);
});

test('booking from the Ask box: it is told to ask for what is missing, then prepare it for Confirm', async () => {
   const { readFileSync } = await import('fs');
   const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
   assert.match(src, /Booking a unit, making a quotation or raising an invoice works like the booking form/);
   assert.match(src, /ask only for what is still missing/);
   const q = toolByName('propose_quotation');
   assert.deepEqual(q.parameters.required, ['customerName', 'startDate', 'endDate', 'sendVia']);
   assert.ok(toolByName('propose_invoice'), 'invoices can be prepared too');
});
