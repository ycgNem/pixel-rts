// Shared helpers for importing team-colored art (units, buildings): downloading, and snapping to the
// palette with saturated blue mapped onto the team key ramp (palette 44-48).
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from './png.mjs';
import { PAL, PAL_LAB, lab, de2000, rgbOf, dropStrays, nearest } from './pixel.mjs';

export const KEY = [44, 45, 46, 47, 48];
const NON_KEY = PAL.map((_, i) => i).filter((i) => !KEY.includes(i));

export async function get(url, file) {
  for (let t = 0; t < 4; t++) {
    const res = await fetch(url);
    if (res.status === 423 || res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 3000 * (t + 1))); continue; }
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return;
  }
  throw new Error(`${url}: not ready`);
}

// ---- color snapping with the team key
/** hue ranges (degrees) that count as team color: blue by default; art drawn otherwise can add red */
export const TEAM_HUES = { blue: [[195, 260]], red: [[195, 260], [340, 360], [0, 15]] };
const cache = new Map();
export function snap(r, g, b, hues = TEAM_HUES.blue) {
  const k = ((r << 16) | (g << 8) | b) + (hues === TEAM_HUES.blue ? 0 : 1 << 24);
  let out = cache.get(k);
  if (out !== undefined) return out;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx ? (mx - mn) / mx : 0;
  let hue = 0;
  if (mx !== mn) {
    if (mx === r) hue = (60 * ((g - b) / (mx - mn)) + 360) % 360;
    else if (mx === g) hue = 60 * ((b - r) / (mx - mn)) + 120;
    else hue = 60 * ((r - g) / (mx - mn)) + 240;
  }
  const L = lab([r, g, b]);
  if (hues.some(([lo, hi]) => hue >= lo && hue <= hi) && sat >= 0.3 && mx >= 50) {
    // team color: pick the key shade with the closest lightness
    let best = KEY[0], bd = Infinity;
    for (const i of KEY) { const d = Math.abs(PAL_LAB[i][0] - L[0]); if (d < bd) { bd = d; best = i; } }
    out = best;
  } else {
    let best = 0, bd = Infinity;
    const kl = L[0] < 22 ? 1 : 2;
    for (const i of NON_KEY) { const d = de2000(L, PAL_LAB[i], kl); if (d < bd) { bd = d; best = i; } }
    out = best;
  }
  cache.set(k, out);
  return out;
}

/** Load a PNG and snap it to the palette; `team: false` snaps blues normally (neutral art). */
export function prepare(file, { team = true, hues = TEAM_HUES.blue } = {}) {
  const img = decodePNG(fs.readFileSync(file));
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 128) { img.data.fill(0, i, i + 4); continue; }
    const c = team ? snap(img.data[i], img.data[i + 1], img.data[i + 2], hues) : nearest(img.data[i], img.data[i + 1], img.data[i + 2]).i;
    img.data.set([...rgbOf(PAL[c]), 255], i);
  }
  dropStrays(img);
  return img;
}
