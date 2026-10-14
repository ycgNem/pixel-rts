// Contact sheet: many PNGs in one labeled image, so a batch of candidates can be reviewed at once.
// Each cell shows the image at an integer scale with its index (file order) in the corner.
//
// Usage: node scripts/contact.mjs <dir | files…> --out sheet.png [--scale 3] [--cols 8] [--snap]
//   --snap  show every image snapped to the game palette (what the import will produce)
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG, encodePNG } from './lib/png.mjs';
import { detectScale, downscale, quantize, blank } from './lib/pixel.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outFile = opt('--out', 'contact.png'), K = +opt('--scale', 3), snap = args.includes('--snap');
const skip = new Set(['--out', '--scale', '--cols'].flatMap((k) => { const i = args.indexOf(k); return i >= 0 ? [i, i + 1] : []; }));
let files = args.filter((a, i) => !skip.has(i) && !a.startsWith('--'));
if (files.length === 1 && fs.statSync(files[0]).isDirectory()) {
  const d = files[0];
  files = fs.readdirSync(d).filter((f) => /\.png$/i.test(f)).sort((x, y) => x.localeCompare(y, undefined, { numeric: true })).map((f) => path.join(d, f));
}
const imgs = files.map((f) => {
  const raw = decodePNG(fs.readFileSync(f));
  const img = downscale(raw, detectScale(raw)).img;
  if (snap) quantize(img);
  return img;
});
const COLS = +opt('--cols', Math.min(8, imgs.length));
const CW = Math.max(...imgs.map((i) => i.w)) * K + 4, CH = Math.max(...imgs.map((i) => i.h)) * K + 4;
const rows = Math.ceil(imgs.length / COLS);
const sheet = blank(COLS * CW, rows * CH);
for (let y = 0; y < sheet.h; y++)
  for (let x = 0; x < sheet.w; x++) {
    const cx = Math.floor(x / CW), cy = Math.floor(y / CH);
    const edge = x % CW < 1 || y % CH < 1;
    sheet.data.set(edge ? [20, 16, 24, 255] : ((x >> 3) + (y >> 3)) & 1 ? [70, 64, 78, 255] : [(cx + cy) & 1 ? 96 : 84, 88, 98, 255], (y * sheet.w + x) * 4);
  }
// 3x5 digits
const DIG = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
function label(n, x0, y0) {
  const s = String(n);
  const S = 2;
  for (let y = -1; y < 6; y++) for (let x = -1; x < s.length * 4; x++) put(x0 + x * S, y0 + y * S, [0, 0, 0], S);
  [...s].forEach((ch, k) => {
    const g = DIG[+ch];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (g[y * 3 + x] === '1') put(x0 + (k * 4 + x) * S, y0 + y * S, [255, 230, 120], S);
  });
}
function put(x, y, c, S) {
  for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
    const px = x + xx, py = y + yy;
    if (px >= 0 && py >= 0 && px < sheet.w && py < sheet.h) sheet.data.set([...c, 255], (py * sheet.w + px) * 4);
  }
}
imgs.forEach((img, i) => {
  const ox = (i % COLS) * CW + 2, oy = Math.floor(i / COLS) * CH + 2;
  for (let y = 0; y < img.h * K; y++)
    for (let x = 0; x < img.w * K; x++) {
      const p = (Math.floor(y / K) * img.w + Math.floor(x / K)) * 4;
      if (img.data[p + 3] >= 128) sheet.data.set([img.data[p], img.data[p + 1], img.data[p + 2], 255], ((oy + y) * sheet.w + ox + x) * 4);
    }
  label(i, ox + 1, oy + 1);
});
fs.writeFileSync(outFile, encodePNG(sheet.w, sheet.h, sheet.data));
console.log(`${outFile}: ${imgs.length} images, ${COLS} per row, x${K}${snap ? ', snapped to the palette' : ''}`);
