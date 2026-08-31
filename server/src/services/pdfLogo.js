import fs from 'node:fs';
import path from 'node:path';

const LOGO_PATH = path.resolve(process.cwd(), '../client/public/Invoicelogo_Logo.png');
let cachedLogo = null;

function readLogoBuffer() {
    if (cachedLogo !== null) return cachedLogo;
    try {
        cachedLogo = fs.readFileSync(LOGO_PATH);
    } catch {
        cachedLogo = undefined;
    }
    return cachedLogo;
}

/**
 * Draw the letterhead logo.
 *
 * `override` is a facility's own logo bytes, already loaded — the drawing
 * happens inside a PDF stream and cannot wait on a fetch. Passing nothing
 * keeps the file on disk that every document used before facilities existed,
 * so the seven existing call sites need no change and print the same mark.
 */
export function drawCompanyLogo(doc, x, y, size = 44, override) {
    const logo = override ?? readLogoBuffer();
    if (logo) {
        doc.image(logo, x, y, { fit: [size, size], align: 'center', valign: 'center' });
        return;
    }
    doc.roundedRect(x, y, size, size, 6).fill('#5B2D8E');
    doc.font('Helvetica-Bold').fontSize(17).fillColor('#FFFFFF')
        .text('PB', x, y + Math.max(8, size / 4), { width: size, align: 'center' });
}
