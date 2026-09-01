/**
 * Downloading the table you are looking at.
 *
 * The page posts its own rows rather than naming a query to re-run, so the
 * file is what was on screen — same filters, same window, same sort order. It
 * is the rule the AI reports already download by, and the reason a file can be
 * trusted to match the page it came from.
 *
 * Generic on purpose: one pair of endpoints any table can use, rather than a
 * new export route each time somebody wants a list on paper.
 */

import { Router } from 'express';
import { tablePdf, tableWorkbook } from '../services/tableExport.js';
import { companyForSite } from '../services/companyIdentity.js';

const router = Router();

const MAX_ROWS = 5000;
const MAX_COLUMNS = 40;

/** Read the posted table, or say what is wrong with it. */
function readSpec(body) {
   const columns = Array.isArray(body?.columns) ? body.columns : [];
   const rows = Array.isArray(body?.rows) ? body.rows : [];
   if (!columns.length) return { error: 'No columns to export' };
   if (columns.length > MAX_COLUMNS) return { error: `Too many columns (limit ${MAX_COLUMNS})` };
   if (rows.length > MAX_ROWS) return { error: `Too many rows (limit ${MAX_ROWS})` };
   return {
      title: String(body.title || 'Export').slice(0, 120),
      subtitle: String(body.subtitle || '').slice(0, 300),
      // Column labels only — a client cannot ask this to read anything.
      columns: columns.map((c) => (typeof c === 'string'
         ? { label: c.slice(0, 60) }
         : { label: String(c.label ?? '').slice(0, 60), numeric: Boolean(c.numeric) })),
      rows,
   };
}

/** A filename that survives Windows, macOS and an email client. */
const safeName = (title) => String(title || 'export')
   .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'export';

router.post('/xlsx', async (req, res) => {
   const spec = readSpec(req.body);
   if (spec.error) return res.status(400).json({ error: spec.error });
   try {
      const buffer = await tableWorkbook(spec);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName(spec.title)}.xlsx"`);
      res.send(buffer);
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

router.post('/pdf', async (req, res) => {
   const spec = readSpec(req.body);
   if (spec.error) return res.status(400).json({ error: spec.error });
   try {
      // The facility's own letterhead, so a document from Al Quoz does not go
      // out naming the other building.
      const company = await companyForSite(req.query.site).catch(() => null);
      const buffer = await tablePdf({ ...spec, company });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName(spec.title)}.pdf"`);
      res.send(buffer);
   } catch (e) {
      res.status(500).json({ error: e.message });
   }
});

export default router;
