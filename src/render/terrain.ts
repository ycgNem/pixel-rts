// Terrain: the painted ground (./painter.ts) baked into chunk canvases, plus the animated water on
// top (waves lapping the shore, glints on open water).
//
// Baking a chunk is the expensive part, so: chunks the camera needs at a pixel-perfect zoom are
// baked at once; the strategic view bakes a few per frame and shows a coarse map in the gaps; and
// when nothing else is waiting, the chunks just outside the view are baked ahead of a pan.
import { TERRAIN } from '../data/terrain';
import { PALETTE, PALETTE_RGB, C } from '../data/palette';
import type { GameMap } from '../sim/types';
import { hash2 } from '../sim/rng';
import { Painter } from './painter';
import { sprite as spriteOf } from './art';
import { makeCanvas, ctx2d } from './pixbuf';
import { TILE } from './view';

export const CHUNK = 16;
const S = CHUNK * TILE;
/** the strategic view's copy of a chunk (a quarter of the size) */
const SMALL = S / 4;
/** ms of baking allowed per frame when a chunk isn't strictly needed yet */
const BUDGET = 9;
/** full-size chunks kept (each is 1 MB) */
const KEEP = 56;
/** wave layer refresh (ms), and a wave's trip from open water to the sand (s) */
const ANIM_MS = 90, WAVE_S = 3.4;

interface Chunk {
  c: HTMLCanvasElement | null;
  small: HTMLCanvasElement | null;
  used: number;
  shore: Uint32Array;
  shoreK: Uint8Array;
  glints: Uint32Array;
  anim: HTMLCanvasElement | null;
  animAt: number;
}

export class TerrainLayer {
  private chunks = new Map<number, Chunk>();
  private frame = 0;
  private painter: Painter;
  private overview: HTMLCanvasElement;
  private cw: number;
  private chh: number;

  constructor(private map: GameMap, seed = 0) {
    this.painter = new Painter(map, seed);
    this.cw = Math.ceil(map.w / CHUNK);
    this.chh = Math.ceil(map.h / CHUNK);
    // one pixel per tile: shown (smoothed) where the strategic view hasn't baked a chunk yet
    this.overview = makeCanvas(map.w, map.h);
    const o = this.overview.getContext('2d')!;
    const img = o.createImageData(map.w, map.h);
    for (let i = 0; i < map.w * map.h; i++) {
      const rgb = PALETTE_RGB[TERRAIN[map.terrain[i]].mini];
      img.data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
    }
    o.putImageData(img, 0, 0);
  }

  /** Draw the visible chunks (and the water's motion when zoomed in). `now` is in ms. */
  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, toScreenX: (tx: number) => number, toScreenY: (ty: number) => number, z: number, now = 0) {
    this.frame++;
    const t0 = performance.now();
    const cx0 = Math.max(0, Math.floor(x0 / CHUNK)), cy0 = Math.max(0, Math.floor(y0 / CHUNK));
    const cx1 = Math.min(this.cw - 1, Math.floor(x1 / CHUNK)), cy1 = Math.min(this.chh - 1, Math.floor(y1 / CHUNK));
    const strategic = z < 1;
    ctx.imageSmoothingEnabled = strategic;
    let pending = false;
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const sx = toScreenX(cx * CHUNK), sy = toScreenY(cy * CHUNK);
        const ex = toScreenX((cx + 1) * CHUNK), ey = toScreenY((cy + 1) * CHUNK);
        let ch = this.chunks.get(cy * 4096 + cx);
        const ready = ch && (z <= 0.25 ? ch.small || ch.c : ch.c);
        if (!ready) {
          // pixel-perfect zooms can't wait; the strategic view bakes within its budget
          if (strategic && performance.now() - t0 > BUDGET) {
            pending = true;
            ctx.drawImage(this.overview, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK, sx, sy, ex - sx, ey - sy);
            continue;
          }
          ch = this.bake(cx, cy);
        }
        ch!.used = this.frame;
        const img = z <= 0.25 && ch!.small ? ch!.small : (ch!.c ?? this.full(ch!, cx, cy));
        ctx.drawImage(img, sx, sy, ex - sx, ey - sy);
        if (!strategic && ch!.shore.length + ch!.glints.length) ctx.drawImage(this.animate(ch!, cx, cy, now), sx, sy, ex - sx, ey - sy);
      }
    ctx.imageSmoothingEnabled = false;
    // nothing waiting: bake ahead of a pan, one chunk just outside the view
    if (!pending && !strategic && performance.now() - t0 < BUDGET / 2) {
      search: for (let cy = cy0 - 1; cy <= cy1 + 1; cy++)
        for (let cx = cx0 - 1; cx <= cx1 + 1; cx++) {
          if (cx < 0 || cy < 0 || cx >= this.cw || cy >= this.chh) continue;
          const ch = this.chunks.get(cy * 4096 + cx);
          if (ch?.c) continue;
          this.bake(cx, cy).used = this.frame;
          break search;
        }
    }
    this.forget();
  }

  /** Does a baked tree or peak cover part of this world-pixel box? (The props keep clear of them.) */
  blocks(x0: number, y0: number, x1: number, y1: number): boolean {
    return this.painter.blocks(x0, y0, x1, y1);
  }

  invalidate() {
    this.chunks.clear();
  }

  /** Paint a chunk: the full canvas and its strategic copy, and the water pixels for the waves. */
  private bake(cx: number, cy: number): Chunk {
    const key = cy * 4096 + cx;
    let ch = this.chunks.get(key);
    if (!ch) {
      ch = { c: null, small: null, used: this.frame, shore: new Uint32Array(0), shoreK: new Uint8Array(0), glints: new Uint32Array(0), anim: null, animAt: -1e9 };
      this.chunks.set(key, ch);
    }
    this.full(ch, cx, cy);
    return ch;
  }

  private full(ch: Chunk, cx: number, cy: number): HTMLCanvasElement {
    if (ch.c) return ch.c;
    const p = this.painter.paint(cx * S, cy * S, S);
    const c = makeCanvas(S, S);
    const ctx = ctx2d(c);
    ctx.putImageData(p.img, 0, 0);
    for (const [s, x, y] of p.sprites) ctx.drawImage(s.img, s.x, s.y, s.w, s.h, Math.round(x - s.ox), Math.round(y - s.oy), s.w, s.h);
    this.deposits(ctx, cx * CHUNK, cy * CHUNK);
    ch.c = c;
    ch.shore = p.shore;
    ch.shoreK = p.shoreK;
    ch.glints = p.glints;
    if (!ch.small) {
      ch.small = makeCanvas(SMALL, SMALL);
      const sctx = ch.small.getContext('2d')!;
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'medium';
      sctx.drawImage(c, 0, 0, SMALL, SMALL);
    }
    return c;
  }

  /** Free the full-size canvases of chunks not drawn lately (their strategic copies stay). */
  private forget() {
    let full = 0;
    for (const ch of this.chunks.values()) if (ch.c) full++;
    if (full <= KEEP) return;
    const old = [...this.chunks.values()].filter((ch) => ch.c).sort((a, b) => a.used - b.used);
    for (const ch of old.slice(0, full - KEEP)) {
      ch.c = null;
      ch.anim = null;
    }
  }

  /** Waves running up to the shore and glints winking on open water, redrawn a few times a second. */
  private animate(ch: Chunk, cx: number, cy: number, now: number): HTMLCanvasElement {
    if (!ch.anim) ch.anim = makeCanvas(S, S);
    if (now - ch.animAt < ANIM_MS) return ch.anim;
    ch.animAt = now;
    const ctx = ch.anim.getContext('2d')!;
    ctx.clearRect(0, 0, S, S);
    const t = now / 1000, ox = cx * S, oy = cy * S;
    const foam = new Path2D(), wash = new Path2D();
    const { shore, shoreK } = ch;
    const flick = Math.floor(t * 5);
    for (let i = 0; i < shore.length; i++) {
      const p = shore[i], x = p % S, y = (p - x) / S, k = shoreK[i] / 255;
      // each stretch of coast gets its own timing, so the waves don't arrive in step
      const front = (t / WAVE_S + ((ox + x) * 0.7 + (oy + y)) / 260) % 1;
      const gap = front - k;
      if (gap > -0.06 && gap < 0.02) (k > 0.72 ? foam : wash).rect(x, y, 1, 1);
      else if (k > 0.9 && hash2(p, flick, 17) < 0.25) foam.rect(x, y, 1, 1);
    }
    for (let i = 0; i < ch.glints.length; i++) {
      const p = ch.glints[i], x = p % S, y = (p - x) / S;
      const ph = (t * 0.45 + hash2(p, 0, 23)) % 1;
      // a short glint that swells and fades along a wave crest
      if (ph < 0.05) { foam.rect(x, y, 2, 1); wash.rect(x - 2, y, 2, 1); wash.rect(x + 2, y, 2, 1); }
      else if (ph < 0.1) wash.rect(x - 1, y, 3, 1);
    }
    ctx.fillStyle = PALETTE[C.ice];
    ctx.fill(wash);
    ctx.fillStyle = PALETTE[C.white];
    ctx.fill(foam);
    return ch.anim;
  }

  /** Deposits are part of the ground. */
  private deposits(ctx: CanvasRenderingContext2D, tx0: number, ty0: number) {
    for (const d of this.map.deposits) {
      if (d.x + 2 < tx0 || d.y + 2 < ty0 || d.x >= tx0 + CHUNK || d.y >= ty0 + CHUNK) continue;
      const s = spriteOf(d.kind === 'oil' ? 'dep:oil' : d.rich ? 'dep:rich' : 'dep:ore');
      if (s) ctx.drawImage(s.img, s.x, s.y, s.w, s.h, (d.x - tx0) * TILE + (2 * TILE - s.w) / 2, (d.y - ty0) * TILE + (2 * TILE - s.h) / 2, s.w, s.h);
    }
  }
}
