// Favicon: the light tank (south-east facing) from the unit sheet, centered on a 48 px canvas.
//
// Usage: node scripts/make-favicon.mjs   (after scripts/import-units.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG, encodePNG } from './lib/png.mjs';
import { ROOT, crop, blank, blit } from './lib/pixel.mjs';

const SIZE = 48;
const sheet = decodePNG(fs.readFileSync(path.join(ROOT, 'src/art/units.png')));
const frames = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/art/units.json'), 'utf8')).frames;
const [x, y, w, h] = frames['u:lighttank:1'];
const icon = blank(SIZE, SIZE);
blit(icon, crop(sheet, x, y, w, h), Math.round((SIZE - w) / 2), Math.round((SIZE - h) / 2));
fs.mkdirSync(path.join(ROOT, 'public'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'public/favicon.png'), encodePNG(icon.w, icon.h, icon.data));
console.log(`public/favicon.png (${SIZE}x${SIZE})`);
