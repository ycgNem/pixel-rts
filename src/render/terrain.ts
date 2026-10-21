// Terrain: the painted ground (./painter.ts) baked into chunk canvases, plus the animated water on
// top (waves lapping the shore, glints on open water).
//
// Baking a chunk is the expensive part (tens of ms), so it is done a slice at a time
// (Painter.paintSteps) within a time budget per frame: the chunks on screen first, then the ones
// the camera is heading for. A chunk still being painted shows its quarter-size copy from an
// earlier bake, or the coarse one-pixel-per-tile map, for the few frames it takes. Only the very
// first frame bakes everything on screen at once.
import { TERRAIN } from '../data/terrain';
import { PALETTE, PALETTE_RGB, C } from '../data/palette';
import type { GameMap } from '../sim/types';
import { hash2 } from '../sim/rng';
import { Painter, type Painted } from './painter';
import { sprite as spriteOf } from './art';
import { makeCanvas, ctx2d } from './pixbuf';
import { TILE } from './view';

export const CHUNK = 16;
const S = CHUNK * TILE;
/** the strategic view's copy of a chunk (a quarter of the size) */
const SMALL = S / 4;
/** ms of baking per frame for chunks on screen, and for chunks ahead of a pan (never past BUDGET in all) */
const NEED_BUDGET = 8, AHEAD_BUDGET = 4, BUDGET = 10;
/** chunks around the view baked ahead, and how many frames of camera motion to look ahead */
const AHEAD = 1, LEAD = 40;
/** a half-painted chunk off screen this many frames is dropped (its buffers are big) */
const STALE_JOB = 240;
/** full-size chunks kept (each is 1 MB): at least this many, and always the view and the ring ahead of it */
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
  /** painting in progress */
  job: Generator<void, Painted> | null;
}

export class TerrainLayer {
  private chunks = new Map<number, Chunk>();
  private frame = 0;
  private painter: Painter;
  private overview: HTMLCanvasElement;
  private cw: number;
  private chh: number;
  /** nothing drawn yet: the first frame bakes what it shows */
  private fresh = true;
  /** the view's middle last frame, and its smoothed motion (chunks per frame) */
  private lastMid: [number, number] | null = null;
  private vel: [number, number] = [0, 0];
  /** full-size chunks to keep this frame */
  private keep = KEEP;

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
    // (a first frame of the strategic view can show the coarse map: it would be the whole map)
    const need = this.fresh && !strategic ? Infinity : t0 + NEED_BUDGET;
    this.fresh = false;
    this.keep = Math.max(KEEP, (cx1 - cx0 + 1 + 2 * AHEAD) * (cy1 - cy0 + 1 + 2 * AHEAD) + 4);
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const sx = toScreenX(cx * CHUNK), sy = toScreenY(cy * CHUNK);
        const ex = toScreenX((cx + 1) * CHUNK), ey = toScreenY((cy + 1) * CHUNK);
        const ch = this.chunk(cx, cy);
        ch.used = this.frame;
        const tiny = z <= 0.25 && ch.small;
        if (!ch.c && !tiny && performance.now() < need) this.advance(ch, cx, cy, need);
        const img = tiny ? ch.small : ch.c ?? ch.small;
        // still being painted: its strategic copy (smoothed), or the coarse map
        ctx.imageSmoothingEnabled = strategic || !ch.c;
        if (img) ctx.drawImage(img, sx, sy, ex - sx, ey - sy);
        else ctx.drawImage(this.overview, cx * CHUNK, cy * CHUNK, CHUNK, CHUNK, sx, sy, ex - sx, ey - sy);
        if (!strategic && ch.c && ch.shore.length + ch.glints.length) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(this.animate(ch, cx, cy, now), sx, sy, ex - sx, ey - sy);
        }
      }
    ctx.imageSmoothingEnabled = false;
    // the time left: bake ahead, nearest first to where the camera is heading
    const mid: [number, number] = [(x0 + x1) / 2 / CHUNK, (y0 + y1) / 2 / CHUNK];
    if (this.lastMid) for (const i of [0, 1]) this.vel[i] = this.vel[i] * 0.8 + (mid[i] - this.lastMid[i]) * 0.2;
    this.lastMid = mid;
    const until = Math.min(t0 + BUDGET, performance.now() + AHEAD_BUDGET);
    if (!strategic || z > 0.25) {
      const hx = mid[0] + this.vel[0] * LEAD, hy = mid[1] + this.vel[1] * LEAD;
      while (performance.now() < until) {
        let best: [number, number] | null = null, bd = Infinity;
        for (let cy = Math.max(0, cy0 - AHEAD); cy <= Math.min(this.chh - 1, cy1 + AHEAD); cy++)
          for (let cx = Math.max(0, cx0 - AHEAD); cx <= Math.min(this.cw - 1, cx1 + AHEAD); cx++) {
            if (this.chunks.get(cy * 4096 + cx)?.c) continue;
            const d = Math.hypot(cx + 0.5 - hx, cy + 0.5 - hy);
            if (d < bd) { bd = d; best = [cx, cy]; }
          }
        if (!best) break;
        this.advance(this.chunk(best[0], best[1]), best[0], best[1], until);
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
    this.fresh = true;
  }

  private chunk(cx: number, cy: number): Chunk {
    const key = cy * 4096 + cx;
    let ch = this.chunks.get(key);
    if (!ch) {
      ch = { c: null, small: null, used: this.frame, shore: new Uint32Array(0), shoreK: new Uint8Array(0), glints: new Uint32Array(0), anim: null, animAt: -1e9, job: null };
      this.chunks.set(key, ch);
    }
    return ch;
  }

  /** Paint more of a chunk until it is done (true) or `until` (ms) passes; at least one slice. */
  private advance(ch: Chunk, cx: number, cy: number, until: number): boolean {
    if (ch.c) return true;
    ch.job ??= this.painter.paintSteps(cx * S, cy * S, S);
    for (;;) {
      const r = ch.job.next();
      if (r.done) {
        ch.job = null;
        this.finish(ch, cx, cy, r.value);
        return true;
      }
      if (performance.now() >= until) return false;
    }
  }

  /** A painted chunk: the full canvas and its strategic copy, and the water pixels for the waves. */
  private finish(ch: Chunk, cx: number, cy: number, p: Painted) {
    const c = makeCanvas(S, S);
    const ctx = ctx2d(c);
    ctx.putImageData(p.img, 0, 0);
    for (const [s, x, y] of p.sprites) ctx.drawImage(s.img, s.x, s.y, s.w, s.h, Math.round(x - s.ox), Math.round(y - s.oy), s.w, s.h);
    this.deposits(ctx, cx * CHUNK, cy * CHUNK);
    ch.c = c;
    ch.anim = null;
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
  }

  /** Free the full-size canvases of chunks not drawn lately (their strategic copies stay). */
  private forget() {
    let full = 0;
    for (const ch of this.chunks.values()) {
      if (ch.c) full++;
      else if (ch.job && this.frame - ch.used > STALE_JOB) ch.job = null;
    }
    if (full <= this.keep) return;
    const old = [...this.chunks.values()].filter((ch) => ch.c).sort((a, b) => a.used - b.used);
    for (const ch of old.slice(0, full - this.keep)) {
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
