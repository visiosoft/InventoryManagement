// Dev utility: render a PDF page to PNG for visual coordinate checking.
// Usage: node render-pdf-page.mjs <pdf> <pageNum> <out.png>
import fs from 'fs';
import { createCanvas, Path2D, DOMMatrix, ImageData } from '@napi-rs/canvas';
globalThis.Path2D = Path2D;
globalThis.DOMMatrix = DOMMatrix;
globalThis.ImageData = ImageData;
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

const [pdfPath, pageNum, outPath] = process.argv.slice(2);
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await getDocument({
  data,
  disableFontFace: true,
  verbosity: 0,
  standardFontDataUrl: new URL('./node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
}).promise;
const page = await pdf.getPage(Number(pageNum));
const vp = page.getViewport({ scale: 0.85 });
const canvas = createCanvas(vp.width, vp.height);
const ctx = canvas.getContext('2d');
await page.render({ canvasContext: ctx, viewport: vp }).promise;
fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
console.log('rendered', outPath, vp.width, 'x', vp.height);
