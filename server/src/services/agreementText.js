import PDFDocument from 'pdfkit';
import { drawCompanyLogo } from './pdfLogo.js';

/**
 * Placeholders available in the agreement template. Each resolves from the
 * populated contract (customer/unit/units populated).
 */
export function agreementPlaceholders(contract) {
  const customer = contract.customer || {};
  const allUnits = contract.units?.length ? contract.units : contract.unit ? [contract.unit] : [];
  const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
  const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const weeks = contract.startDate && contract.endDate
    ? Math.max(1, Math.ceil(Math.round((new Date(contract.endDate) - new Date(contract.startDate)) / 86400000) / 7))
    : '';

  return {
    customerName: customer.fullName || '',
    companyName: customer.company || customer.fullName || '',
    customerEmail: customer.email || '',
    customerPhone: (customer.phones && customer.phones[0]) || customer.phone || '',
    whatsapp: (customer.phones && customer.phones[1]) || (customer.phones && customer.phones[0]) || customer.phone || '',
    emergencyContact: (customer.accessPersons && customer.accessPersons[0]?.name)
      || (contract.authorizedPersons && contract.authorizedPersons[0]?.name) || '',
    emergencyNumber: customer.emergencyNumber
      || (customer.accessPersons && customer.accessPersons[0]?.phone)
      || (contract.authorizedPersons && contract.authorizedPersons[0]?.phone) || '',
    customerAddress: customer.address || '',
    emiratesId: customer.emiratesId || '',
    passportNumber: customer.passportNumber || '',
    accessType: allUnits.some((u) => u.shared) ? 'Shared' : 'Private',
    contractNo: contract.contractNo || '',
    startDate: fmt(contract.startDate),
    endDate: fmt(contract.endDate),
    todayDate: fmt(new Date()),
    weeks: String(weeks),
    unitNumbers: allUnits.map((u) => u.unitNumber).filter(Boolean).join(', '),
    unitSizes: allUnits.map((u) => (u.sizeSqf != null ? `${u.sizeSqf} sqft` : '')).filter(Boolean).join(', '),
    purpleboxRepresentative: (contract.timeline && contract.timeline.find((t) => t.author)?.author) || 'PurpleBox Storage',
    rate: money(contract.rate),
    leasedPrice: money(contract.leasedPrice || contract.rate),
    deposit: money(contract.deposit),
    totalQuotation: money(contract.totalQuotation),
  };
}

/** Replaces {{name}} tokens; unknown tokens are left visible so gaps show. */
export function mergeAgreementText(template, contract) {
  const values = agreementPlaceholders(contract);
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : m,
  );
}


// ── Signature embedding (both renderers) ─────────────────────────────────────
// The sign flow passes the captured signature so it is drawn exactly where it
// belongs — stamping at fixed coordinates broke once layouts came from
// templates. Templates may also place {{customerSignature}} to position it.

export const SIGNATURE_TOKEN = /\{\{\s*customerSignature\s*\}\}/;
const SIGNATURE_DATE_TOKEN = /\{\{\s*signatureDate\s*\}\}/g;

// {{signatureDate}} only becomes real when the document is actually signed —
// until then it prints a line to fill in.
function applySignatureDate(content, signedDate, sign) {
  const value = (sign || signedDate)
    ? new Date(signedDate || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '______________';
  return String(content || '').replace(SIGNATURE_DATE_TOKEN, value);
}

function dataUrlToPng(dataUrl) {
  if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
    try { return Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'); } catch { return null; }
  }
  return null;
}

/** The signature itself: drawn image, typed name, or a blank line when unsigned. */
function drawSignatureMark(doc, sign, signedDate, x = doc.page.margins.left) {
  const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const sigPng = sign ? dataUrlToPng(sign.signatureDataUrl) : null;
  const startY = doc.y;
  if (sigPng) {
    try { doc.image(sigPng, x, startY, { fit: [170, 42] }); } catch { /* bad image */ }
    doc.y = startY + 46;
  } else if (sign?.signerName) {
    doc.font('Helvetica-Oblique').fontSize(20).fillColor('#1a1a5c').text(sign.signerName, x, startY + 6);
    doc.y = startY + 34;
  } else {
    doc.y = startY + 30; // room for a wet signature
  }
  doc.font('Helvetica').fontSize(10).fillColor('#000').text('_________________________', x, doc.y);
  if (sign?.signerName) {
    doc.fontSize(8.5).fillColor('#333').text(`${sign.signerName} · signed ${fmt(signedDate || new Date())}`, x, doc.y + 2);
  }
  doc.fillColor('#000');
  doc.moveDown(0.6);
}

/** The full end-of-document block (used when the template has no token). */
function drawSignatureBlock(doc, { signedDate, sign }) {
  doc.moveDown(2);
  if (doc.y > 640) doc.addPage();
  const y = doc.y;
  const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text('Tenant signature:', 56, y);
  doc.y = y + 14;
  drawSignatureMark(doc, sign, signedDate, 56);
  const leftBottom = doc.y;

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text('For PurpleBox Storage:', 320, y);
  doc.font('Helvetica').text('_________________________', 320, y + 44);

  doc.y = Math.max(leftBottom, y + 60);
  doc.font('Helvetica').fontSize(9.5).fillColor('#555')
    .text(signedDate ? `Signed on ${fmt(signedDate)}` : `Generated on ${fmt(new Date())}`, 56);
  doc.fillColor('#000');
}

/** Initials on every page except the last, drawn once all pages exist. */
function drawPageInitials(doc, sign, signedDate) {
  if (!sign) return;
  const range = doc.bufferedPageRange();
  const initialsPng = dataUrlToPng(sign.initialsDataUrl);
  const label = (sign.initialsText || '').trim()
    || String(sign.signerName || '').split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').join('');
  const dateStr = new Date(signedDate || Date.now()).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  for (let i = range.start; i < range.start + range.count - 1; i++) {
    doc.switchToPage(i);
    const x = doc.page.width - 150;
    const yBase = doc.page.height - 62;
    if (initialsPng) {
      try { doc.image(initialsPng, x, yBase, { fit: [80, 28] }); } catch { /* skip */ }
    } else if (label) {
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#14081F').text(label, x, yBase + 4, { lineBreak: false });
    }
    doc.font('Helvetica').fontSize(7).fillColor('#777').text(`initials · ${dateStr}`, x, yBase + 34, { lineBreak: false });
  }
  doc.switchToPage(range.start + range.count - 1);
  doc.fillColor('#000');
}

/**
 * Renders agreement text to a PDF. Light structure rules:
 *   line starting with "# "  → section heading (bold, larger)
 *   line starting with "## " → sub-heading (bold)
 *   blank line               → paragraph break
 * Ends with the signature block used by the signing flow.
 */
export function renderAgreementTextPdf({ text, contract, signedDate, header = true, signature = true, title = 'STORAGE AGREEMENT', sign = null }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawCompanyLogo(doc, 56, 44, 48);
    doc.fontSize(18).font('Helvetica-Bold').text('STORAGE AGREEMENT', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10.5).font('Helvetica').fillColor('#555')
      .text(`Contract No: ${contract.contractNo || ''}`, { align: 'center' });
    doc.moveDown(1.2).fillColor('#000');

    for (const rawLine of String(text || '').split('\n')) {
      const line = rawLine.trimEnd();
      if (!line.trim()) { doc.moveDown(0.55); continue; }
      if (SIGNATURE_TOKEN.test(line)) {
        const parts = line.split(SIGNATURE_TOKEN.exec(line)[0]);
        if (parts[0]?.trim()) doc.fontSize(10).font('Helvetica').text(parts[0], { lineGap: 2 });
        drawSignatureMark(doc, sign, signedDate);
        if (parts[1]?.trim()) doc.fontSize(10).font('Helvetica').text(parts[1], { lineGap: 2 });
        continue;
      }
      if (line.startsWith('## ')) {
        doc.moveDown(0.25);
        doc.fontSize(11).font('Helvetica-Bold').text(line.slice(3));
        doc.moveDown(0.2);
      } else if (line.startsWith('# ')) {
        doc.moveDown(0.4);
        doc.fontSize(12.5).font('Helvetica-Bold').text(line.slice(2));
        doc.moveDown(0.25);
      } else {
        doc.fontSize(10).font('Helvetica').text(line, { lineGap: 2 });
      }
    }

    // End block only when the template didn't position the signature itself
    if (signature && !hasToken) {
      drawSignatureBlock(doc, { signedDate, sign });
    }
    drawPageInitials(doc, sign, signedDate);

    doc.end();
  });
}

// ── Rich (HTML) rendering ─────────────────────────────────────────────────────
// Word pastes arrive as HTML — headings, bold runs, tables. A compact subset
// renderer keeps the design in the PDF: h1–h3, p/div, b/strong, i/em, u,
// ul/ol/li, br, and table/tr/td drawn as a bordered grid.
import { parse as parseHtml } from 'node-html-parser';

export const looksLikeHtml = (s) => /<\s*(p|div|table|h[1-6]|ul|ol|li|br|b|strong|i|em|u|span|tr|td)\b/i.test(String(s || ''));

/** Sample values so a template can be previewed without a contract. */
export function samplePlaceholderContract() {
  return {
    contractNo: 'PB-2026-0000',
    startDate: new Date(),
    endDate: new Date(Date.now() + 28 * 86400000),
    rate: 800, leasedPrice: 750, deposit: 750, totalQuotation: 1580,
    customer: {
      fullName: 'Sample Tenant', company: 'Sample Trading LLC', email: 'tenant@example.com', phone: '+971 50 000 0000',
      phones: ['+971 50 000 0000', '+971 55 000 0000'], emergencyNumber: '+971 52 000 0000',
      accessPersons: [{ name: 'Sample Contact', phone: '+971 52 000 0000' }],
      address: 'Dubai, UAE', emiratesId: '784-0000-0000000-0', passportNumber: 'A0000000',
    },
    unit: { unitNumber: 'F2-09', sizeSqf: 25 },
    units: [],
  };
}

function inlineRuns(node, inherited = {}) {
  // Flattens a node into [{text, bold, italic, underline}] runs
  const runs = [];
  const walk = (n, st) => {
    if (n.nodeType === 3) { // text
      const t = n.text.replace(/\s+/g, ' ');
      if (t) runs.push({ text: t, ...st });
      return;
    }
    const tag = (n.tagName || '').toLowerCase();
    const next = { ...st };
    if (tag === 'b' || tag === 'strong') next.bold = true;
    if (tag === 'i' || tag === 'em') next.italic = true;
    if (tag === 'u') next.underline = true;
    if (tag === 'br') { runs.push({ text: '\n', ...st }); return; }
    for (const child of n.childNodes) walk(child, next);
  };
  walk(node, inherited);
  return runs;
}

function drawRuns(doc, runs, opts = {}) {
  const size = opts.size ?? 10;
  const parts = runs.filter((r) => r.text.trim() || r.text === '\n');
  if (!parts.length) return;
  parts.forEach((r, i) => {
    const font = r.bold && r.italic ? 'Helvetica-BoldOblique'
      : r.bold ? 'Helvetica-Bold'
        : r.italic ? 'Helvetica-Oblique'
          : 'Helvetica';
    doc.font(font).fontSize(size).fillColor('#000').text(r.text, {
      continued: i < parts.length - 1,
      underline: !!r.underline,
      lineGap: 2,
    });
  });
}

function drawTable(doc, tableNode) {
  const rows = tableNode.querySelectorAll('tr').map((tr) =>
    tr.childNodes.filter((n) => ['td', 'th'].includes((n.tagName || '').toLowerCase())),
  ).filter((r) => r.length);
  if (!rows.length) return;

  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;
  const cols = Math.max(...rows.map((r) => r.length));
  const colW = usable / cols;
  const padding = 5;

  for (const row of rows) {
    const isHeader = row.some((c) => (c.tagName || '').toLowerCase() === 'th');
    // Measure the tallest cell first so the row has one height. A cell holding
    // {{customerSignature}} draws the captured signature inside itself.
    const cells = row.map((cell) => {
      const raw = cell.text.replace(/\s+/g, ' ').trim();
      const hasSig = SIGNATURE_TOKEN.test(raw);
      return { text: raw.replace(SIGNATURE_TOKEN, '').trim(), hasSig };
    });
    const sign = doc._pbSign || null;
    const heights = cells.map((c) => {
      let h = doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5)
        .heightOfString(c.text || ' ', { width: colW - padding * 2 });
      if (c.hasSig) h += 52; // room for the signature (or a wet-sign gap)
      return h;
    });
    const rowH = Math.max(...heights, 12) + padding * 2;

    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
    const y = doc.y;
    row.forEach((cell, i) => {
      const x = left + i * colW;
      doc.rect(x, y, colW, rowH).strokeColor('#999').lineWidth(0.6).stroke();
      doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor('#000')
        .text(cells[i].text || '', x + padding, y + padding, { width: colW - padding * 2 });
      if (cells[i].hasSig) {
        const textH = doc.heightOfString(cells[i].text || ' ', { width: colW - padding * 2 });
        const sigY = y + padding + (cells[i].text ? textH + 3 : 0);
        const sigPng = sign ? dataUrlToPng(sign.signatureDataUrl) : null;
        if (sigPng) {
          try { doc.image(sigPng, x + padding, sigY, { fit: [Math.min(150, colW - padding * 2), 36] }); } catch { /* skip */ }
        } else if (sign?.signerName) {
          doc.font('Helvetica-Oblique').fontSize(16).fillColor('#1a1a5c')
            .text(sign.signerName, x + padding, sigY + 8, { width: colW - padding * 2 });
        }
        if (sign?.signerName) {
          const dateStr = new Date(doc._pbSignedDate || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
          doc.font('Helvetica').fontSize(7.5).fillColor('#333')
            .text(`${sign.signerName} · signed ${dateStr}`, x + padding, y + rowH - 12, { width: colW - padding * 2, lineBreak: false });
        }
        doc.fillColor('#000');
      }
    });
    doc.x = left;
    doc.y = y + rowH;
  }
  doc.moveDown(0.5);
}

function renderHtmlBody(doc, root) {
  for (const node of root.childNodes) {
    const tag = (node.tagName || '').toLowerCase();
    if (node.nodeType === 3) {
      const t = node.text.trim();
      if (t) { doc.font('Helvetica').fontSize(10).text(t, { lineGap: 2 }); doc.moveDown(0.35); }
      continue;
    }
    if (!tag) continue;
    if (tag === 'style' || tag === 'script' || tag === 'meta' || tag === 'link') continue;
    if (['h1', 'h2', 'h3', 'h4'].includes(tag)) {
      const size = tag === 'h1' ? 14 : tag === 'h2' ? 12.5 : 11;
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(size).text(node.text.replace(/\s+/g, ' ').trim());
      doc.moveDown(0.3);
    } else if (tag === 'table') {
      drawTable(doc, node);
    } else if (tag === 'ul' || tag === 'ol') {
      const items = node.querySelectorAll('li');
      items.forEach((li, i) => {
        const bullet = tag === 'ol' ? (i + 1) + '. ' : '•  ';
        doc.font('Helvetica').fontSize(10).text(bullet, { continued: true, lineGap: 2 });
        drawRuns(doc, inlineRuns(li));
        doc.moveDown(0.15);
      });
      doc.moveDown(0.35);
    } else if (tag === 'br') {
      doc.moveDown(0.5);
    } else if (tag === 'p' || tag === 'div' || tag === 'section') {
      // Nested block content (Word wraps tables and lists inside divs)
      const hasBlockChild = node.childNodes.some((c) => ['table', 'p', 'div', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4'].includes((c.tagName || '').toLowerCase()));
      if (hasBlockChild) { renderHtmlBody(doc, node); continue; }
      if (SIGNATURE_TOKEN.test(node.text)) {
        const runs = inlineRuns(node).map((r) => ({ ...r, text: r.text.replace(SIGNATURE_TOKEN, '').trim() })).filter((r) => r.text);
        if (runs.length) { drawRuns(doc, runs); doc.moveDown(0.3); }
        drawSignatureMark(doc, doc._pbSign || null, doc._pbSignedDate || null);
        continue;
      }
      const runs = inlineRuns(node);
      if (runs.length) { drawRuns(doc, runs); doc.moveDown(0.45); }
    } else {
      const runs = inlineRuns(node);
      if (runs.length) { drawRuns(doc, runs); doc.moveDown(0.35); }
    }
  }
}

/** Renders rich (HTML) agreement/notice content to PDF, keeping the design. */
export function renderAgreementHtmlPdf({ html, contract, signedDate, title = 'STORAGE AGREEMENT', header = true, signature = true, sign = null }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true });
    html = applySignatureDate(html, signedDate, sign);
    const hasToken = SIGNATURE_TOKEN.test(String(html || ''));
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (header) {
      drawCompanyLogo(doc, 56, 44, 48);
      doc.fontSize(18).font('Helvetica-Bold').text(title, { align: 'center' });
      if (contract?.contractNo) {
        doc.moveDown(0.3);
        doc.fontSize(10.5).font('Helvetica').fillColor('#555').text(`Contract No: ${contract.contractNo}`, { align: 'center' });
      }
      doc.moveDown(1.2).fillColor('#000');
    }

    doc._pbSign = sign;
    doc._pbSignedDate = signedDate;
    const root = parseHtml(String(html || ''));
    renderHtmlBody(doc, root);

    if (signature && !hasToken) {
      drawSignatureBlock(doc, { signedDate, sign });
    }
    drawPageInitials(doc, sign, signedDate);

    doc.end();
  });
}
