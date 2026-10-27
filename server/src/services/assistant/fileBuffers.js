import { GeneratedFile } from '../../models/index.js';
import { buildDataset } from './datasets.js';
import { tablePdf, tableWorkbook } from '../tableExport.js';

/**
 * A download the assistant offered, as the file itself — for attaching to an
 * emailed bot report. Built the same way the download route builds it, for
 * the same person, so the attachment and the button hold the same table.
 */
export async function fileForEmail(file, { user, scope = null } = {}) {
   const url = new URL(file.path, 'http://x');
   const format = url.searchParams.get('format') === 'excel' ? 'excel' : 'pdf';
   let table;
   const made = /^\/assistant\/file\/([0-9a-f]{24})$/i.exec(url.pathname);
   if (made) {
      table = await GeneratedFile.findById(made[1]).lean();
      if (!table) throw new Error('The file has expired');
   } else if (url.pathname === '/assistant/export') {
      const { dataset, format: _f, site: _s, ...args } = Object.fromEntries(url.searchParams);
      table = await buildDataset(String(dataset), args, { user, scope, now: new Date() });
   } else {
      throw new Error('Not a file the assistant made');
   }
   const name = `${String(table.title || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}`;
   return format === 'excel'
      ? { filename: `${name}.xlsx`, content: await tableWorkbook(table), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      : { filename: `${name}.pdf`, content: await tablePdf(table), contentType: 'application/pdf' };
}
