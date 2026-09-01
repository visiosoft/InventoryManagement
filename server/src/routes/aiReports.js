import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { buildReport, validateSpec, runSpec } from '../services/reportAgent.js';
import { blockCatalogue } from '../services/reportBlocks.js';
import { companyForSite } from '../services/companyIdentity.js';
import { drawCompanyLogo } from '../services/pdfLogo.js';

const router = Router();

/* Admin only. A report can reach every contract, every rate and every rep's
   numbers, which is a wider view than a rep or accounts has anywhere else in
   the app. Widening this later is a one-line change; narrowing it after people
   have seen the data is not. */
/* Admins and accounts. The figures a report can reach - revenue, every rep's
   numbers - are the ones accounts already work from, and they are the people
   most often asked for them. Nobody else. */
router.use((req, res, next) => (
    ['admin', 'accounts'].includes(req.user?.role)
        ? next()
        : res.status(403).json({ error: 'Admin access required' })
));

/** What can be asked about — shown on the page so the box is not a guess. */
router.get('/blocks', (_req, res) => {
    res.json(blockCatalogue().map(({ name, summary, shape }) => ({ name, summary, shape })));
});

/** A question in, a finished report out. */
router.post('/ask', async (req, res) => {
    try {
        const out = await buildReport({
            question: req.body?.question,
            siteId: req.body?.siteId ?? req.query.site,
        });
        if (!out.ok) return res.status(422).json(out);
        res.json(out);
    } catch (e) {
        res.status(502).json({ ok: false, reason: `The assistant could not be reached: ${e.message}` });
    }
});

/**
 * Re-run a report that has already been planned.
 *
 * The page sends back the plan it is showing rather than the original
 * question, so a download is the same report the person is looking at. Asking
 * again would re-plan it, and a model asked twice does not always answer the
 * same way — a PDF that quietly differs from the screen is worse than no PDF.
 */
async function resolveFromBody(body) {
    const checked = validateSpec(body?.spec);
    if (!checked.ok) return null;
    return runSpec(checked.spec, body?.siteId);
}

router.post('/pdf', async (req, res) => {
    const report = await resolveFromBody(req.body);
    if (!report) return res.status(400).json({ error: 'That report could not be rebuilt for download.' });

    const co = await companyForSite(req.body?.siteId && req.body.siteId !== 'all' ? req.body.siteId : null);
    const doc = new PDFDocument({ size: 'A4', margin: 46, info: { Title: report.title } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => {
        const pdf = Buffer.concat(chunks);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${slug(report.title)}.pdf"`);
        res.send(pdf);
    });

    const INK = '#14081F';
    const MUTED = '#756E80';
    const PURPLE = '#5B2BC9';
    const W = 595.28 - 92;

    drawCompanyLogo(doc, 46, 40, 38, co.logo);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(co.name, 92, 44);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text([co.addr1, co.addr2, co.phone].filter(Boolean).join(' · '), 92, 58, { width: W - 46 });

    doc.moveTo(46, 92).lineTo(46 + W, 92).strokeColor('#E5E7EB').lineWidth(0.5).stroke();

    doc.font('Helvetica-Bold').fontSize(17).fillColor(INK).text(report.title, 46, 106, { width: W });
    if (report.intro) doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(report.intro, { width: W });
    doc.moveDown(0.8);

    for (const s of report.sections) {
        if (doc.y > 720) doc.addPage();
        if (s.caption) {
            doc.font('Helvetica-Bold').fontSize(10).fillColor(PURPLE).text(s.caption, { width: W });
            doc.moveDown(0.2);
        }
        const d = s.data || {};

        if (d.stats) {
            for (const st of d.stats) {
                doc.font('Helvetica').fontSize(9.5).fillColor(INK)
                    .text(`${st.label}: ${st.value}${st.unit || ''}`, { width: W });
            }
        } else if (d.series) {
            // A chart is a picture of a table; print the table, which a PDF
            // reader can actually read numbers off.
            doc.font('Helvetica').fontSize(9).fillColor(INK);
            for (const p of d.series) {
                const vals = (d.keys || []).map((k) => `${k} ${p[k]}`).join('   ');
                doc.text(`${p.label}   ${vals}`, { width: W });
            }
        } else if (d.rows) {
            doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text((d.columns || []).join('   |   '), { width: W });
            doc.font('Helvetica').fontSize(8.5).fillColor(INK);
            for (const row of d.rows) {
                if (doc.y > 780) doc.addPage();
                doc.text(row.map((c) => (c === null || c === undefined ? '' : String(c))).join('   |   '), { width: W });
            }
            if (d.truncated) {
                doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED)
                    .text(`Showing ${d.rows.length} of ${d.rowsTotal}. Download the CSV for all of them.`, { width: W });
            }
        }
        if (d.note) {
            doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED).text(d.note, { width: W });
        }
        doc.moveDown(0.7);
    }

    if (report.closing) {
        doc.moveDown(0.3);
        doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(report.closing, { width: W });
    }

    /* Say where the figures came from. A report nobody can trace is a report
       nobody should act on. */
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(
        `Built ${new Date(report.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Dubai' })} · `
        + `${report.scope === 'all' ? 'all facilities' : co.siteName || 'one facility'} · `
        + `figures from: ${report.blocksUsed.map((b) => b.block).join(', ')}`,
        { width: W },
    );

    doc.end();
});

const slug = (s) => String(s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export default router;
