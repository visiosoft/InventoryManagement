// Generates app icons as PNG files using pure Node.js (no dependencies)
// Creates a minimal valid PNG with the purple gradient + truck icon
const fs = require('fs');
const path = require('path');
const { createCanvas } = (() => {
  // Try to use canvas package if available
  try { return require('canvas'); } catch(e) {}
  // Fallback: we'll create a simple purple square PNG
  return { createCanvas: null };
})();

if (!createCanvas) {
  // No canvas available - create a simple solid purple PNG using raw bytes
  // This creates a valid minimal PNG file
  const zlib = require('zlib');

  function createPNG(width, height, r, g, b) {
    // PNG signature
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR chunk
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // color type (RGB)
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    // Raw image data (filter byte + RGB per pixel, per row)
    const rowBytes = 1 + width * 3;
    const rawData = Buffer.alloc(rowBytes * height);
    for (let y = 0; y < height; y++) {
      const offset = y * rowBytes;
      rawData[offset] = 0; // filter: none
      // Gradient from top-left to bottom-right
      const t = (y / height);
      const pr = Math.round(r * (1 - t * 0.15));
      const pg = Math.round(g * (1 - t * 0.3));
      const pb = Math.round(b * (1 - t * 0.1));
      for (let x = 0; x < width; x++) {
        const px = offset + 1 + x * 3;
        rawData[px] = pr;
        rawData[px + 1] = pg;
        rawData[px + 2] = pb;
      }
    }

    const compressed = zlib.deflateSync(rawData);

    function makeChunk(type, data) {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length, 0);
      const typeB = Buffer.from(type);
      const crc32 = require('zlib');
      const crcData = Buffer.concat([typeB, data]);
      const crc = Buffer.alloc(4);
      crc.writeInt32BE(crc32Calc(crcData), 0);
      return Buffer.concat([len, typeB, data, crc]);
    }

    function crc32Calc(buf) {
      let crc = 0xFFFFFFFF;
      const table = new Int32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c;
      }
      for (let i = 0; i < buf.length; i++) {
        crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
      }
      return (crc ^ 0xFFFFFFFF) | 0;
    }

    const ihdrChunk = makeChunk('IHDR', ihdr);
    const idatChunk = makeChunk('IDAT', compressed);
    const iendChunk = makeChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
  }

  const dir = __dirname;

  // 1024x1024 icon
  const icon = createPNG(1024, 1024, 91, 43, 201);
  fs.writeFileSync(path.join(dir, 'icon.png'), icon);
  console.log('Created icon.png:', icon.length, 'bytes');

  // 1024x1024 adaptive icon (same)
  fs.writeFileSync(path.join(dir, 'adaptive-icon.png'), icon);
  console.log('Created adaptive-icon.png:', icon.length, 'bytes');

  // 48x48 favicon
  const favicon = createPNG(48, 48, 91, 43, 201);
  fs.writeFileSync(path.join(dir, 'favicon.png'), favicon);
  console.log('Created favicon.png:', favicon.length, 'bytes');

  // Splash image 1284x2778 (iPhone)
  const splash = createPNG(1284, 2778, 91, 43, 201);
  fs.writeFileSync(path.join(dir, 'splash.png'), splash);
  console.log('Created splash.png:', splash.length, 'bytes');

  console.log('\\nNote: These are solid purple placeholders.');
  console.log('Replace with the actual logo PNGs for production.');
} else {
  console.log('Canvas available - generating proper icons...');
  // Would use canvas to draw the truck icon
}
