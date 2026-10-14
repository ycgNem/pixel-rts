// Sprite registry. Sprites come from imported sheets (src/art/*.png + .json, built from PixelLab
// art by scripts/import-art.mjs) or, where no art exists yet, from procedural placeholders
// (./procedural.ts). Team colors: art is drawn with the blue palette ramp (44-48) as the key, and
// each player's copy is recolored once, the first time it is drawn.
import { PALETTE_RGB, TEAM_COLORS } from '../data/palette';
import { UNITS } from '../data/units';
import { makeCanvas } from './pixbuf';

/** Infantry are small: their team pixels use the light half of the ramp so they don't read black. */
const INFANTRY = new Set(Object.values(UNITS).filter((d) => d.cls === 'infantry').map((d) => d.id));
const isInfantry = (name: string) => name.startsWith('u:') && INFANTRY.has(name.split(':')[1]);

export interface Sprite {
  img: CanvasImageSource;
  x: number;
  y: number;
  w: number;
  h: number;
  /** anchor: this pixel of the frame sits on the world position */
  ox: number;
  oy: number;
}

const base = new Map<string, Sprite>();
const tinted = new Map<string, Sprite>();
const recolored = new Map<CanvasImageSource, (HTMLCanvasElement | null)[]>();

export function defineSprite(name: string, s: Sprite) {
  base.set(name, s);
}

export function hasSprite(name: string): boolean {
  return base.has(name);
}

/** Names of the sprites starting with `prefix`, sorted. */
export function spriteNames(prefix: string): string[] {
  return [...base.keys()].filter((k) => k.startsWith(prefix)).sort();
}

/** The sprite in a player's colors (color = index into TEAM_COLORS; 0 is the art as drawn). */
export function sprite(name: string, color = 0): Sprite | null {
  const b = base.get(name);
  if (!b) return null;
  if (color < 0) return b;
  const bright = isInfantry(name);
  if (identity(color, bright)) return b;
  const key = name + '|' + color;
  let t = tinted.get(key);
  if (!t) {
    t = { ...b, img: recolor(b.img, color, bright) };
    tinted.set(key, t);
  }
  return t;
}

/** Blue key ramp (palette 44-48) → team ramp; `bright` (infantry) shifts it a shade lighter. */
const KEY = [44, 45, 46, 47, 48];
function targets(color: number, bright: boolean): number[] {
  const r = TEAM_COLORS[color].ramp;
  return bright ? [r[1], r[1], r[2], r[3], r[3]] : [r[0], r[0], r[1], r[2], r[3]];
}
function identity(color: number, bright: boolean): boolean {
  return targets(color, bright).every((t, i) => t === KEY[i]);
}
function keyMap(color: number, bright: boolean): Map<number, [number, number, number]> {
  const to = targets(color, bright);
  const m = new Map<number, [number, number, number]>();
  KEY.forEach((k, i) => {
    const [a, b, c] = PALETTE_RGB[k];
    m.set((a << 16) | (b << 8) | c, PALETTE_RGB[to[i]]);
  });
  return m;
}

function recolor(img: CanvasImageSource, color: number, bright: boolean): HTMLCanvasElement {
  let arr = recolored.get(img);
  if (!arr) { arr = []; recolored.set(img, arr); }
  const slot = color * 2 + (bright ? 1 : 0);
  if (arr[slot]) return arr[slot]!;
  const w = (img as HTMLCanvasElement).width, h = (img as HTMLCanvasElement).height;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, w, h);
  const m = keyMap(color, bright);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const to = m.get((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    if (to) { px[i] = to[0]; px[i + 1] = to[1]; px[i + 2] = to[2]; }
  }
  ctx.putImageData(d, 0, 0);
  arr[slot] = c;
  return c;
}

/**
 * Burnt-out copies of sprites (wrecks): every pixel snapped to the darkest palette shades by
 * brightness, with holes punched through in 2×2 clumps (`HOLES` of them) so a hull never reads as
 * a live unit of a dark team.
 */
const CHAR = [0, 1, 2, 3];
const HOLES = 0.2;
const charredCache = new Map<string, Sprite | null>();
export function charred(name: string): Sprite | null {
  if (charredCache.has(name)) return charredCache.get(name)!;
  const sp = base.get(name);
  let out: Sprite | null = null;
  if (sp) {
    const c = makeCanvas(sp.w, sp.h);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
    const d = ctx.getImageData(0, 0, sp.w, sp.h);
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const x = (i / 4) % sp.w, y = Math.floor(i / 4 / sp.w);
      // a fixed hash of the clump, so the same wreck always breaks the same way
      const hsh = (((x >> 1) * 73856093) ^ ((y >> 1) * 19349663)) >>> 0;
      if ((hsh % 1000) / 1000 < HOLES) { px[i + 3] = 0; continue; }
      const lum = (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) / 255;
      const [r, g, b] = PALETTE_RGB[CHAR[Math.min(CHAR.length - 1, Math.floor(lum * 1.6 * CHAR.length))]];
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
    ctx.putImageData(d, 0, 0);
    out = { img: c, x: 0, y: 0, w: sp.w, h: sp.h, ox: sp.ox, oy: sp.oy };
  }
  charredCache.set(name, out);
  return out;
}

const bounds = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();

/** The opaque part of a sprite's frame, in frame pixels (x1, y1 exclusive). Measured once. */
export function opaqueBounds(name: string): { x0: number; y0: number; x1: number; y1: number } | null {
  const sp = base.get(name);
  if (!sp) return null;
  let b = bounds.get(name);
  if (b) return b;
  const c = makeCanvas(sp.w, sp.h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
  const d = ctx.getImageData(0, 0, sp.w, sp.h).data;
  b = { x0: sp.w, y0: sp.h, x1: 0, y1: 0 };
  for (let y = 0; y < sp.h; y++)
    for (let x = 0; x < sp.w; x++)
      if (d[(y * sp.w + x) * 4 + 3] > 0) {
        b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y);
        b.x1 = Math.max(b.x1, x + 1); b.y1 = Math.max(b.y1, y + 1);
      }
  if (b.x1 <= b.x0) b = { x0: 0, y0: 0, x1: sp.w, y1: sp.h };
  bounds.set(name, b);
  return b;
}

/** Draw a sprite with its anchor at (x, y) (screen px), scaled by an integer zoom. */
export function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, z: number, flip = false) {
  const dx = Math.round(x - s.ox * z), dy = Math.round(y - s.oy * z);
  if (flip) {
    ctx.save();
    ctx.translate(dx + s.w * z, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(s.img, s.x, s.y, s.w, s.h, 0, 0, s.w * z, s.h * z);
    ctx.restore();
    return;
  }
  ctx.drawImage(s.img, s.x, s.y, s.w, s.h, dx, dy, s.w * z, s.h * z);
}

// ---- imported sheets ----

interface SheetJson { frames: Record<string, [number, number, number, number, number, number]> }

const sheetJson = import.meta.glob<SheetJson>('../art/*.json', { eager: true, import: 'default' });
const sheetPng = import.meta.glob<string>('../art/*.png', { eager: true, query: '?url', import: 'default' });

/** Load every imported sheet; resolves when all images are decoded. */
export async function loadSheets(): Promise<number> {
  let n = 0;
  await Promise.all(
    Object.entries(sheetJson).map(async ([path, json]) => {
      const png = sheetPng[path.replace(/\.json$/, '.png')];
      if (!png || !json?.frames) return;
      const img = new Image();
      // (onload rather than decode(): decode() can stall in some embedded browsers)
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('could not load ' + png));
        img.src = png;
      });
      // copy to a canvas so recoloring can read pixels
      const c = makeCanvas(img.width, img.height);
      c.getContext('2d')!.drawImage(img, 0, 0);
      for (const [name, [x, y, w, h, ox, oy]] of Object.entries(json.frames)) {
        defineSprite(name, { img: c, x, y, w, h, ox, oy });
        n++;
      }
    }),
  );
  return n;
}

/** 8 facings: 0 = east, then clockwise (screen y grows down): 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE. */
export function facing8(angle: number): number {
  return ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
}
