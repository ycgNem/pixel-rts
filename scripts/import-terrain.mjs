// Terrain import: PixelLab Wang tilesets → src/art/terrain.png + terrain.json.
// Every tile is cut by its bounding box, snapped to the palette (plus the recipe's remaps), and
// named by its corners: `t:<pair>:<mask>` with mask bits NW=8, NE=4, SW=2, SE=1 set where the
// corner is the upper terrain. `tm:<pair>:<mask>` is the same tile with the lower terrain's pixels
// cleared, for drawing layers over other terrain.
//
// Usage: node scripts/import-terrain.mjs [assets/terrain.json]
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG, encodePNG } from './lib/png.mjs';
import { ROOT, quantize, crop, blank, blit, rgbOf } from './lib/pixel.mjs';

const recipeFile = path.resolve(process.argv[2] ?? path.join(ROOT, 'assets/terrain.json'));
const R = JSON.parse(fs.readFileSync(recipeFile, 'utf8'));
const base = path.dirname(recipeFile);
const remap = new Map(Object.entries(R.remap ?? {}).map(([a, b]) => [a.toLowerCase(), rgbOf(b.toLowerCase())]));
const T = 32;
const tiles = [];
for (const p of R.pairs) {
  const dir = path.join(base, p.dir);
  const img = decodePNG(fs.readFileSync(path.join(dir, 'tileset.png')));
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'tileset.json'), 'utf8'));
  const list = meta.tileset_data?.tiles ?? meta.tiles;
  const byMask = new Map();
  const pairRemap = new Map(Object.entries(p.remap ?? {}).map(([a, b]) => [a.toLowerCase(), rgbOf(b.toLowerCase())]));
  for (const t of list) {
    const c = t.corners;
    const up = (k) => (c[k] === 'upper' ? 1 : 0);
    const mask = up('NW') * 8 + up('NE') * 4 + up('SW') * 2 + up('SE');
    const bb = t.bounding_box;
    const tile = crop(img, bb.x, bb.y, bb.width, bb.height);
    quantize(tile);
    if (remap.size) for (let i = 0; i < tile.data.length; i += 4) {
      const h = '#' + [0, 1, 2].map((k) => tile.data[i + k].toString(16).padStart(2, '0')).join('');
      const to = pairRemap.get(h) ?? remap.get(h);
      if (to) tile.data.set(to, i);
    }
    if (!byMask.has(mask)) byMask.set(mask, tile);
  }
  if (byMask.size < 16) console.warn(`${p.name}: only ${byMask.size} corner patterns`);
  // colors of the pure lower tile: anything else in a tile counts as the upper terrain (incl. its fringe)
  const lower = byMask.get(0);
  const lowerColors = new Set();
  for (let i = 0; i < lower.data.length; i += 4) lowerColors.add((lower.data[i] << 16) | (lower.data[i + 1] << 8) | lower.data[i + 2]);
  for (const [mask, tile] of byMask) {
    tiles.push({ name: `t:${p.name}:${mask}`, img: tile });
    const m = { w: tile.w, h: tile.h, data: Uint8Array.from(tile.data) };
    for (let i = 0; i < m.data.length; i += 4) if (lowerColors.has((m.data[i] << 16) | (m.data[i + 1] << 8) | m.data[i + 2]) && mask !== 15) m.data[i + 3] = 0;
    if (mask !== 15) tiles.push({ name: `tm:${p.name}:${mask}`, img: m });
  }
}
const cols = 16;
const sheet = blank(cols * T, Math.ceil(tiles.length / cols) * T);
const frames = {};
tiles.forEach((t, i) => {
  const x = (i % cols) * T, y = Math.floor(i / cols) * T;
  blit(sheet, t.img, x, y);
  frames[t.name] = [x, y, T, T, 0, 0];
});
fs.mkdirSync(path.join(ROOT, 'src/art'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src/art/terrain.png'), encodePNG(sheet.w, sheet.h, sheet.data));
fs.writeFileSync(path.join(ROOT, 'src/art/terrain.json'), JSON.stringify({ frames, layers: R.pairs.map((p) => ({ name: p.name, lower: p.lower, upper: p.upper })) }));
console.log(`terrain: ${tiles.length} tiles from ${R.pairs.length} tilesets → src/art/terrain.png (${sheet.w}x${sheet.h})`);
