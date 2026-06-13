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

export function drawCompanyLogo(doc, x, y, size = 44) {
    const logo = readLogoBuffer();
    if (logo) {
        doc.image(logo, x, y, { fit: [size, size], align: 'center', valign: 'center' });
        return;
    }
    doc.roundedRect(x, y, size, size, 6).fill('#5B2D8E');
    doc.font('Helvetica-Bold').fontSize(17).fillColor('#FFFFFF')
        .text('PB', x, y + Math.max(8, size / 4), { width: size, align: 'center' });
}
