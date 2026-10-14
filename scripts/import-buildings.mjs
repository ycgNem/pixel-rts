// Building, city and deposit art import: PixelLab objects → src/art/buildings.png + buildings.json.
//
// Buildings keep the team key (saturated blue → palette 44-48) and are anchored so the art's
// bottom-center sits on the bottom-center of the footprint (sprite `b:<kind>`, drawn at the
// footprint's bottom-left corner). Cities (`city:<level>`) and deposits (`dep:<kind>`) are neutral:
// no team key, anchored at their center. Scenery (`prop:<kind>`, from create_map_object, so
// `mapObject` instead of `object`) is neutral too; standing props are anchored at their base.
//
// Usage: node scripts/import-buildings.mjs [--fetch]
import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from './lib/png.mjs';
import { ROOT, bbox, crop, blank, blit, pack } from './lib/pixel.mjs';
import { get, prepare } from './lib/teamart.mjs';

const T = 32;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/buildings.json'), 'utf8'));
const SRC = path.join(ROOT, 'assets/pixellab/buildings');
const url = (id) => `https://backblaze.pixellab.ai/file/pixellab-characters/objects/${manifest.owner}/${id}/rotations/unknown.png`;
// map objects (create_map_object) download from the MCP API instead
const mapUrl = (id) => `https://api.pixellab.ai/mcp/map-objects/${id}/download`;

if (process.argv.includes('--fetch')) {
  let n = 0;
  for (const [name, e] of Object.entries(manifest.art)) {
    const file = path.join(SRC, name.replace(':', '-') + '.png');
    if (!fs.existsSync(file) || e.refetch) { await get(e.mapObject ? mapUrl(e.mapObject) : url(e.object), file); n++; }
  }
  console.log(`fetched ${n} files`);
}

const frames = [];
for (const [name, e] of Object.entries(manifest.art)) {
  const file = path.join(SRC, name.replace(':', '-') + '.png');
  if (!fs.existsSync(file)) { console.warn(`${name}: not downloaded`); continue; }
  const img = prepare(file, { team: !e.neutral });
  // neutral art may not use the team key ramp: a remap swaps palette colors after snapping
  if (e.remap) {
    const to = new Map(Object.entries(e.remap).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]));
    for (let i = 0; i < img.data.length; i += 4) {
      if (!img.data[i + 3]) continue;
      const hex = '#' + [0, 1, 2].map((k) => img.data[i + k].toString(16).padStart(2, '0')).join('');
      const v = to.get(hex);
      if (v) img.data.set([1, 3, 5].map((k) => parseInt(v.slice(k, k + 2), 16)), i);
    }
  }
  const bb = bbox(img);
  if (!bb) continue;
  const c = crop(img, bb.x0, bb.y0, bb.x1 - bb.x0 + 1, bb.y1 - bb.y0 + 1);
  let ox, oy;
  if (e.foot) {
    // bottom-center of the art on the bottom-center of the footprint, `sink` px inside it
    ox = Math.round(c.w / 2 - (e.foot[0] * T) / 2);
    oy = c.h + (e.sink ?? 2);
  } else if (e.anchor === 'bottom') {
    // standing props: the base of the art on the anchor point
    ox = Math.round(c.w / 2);
    oy = c.h - (e.sink ?? 2);
  } else {
    ox = Math.round(c.w / 2);
    oy = Math.round(c.h / 2);
  }
  frames.push({ name, img: c, ox, oy });
}
const { pos, height } = pack(frames.map((f) => f.img), 1024);
const sheet = blank(1024, height);
const out = {};
frames.forEach((f, i) => {
  blit(sheet, f.img, pos[i].x, pos[i].y);
  out[f.name] = [pos[i].x, pos[i].y, f.img.w, f.img.h, f.ox, f.oy];
});
fs.writeFileSync(path.join(ROOT, 'src/art/buildings.png'), encodePNG(sheet.w, sheet.h, sheet.data));
fs.writeFileSync(path.join(ROOT, 'src/art/buildings.json'), JSON.stringify({ frames: out }));
console.log(`buildings: ${frames.length} sprites → src/art/buildings.png (${sheet.w}x${sheet.h})`);
