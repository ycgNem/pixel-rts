// Unit art import: PixelLab 8-direction objects and characters → src/art/units.png + units.json.
//
// Every frame is snapped to the palette. Team colors: the art is drawn with blue team parts, so
// saturated blue pixels become the key ramp (palette 44-48, picked by lightness) that the game
// recolors per player; every other pixel snaps to the rest of the palette (never to the key).
// Frames are cropped to their content and named `u:<kind>:<dir>` (dir 0 = east, clockwise), walk
// frames `u:<kind>:<dir>:w<n>`.
//
// Usage: node scripts/import-units.mjs [--fetch]   (--fetch downloads anything missing first)
import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from './lib/png.mjs';
import { ROOT, PAL, bbox, crop, blank, blit, pack } from './lib/pixel.mjs';
import { KEY, TEAM_HUES, get, prepare } from './lib/teamart.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/units.json'), 'utf8'));
const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
const SRC = path.join(ROOT, 'assets/pixellab/units');
if (process.argv.includes('--fetch')) {
  const jobs = [];
  for (const [kind, u] of Object.entries(manifest.units)) {
    const base = u.object
      ? `https://backblaze.pixellab.ai/file/pixellab-characters/objects/${manifest.owner}/${u.object}/rotations/`
      : `https://backblaze.pixellab.ai/file/pixellab-characters/${manifest.owner}/${u.character}/rotations/`;
    for (const d of DIRS) {
      const file = path.join(SRC, kind, d + '.png');
      if (!fs.existsSync(file)) jobs.push(get(base + d + '.png', file));
    }
    for (const [anim, a] of Object.entries(u.anims ?? {})) {
      for (const d of DIRS) for (let f = 0; f < a.frames; f++) {
        const url = a.urls?.[d]?.[f];
        const file = path.join(SRC, kind, anim, d, f + '.png');
        if (url && !fs.existsSync(file)) jobs.push(get(url, file));
      }
    }
  }
  await Promise.all(jobs);
  console.log(`fetched ${jobs.length} files`);
}

const frames = [];
let keyPixels = 0;
for (const [kind, u] of Object.entries(manifest.units)) {
  const dir = path.join(SRC, kind);
  if (!fs.existsSync(dir)) { console.warn(`${kind}: no art yet`); continue; }
  // one feet row for every frame of a character (so walk cycles don't bob on the anchor)
  let feetRow = 0;
  if (u.feet) for (const d of DIRS) {
    const f = path.join(dir, d + '.png');
    if (fs.existsSync(f)) feetRow = Math.max(feetRow, bbox(prepare(f))?.y1 ?? 0);
  }
  const add = (name, file) => {
    if (!fs.existsSync(file)) return false;
    const img = prepare(file, { hues: TEAM_HUES[u.teamHue ?? 'blue'] });
    const bb = bbox(img);
    if (!bb) return false;
    const c = crop(img, bb.x0, bb.y0, bb.x1 - bb.x0 + 1, bb.y1 - bb.y0 + 1);
    for (let i = 0; i < c.data.length; i += 4) if (c.data[i + 3] && KEY.some((k) => PAL[k] === '#' + [0, 1, 2].map((j) => c.data[i + j].toString(16).padStart(2, '0')).join(''))) keyPixels++;
    const ox = Math.round(img.w / 2) - bb.x0;
    const oy = u.feet ? feetRow - 2 - bb.y0 : Math.round(img.h / 2) - bb.y0;
    frames.push({ name, img: c, ox, oy });
    return true;
  };
  DIRS.forEach((d, i) => add(`u:${kind}:${i}`, path.join(dir, d + '.png')));
  for (const [anim, a] of Object.entries(u.anims ?? {})) {
    DIRS.forEach((d, i) => {
      for (let f = 0; f < a.frames; f++) add(`u:${kind}:${i}:${anim[0]}${f}`, path.join(dir, anim, d, f + '.png'));
    });
  }
}

const { pos, height } = pack(frames.map((f) => f.img), 1024);
const sheet = blank(1024, height);
const out = {};
frames.forEach((f, i) => {
  blit(sheet, f.img, pos[i].x, pos[i].y);
  out[f.name] = [pos[i].x, pos[i].y, f.img.w, f.img.h, f.ox, f.oy];
});
fs.mkdirSync(path.join(ROOT, 'src/art'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src/art/units.png'), encodePNG(sheet.w, sheet.h, sheet.data));
fs.writeFileSync(path.join(ROOT, 'src/art/units.json'), JSON.stringify({ frames: out }));
console.log(`units: ${frames.length} frames → src/art/units.png (${sheet.w}x${sheet.h}), ${keyPixels} team-color pixels`);
