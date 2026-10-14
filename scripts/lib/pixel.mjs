// Shared pixel helpers for the art scripts: the game palette, CIEDE2000 color snapping, upscale
// detection, alpha thresholding, bounding boxes and a shelf packer. scripts/art-import.mjs keeps its
// own copy (it adds the look-part key mapping); new importers use this module.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG } from './png.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ---- palette (src/data/palette.ts is the source of truth) ----
const palSrc = fs.readFileSync(path.join(ROOT, 'src/data/palette.ts'), 'utf8');
export const PAL = palSrc.slice(palSrc.indexOf('export const PALETTE = ['), palSrc.indexOf('] as const')).match(/#[0-9a-f]{6}/gi).map((h) => h.toLowerCase());
export const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

export function lab([r, g, b]) {
  const f = (c) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const [R, G, B] = [f(r), f(g), f(b)];
  const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const X = t((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), Y = t(R * 0.2126 + G * 0.7152 + B * 0.0722), Z = t((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
export const PAL_LAB = PAL.map((h) => lab(rgbOf(h)));

/** CIEDE2000; kL > 1 weighs lightness down so hues survive the snap (see art-import.mjs). */
export function de2000([L1, a1, b1], [L2, a2, b2], kL = 2) {
  const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G), C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1 = (Math.atan2(b1, a1p) / rad + 360) % 360, h2 = (Math.atan2(b2, a2p) / rad + 360) % 360;
  const dL = L2 - L1, dC = C2p - C1p;
  let dh = C1p * C2p === 0 ? 0 : h2 - h1;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad);
  const Lm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2;
  let hm = h1 + h2;
  if (C1p * C2p !== 0) hm = Math.abs(h1 - h2) > 180 ? (h1 + h2 + 360) / 2 : (h1 + h2) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), SC = 1 + 0.045 * Cpm, SH = 1 + 0.015 * Cpm * T;
  const RT = -2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / (kL * SL)) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

const nearCache = new Map();
/** Nearest palette index for a color; near-blacks keep full lightness weight (outlines, pupils). */
export function nearest(r, g, b, kL = 2) {
  const k = (r << 16) | (g << 8) | b;
  let n = nearCache.get(k);
  if (!n) {
    const L = lab([r, g, b]);
    let best = 0, bd = Infinity;
    const kl = L[0] < 22 ? 1 : kL;
    PAL_LAB.forEach((p, i) => { const d = de2000(L, p, kl); if (d < bd) { bd = d; best = i; } });
    n = { i: best, d: L[0] < 22 && best === 0 ? 0 : de2000(L, PAL_LAB[best], 1) };
    nearCache.set(k, n);
  }
  return n;
}

/** the largest k (≤ 8) for which the image is made of uniform k×k blocks */
export function detectScale(img) {
  for (let k = 8; k >= 2; k--) {
    if (img.w % k || img.h % k) continue;
    let ok = true;
    for (let by = 0; by < img.h && ok; by += k)
      for (let bx = 0; bx < img.w && ok; bx += k) {
        const q = (by * img.w + bx) * 4;
        for (let y = by; y < by + k && ok; y++)
          for (let x = bx; x < bx + k; x++) {
            const p = (y * img.w + x) * 4;
            if (img.data[p] !== img.data[q] || img.data[p + 1] !== img.data[q + 1] || img.data[p + 2] !== img.data[q + 2] || (img.data[p + 3] >= 128) !== (img.data[q + 3] >= 128)) { ok = false; break; }
          }
      }
    if (ok) return k;
  }
  return 1;
}

/** sample block centers; returns the image and how many blocks were not uniform */
export function downscale(img, k) {
  if (k === 1) return { img, offGrid: 0, blocks: img.w * img.h };
  const w = Math.floor(img.w / k), h = Math.floor(img.h / k), out = new Uint8Array(w * h * 4);
  let offGrid = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = ((y * k + (k >> 1)) * img.w + x * k + (k >> 1)) * 4;
      out.set(img.data.subarray(c, c + 4), (y * w + x) * 4);
      let uniform = true;
      for (let yy = 0; yy < k && uniform; yy++)
        for (let xx = 0; xx < k; xx++) {
          const p = ((y * k + yy) * img.w + x * k + xx) * 4;
          if (Math.abs(img.data[p] - img.data[c]) + Math.abs(img.data[p + 1] - img.data[c + 1]) + Math.abs(img.data[p + 2] - img.data[c + 2]) > 24 || (img.data[p + 3] >= 128) !== (img.data[c + 3] >= 128)) { uniform = false; break; }
        }
      if (!uniform) offGrid++;
    }
  return { img: { w, h, data: out }, offGrid, blocks: w * h };
}

/** threshold alpha and snap colors to the palette, in place; returns stats */
export function quantize(img, kL = 2) {
  let semi = 0, far = 0, opaque = 0, sumD = 0, maxD = 0;
  const colorsOut = new Set();
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3];
    if (a > 0 && a < 255) semi++;
    if (a < 128) { img.data.fill(0, i, i + 4); continue; }
    const n = nearest(img.data[i], img.data[i + 1], img.data[i + 2], kL);
    img.data.set([...rgbOf(PAL[n.i]), 255], i);
    colorsOut.add(PAL[n.i]);
    opaque++;
    sumD += n.d;
    maxD = Math.max(maxD, n.d);
    if (n.d > 15) far++;
  }
  return { semi, far, opaque, meanD: opaque ? sumD / opaque : 0, maxD, colorsOut };
}

export function bbox(img) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (img.data[(y * img.w + x) * 4 + 3]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** opaque pixels with no opaque 4-neighbor (noise a generator left behind) */
export function strays(img) {
  let n = 0;
  const on = (x, y) => x >= 0 && y >= 0 && x < img.w && y < img.h && img.data[(y * img.w + x) * 4 + 3] > 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (on(x, y) && !on(x - 1, y) && !on(x + 1, y) && !on(x, y - 1) && !on(x, y + 1)) n++;
  return n;
}

/** Remove isolated single opaque pixels in place (returns how many). */
export function dropStrays(img) {
  const on = (x, y) => x >= 0 && y >= 0 && x < img.w && y < img.h && img.data[(y * img.w + x) * 4 + 3] > 0;
  const kill = [];
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (on(x, y) && !on(x - 1, y) && !on(x + 1, y) && !on(x, y - 1) && !on(x, y + 1)) kill.push((y * img.w + x) * 4);
  for (const p of kill) img.data.fill(0, p, p + 4);
  return kill.length;
}

export function crop(img, x, y, w, h) {
  const out = { w, h, data: new Uint8Array(w * h * 4) };
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const sx = x + xx, sy = y + yy;
      if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
      const p = (sy * img.w + sx) * 4;
      out.data.set(img.data.subarray(p, p + 4), (yy * w + xx) * 4);
    }
  return out;
}

export function blank(w, h) {
  return { w, h, data: new Uint8Array(w * h * 4) };
}

/** copy opaque pixels of src into dst at (dx, dy); returns how many fell outside */
export function blit(dst, src, dx, dy, flipX = false) {
  let clipped = 0;
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const p = (y * src.w + x) * 4;
      if (!src.data[p + 3]) continue;
      const tx = dx + (flipX ? src.w - 1 - x : x), ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= dst.w || ty >= dst.h) { clipped++; continue; }
      dst.data.set(src.data.subarray(p, p + 4), (ty * dst.w + tx) * 4);
    }
  return clipped;
}

/** Load a PNG: undo integer upscaling (scale 'auto' or a number), then snap to the palette. */
export function loadArt(file, scale = 'auto', { snap = true, kL = 2 } = {}) {
  const raw = decodePNG(fs.readFileSync(file));
  const k = scale === 'auto' || scale === undefined ? detectScale(raw) : +scale;
  const ds = downscale(raw, k);
  const q = snap ? quantize(ds.img, kL) : null;
  return { file, raw, k, img: ds.img, offGrid: ds.offGrid, blocks: ds.blocks, q };
}

export function sameImage(a, b) {
  if (a.w !== b.w || a.h !== b.h) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/**
 * Shelf-pack rectangles (w, h) into a sheet `width` px wide with a 1 px gap. Returns positions in
 * input order and the sheet height. Tall items first gives tighter shelves.
 */
export function pack(sizes, width = 512) {
  const order = sizes.map((s, i) => i).sort((a, b) => sizes[b].h - sizes[a].h || sizes[b].w - sizes[a].w);
  const pos = new Array(sizes.length);
  let x = 0, y = 0, shelf = 0;
  for (const i of order) {
    const { w, h } = sizes[i];
    if (x + w > width) { y += shelf + 1; x = 0; shelf = 0; }
    pos[i] = { x, y };
    x += w + 1;
    shelf = Math.max(shelf, h);
  }
  return { pos, height: y + shelf };
}
