// Map art import: PixelLab trees, peaks and decorations (assets/map.json) → src/art/map.png + map.json.
// Neutral art (no team key): every pixel snapped to the palette. Groups become numbered sprites
// (`tree:d00`, `peak:03`, ...), decorations `prop:<name>`. Standing art is anchored at its base.
//
// Usage: node scripts/import-map.mjs
import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from './lib/png.mjs';
import { ROOT, bbox, crop, blank, blit, pack } from './lib/pixel.mjs';
import { prepare } from './lib/teamart.mjs';

const M = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/map.json'), 'utf8'));
const frames = [];
const retint = M.decor.remap ?? { items: [], colors: {} };
const retintTo = new Map(Object.entries(retint.colors).filter(([k]) => k.startsWith('#')).map(([k, v]) => [k.toLowerCase(), [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16))]));
const add = (name, file, anchor) => {
  if (!fs.existsSync(file)) { console.warn(`${name}: missing ${file}`); return; }
  const img = prepare(file, { team: false });
  if (retint.items.includes(name.replace('prop:', '')))
    for (let i = 0; i < img.data.length; i += 4) {
      const hex = '#' + [0, 1, 2].map((k) => img.data[i + k].toString(16).padStart(2, '0')).join('');
      const to = retintTo.get(hex);
      if (to && img.data[i + 3]) img.data.set(to, i);
    }
  const bb = bbox(img);
  if (!bb) return;
  const c = crop(img, bb.x0, bb.y0, bb.x1 - bb.x0 + 1, bb.y1 - bb.y0 + 1);
  const ox = Math.round(c.w / 2), oy = anchor === 'bottom' ? c.h - 2 : Math.round(c.h / 2);
  frames.push({ name, img: c, ox, oy });
};
for (const [prefix, g] of Object.entries(M.groups))
  g.pick.forEach((idx, n) => add(`${prefix}${String(n).padStart(2, '0')}`, path.join(ROOT, 'assets', g.dir, `${idx}.png`), g.anchor));
const flat = new Set(M.decor.flat);
for (const [name, idx] of Object.entries(M.decor.items)) add(`prop:${name}`, path.join(ROOT, 'assets', M.decor.dir, `${idx}.png`), flat.has(name) ? 'center' : M.decor.anchor);

const W = 1024;
const { pos, height } = pack(frames.map((f) => f.img), W);
const sheet = blank(W, height);
const out = {};
frames.forEach((f, i) => {
  blit(sheet, f.img, pos[i].x, pos[i].y);
  out[f.name] = [pos[i].x, pos[i].y, f.img.w, f.img.h, f.ox, f.oy];
});
fs.writeFileSync(path.join(ROOT, 'src/art/map.png'), encodePNG(sheet.w, sheet.h, sheet.data));
fs.writeFileSync(path.join(ROOT, 'src/art/map.json'), JSON.stringify({ frames: out }));
console.log(`map: ${frames.length} sprites → src/art/map.png (${sheet.w}x${sheet.h})`);
