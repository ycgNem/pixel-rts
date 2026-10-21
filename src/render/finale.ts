// The science victory's finale (render only; the sim has already ended the match): the rocket
// lifts off from the Launch Site, a white flash, and then the whole island it stood on goes up, a
// shockwave and a firestorm sweeping out across the land from the pad until it lies scorched under
// smoke. Then the end screen, over the scorched island. Any key or click skips to it.
import type { MatchState } from '../sim/types';
import { T } from '../data/terrain';
import { PALETTE, PALETTE_RGB, C, rgba } from '../data/palette';
import { hash2 } from '../sim/rng';
import { audio } from '../engine/audio';
import { makeCanvas, ctx2d } from './pixbuf';
import { TILE, ZOOMS, type Camera } from './view';

/** seconds: the climb before the blast, the firestorm's sweep, the smoke afterwards */
const LIFT = 2.8, SWEEP = 5.5, AFTER = 2.5;
/** scorch overlay pixels per tile (each is 8 art pixels) */
const SUB = 4;
/** flame colors, hottest first */
const FLAME = [C.white, C.cream, C.gold, C.amber, C.orange, C.ember, C.red, C.crimson, C.blood];
/** scorched ground, darkest first */
const CHAR = [C.ink, C.ink, C.plum, C.plum, C.slate, C.wine];

interface Ball { x: number; y: number; r: number; t0: number; life: number }

export class LaunchFinale {
  /** seconds since it began */
  t = 0;
  done = false;
  /** how far the fire must travel to each tile (-1: not this island), and the tiles in that order */
  private dist: Float32Array;
  private order: number[] = [];
  private far = 1;
  private burnt = 0;
  private scorch: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private balls: Ball[] = [];
  private nextBall = 0;
  private boomed = false;
  /** the island's middle and size (tiles) */
  private mid: [number, number];
  private span: number;

  constructor(private s: MatchState, private px: number, private py: number) {
    const { w, h, terrain } = s.map;
    this.dist = new Float32Array(w * h).fill(-1);
    const land = (i: number) => terrain[i] !== T.DEEP && terrain[i] !== T.WATER;
    const start = Math.floor(py) * w + Math.floor(px);
    let mx = 0, my = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    if (land(start)) {
      // the island: every land tile joined to the pad (bridges count)
      const seen = new Uint8Array(w * h);
      seen[start] = 1;
      const q = [start];
      for (let k = 0; k < q.length; k++) {
        const i = q[k], x = i % w, y = (i - x) / w;
        // the blast runs out in a ragged ring from the pad
        this.dist[i] = Math.hypot(x + 0.5 - px, y + 0.5 - py) + hash2(x >> 2, y >> 2, 771) * 4 + hash2(x, y, 772) * 1.5;
        this.order.push(i);
        mx += x; my += y;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, j = ny * w + nx;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[j] || !land(j)) continue;
          seen[j] = 1;
          q.push(j);
        }
      }
      this.order.sort((a, b) => this.dist[a] - this.dist[b]);
      this.far = Math.max(1, this.dist[this.order[this.order.length - 1]]);
    }
    const n = Math.max(1, this.order.length);
    this.mid = this.order.length ? [mx / n + 0.5, my / n + 0.5] : [px, py];
    this.span = this.order.length ? Math.max(x1 - x0, y1 - y0) + 1 : 8;
    this.scorch = makeCanvas(w * SUB, h * SUB);
    this.sctx = ctx2d(this.scorch);
    audio.sfx('siren');
  }

  /** Any key or click: straight to the end screen. */
  skip() {
    this.done = true;
  }

  /** Advance the show and steer the camera. */
  update(dt: number, cam: Camera) {
    if (this.done) return;
    this.t += dt;
    const t = this.t;
    if (t < LIFT) {
      // follow the climb, close in
      cam.zt = Math.max(cam.zt, 1);
      cam.centerOn(this.px, this.py - Math.min(4, t * 1.5));
    } else {
      if (!this.boomed) {
        this.boomed = true;
        audio.sfx('bigboom', 1);
        audio.sfx('thunder', 1);
        // pull back far enough to see the whole island burn
        const fit = Math.min(cam.w, cam.h) / (this.span * TILE * 1.05);
        cam.zt = [...ZOOMS].reverse().find((z) => z <= fit) ?? ZOOMS[0];
      }
      const k = Math.min(1, (t - LIFT) / 1.2);
      cam.centerOn(this.px + (this.mid[0] - this.px) * k, this.py + (this.mid[1] - this.py) * k);
      // the fire front reaches more tiles: char them on the overlay
      const front = this.front();
      while (this.burnt < this.order.length && this.dist[this.order[this.burnt]] <= front) this.char(this.order[this.burnt++]);
      // fireballs along the front, and rumbling
      while (this.nextBall < t && this.burnt > 0 && t < LIFT + SWEEP) {
        this.nextBall += 0.03;
        const lo = Math.max(0, this.burnt - 1 - Math.floor(this.order.length * 0.04));
        const i = this.order[lo + Math.floor(Math.random() * (this.burnt - lo))];
        const x = i % this.s.map.w, y = (i - x) / this.s.map.w;
        this.balls.push({ x: x + Math.random(), y: y + Math.random(), r: 0.8 + Math.random() * 1.8, t0: t, life: 0.5 + Math.random() * 0.6 });
        if (Math.random() < 0.06) audio.sfx('boom', 0.5);
      }
      this.balls = this.balls.filter((b) => t - b.t0 < b.life);
    }
    if (t > LIFT + SWEEP + AFTER) this.done = true;
  }

  /** shake for the screen (px) */
  shake(): number {
    const a = this.t - LIFT;
    if (a < 0) return this.t > LIFT * 0.4 ? 2 : 0;
    return Math.max(0, 16 * (1 - a / (SWEEP + 1)));
  }

  /** how far out the fire has reached */
  private front(): number {
    const a = Math.min(1, (this.t - LIFT) / SWEEP);
    // fast at first, slowing as it nears the far coasts
    return (1 - (1 - a) ** 2) * (this.far + 1);
  }

  /**
   * Burn a tile into the scorch overlay: patches of char (the shade picked per 2×2-tile block, so
   * the ground reads as burnt land, not static), ash specks, and a few embers still glowing.
   */
  private char(i: number) {
    const w = this.s.map.w, x = i % w, y = (i - x) / w;
    const img = this.sctx.createImageData(SUB, SUB);
    const patch = hash2(x >> 1, y >> 1, 776) * 0.6 + hash2(x, y, 775) * 0.4;
    const base = CHAR[Math.min(CHAR.length - 1, Math.floor(patch * CHAR.length))];
    for (let v = 0; v < SUB; v++)
      for (let u = 0; u < SUB; u++) {
        const h = hash2(x * SUB + u, y * SUB + v, 777);
        const c = h < 0.025 ? C.ember : h < 0.04 ? C.rust : h < 0.12 ? C.slate : h < 0.2 ? C.plum : base;
        const rgb = PALETTE_RGB[c], k = (v * SUB + u) * 4;
        img.data[k] = rgb[0]; img.data[k + 1] = rgb[1]; img.data[k + 2] = rgb[2];
        img.data[k + 3] = 240;
      }
    this.sctx.putImageData(img, x * SUB, y * SUB);
  }

  /** In world space, over everything on the map (once it is over, just the scorched island). */
  draw(ctx: CanvasRenderingContext2D, cam: Camera) {
    const t = this.t, z = cam.z, px = TILE * z;
    const cell = Math.max(1, Math.round(8 * z));
    if (t < LIFT && !this.done) {
      this.rocket(ctx, cam, t);
      return;
    }
    // skipped before the fire got everywhere: burn the rest now
    if (this.done) while (this.burnt < this.order.length) this.char(this.order[this.burnt++]);
    const a = t - LIFT;
    // the scorched land
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.scorch, 0, 0, this.scorch.width, this.scorch.height, cam.sx(0), cam.sy(0), this.s.map.w * px, this.s.map.h * px);
    if (this.done) return;
    // smoke rising off the burnt land
    if (a > SWEEP * 0.5 && this.order.length) {
      const k = Math.min(1, (a - SWEEP * 0.5) / 2);
      for (let n = 0; n < 60; n++) {
        const i = this.order[Math.floor(hash2(n, 0, 881) * this.order.length)];
        if (this.dist[i] > this.front()) continue;
        const x = i % this.s.map.w, y = (i - x) / this.s.map.w, life = (t * 0.25 + hash2(n, 1, 882)) % 1;
        ctx.fillStyle = rgba(n % 3 ? C.slate : C.stone, 0.5 * k * (1 - life));
        this.disc(ctx, cam.sx(x + 0.5), cam.sy(y + 0.5 - life * 3), (1 + life * 2) * TILE * z, cell);
      }
    }
    // the firestorm: flames dance on a band behind the front, embers glow behind that
    const front = this.front(), band = Math.max(3, this.far * 0.08);
    const [bx0, by0, bx1, by1] = cam.bounds(1);
    const w = this.s.map.w, frame = Math.floor(t * 12);
    for (let k = this.burnt - 1; k >= 0; k--) {
      const i = this.order[k], d = front - this.dist[i];
      if (d > band * 4) break;
      const x = i % w, y = (i - x) / w;
      if (x < bx0 || x > bx1 || y < by0 || y > by1) continue;
      const heat = d / band;
      // fewer flames as the ground burns out
      const n = heat < 1 ? 3 : heat < 4 ? 1 : 0;
      for (let f = 0; f < n; f++) {
        const h = hash2(i, frame + f * 31, 991);
        if (heat >= 1 && h > 0.35) continue;
        const ci = Math.min(FLAME.length - 1, Math.floor(heat * 2 + hash2(i, frame, 992) * 3));
        ctx.fillStyle = PALETTE[FLAME[ci]];
        const ox = Math.floor(hash2(i, frame + f, 993) * 4), oy = Math.floor(hash2(i, frame + f, 994) * 4);
        ctx.fillRect(cam.sx(x) + ox * cell, cam.sy(y) + oy * cell - (heat < 1 ? cell : 0), cell, cell * (heat < 1 ? 2 : 1));
      }
    }
    // fireballs: dithered discs, white-hot cores
    for (const b of this.balls) {
      const k = (t - b.t0) / b.life, r = b.r * (0.4 + k) * TILE * z;
      const cx = cam.sx(b.x), cy = cam.sy(b.y);
      for (const [rr, c] of [[1, FLAME[Math.min(8, 4 + Math.floor(k * 5))]], [0.66, FLAME[Math.min(8, 2 + Math.floor(k * 5))]], [0.33, FLAME[Math.min(8, Math.floor(k * 6))]]] as [number, number][]) {
        ctx.fillStyle = rgba(c, 1 - k * 0.7);
        this.disc(ctx, cx, cy, r * rr, cell);
      }
    }
    // the shockwave: a bright ring racing out from the pad
    if (a < 2.2) {
      const r = (a / 2.2) * this.span * 0.9 * TILE * z;
      ctx.strokeStyle = rgba(C.white, 1 - a / 2.2);
      ctx.lineWidth = Math.max(2, cell * 2);
      ctx.beginPath();
      ctx.arc(cam.sx(this.px), cam.sy(this.py), r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // the mushroom cloud over the pad
    const g = Math.min(1, a / 3), sx = cam.sx(this.px), sy = cam.sy(this.py);
    const stem = g * 10 * TILE * z, cap = (2 + g * 6) * TILE * z;
    ctx.fillStyle = rgba(C.slate, 0.85);
    ctx.fillRect(Math.round(sx - cap * 0.25), Math.round(sy - stem), Math.round(cap * 0.5), Math.round(stem));
    for (const [rr, c, al] of [[1, C.slate, 0.9], [0.8, C.stone, 0.9], [0.5, C.orange, 0.8 * (1 - g)], [0.3, C.gold, 1 - g]] as [number, number, number][]) {
      ctx.fillStyle = rgba(c, al);
      this.disc(ctx, sx, sy - stem, cap * rr, cell);
    }
  }

  /** On top of the whole screen: the blast's flash, and how to skip. */
  overlay(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (this.done) return;
    const a = this.t - LIFT;
    if (a > -0.15 && a < 1) {
      ctx.fillStyle = rgba(C.white, a < 0 ? 1 + a / 0.15 : Math.max(0, 1 - a));
      ctx.fillRect(0, 0, w, h);
    }
  }

  /** The rocket climbing out of a cloud of exhaust. */
  private rocket(ctx: CanvasRenderingContext2D, cam: Camera, t: number) {
    const z = cam.z, u = Math.max(1, Math.round(2 * z));
    const rise = (t / LIFT) ** 2 * 7 * TILE * z;
    const x = cam.sx(this.px), base = cam.sy(this.py) - Math.round(rise);
    // exhaust billowing around the pad
    for (let k = 0; k < 14; k++) {
      const a = k * 2.4 + t * 0.6, r = (1 + (k % 4) * 0.5) * TILE * z * Math.min(1, t);
      ctx.fillStyle = rgba(k % 3 ? C.stone : C.frost, 0.75);
      this.disc(ctx, x + Math.cos(a) * r * 1.4, cam.sy(this.py) + Math.sin(a) * r * 0.5, (0.6 + (k % 3) * 0.3) * TILE * z, u * 2);
    }
    // the flame (flickering) and the trail
    const flick = Math.floor(t * 20) % 2;
    ctx.fillStyle = PALETTE[C.gold];
    ctx.fillRect(x - 3 * u, base, 6 * u, (10 + flick * 4) * u);
    ctx.fillStyle = PALETTE[C.white];
    ctx.fillRect(x - u, base, 2 * u, (6 + flick * 2) * u);
    ctx.fillStyle = rgba(C.orange, 0.8);
    ctx.fillRect(x - 2 * u, base + (10 + flick * 4) * u, 4 * u, Math.round(rise));
    // the body: white with a red nose and fins, a dark outline
    ctx.fillStyle = PALETTE[C.ink];
    ctx.fillRect(x - 5 * u, base - 30 * u, 10 * u, 31 * u);
    ctx.fillRect(x - 8 * u, base - 8 * u, 16 * u, 8 * u);
    ctx.fillStyle = PALETTE[C.white];
    ctx.fillRect(x - 4 * u, base - 26 * u, 8 * u, 26 * u);
    ctx.fillStyle = PALETTE[C.frost];
    ctx.fillRect(x + 1 * u, base - 26 * u, 3 * u, 26 * u);
    ctx.fillStyle = PALETTE[C.red];
    ctx.fillRect(x - 3 * u, base - 30 * u, 6 * u, 4 * u);
    ctx.fillRect(x - 7 * u, base - 7 * u, 3 * u, 6 * u);
    ctx.fillRect(x + 4 * u, base - 7 * u, 3 * u, 6 * u);
    ctx.fillStyle = PALETTE[C.sky];
    ctx.fillRect(x - u, base - 20 * u, 2 * u, 2 * u);
  }

  /** A filled disc made of square cells (pixel art at any zoom). */
  private disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, cell: number) {
    const n = Math.ceil(r / cell);
    for (let j = -n; j <= n; j++) {
      const half = Math.sqrt(Math.max(0, r * r - (j * cell) ** 2));
      const w = Math.round(half / cell) * cell;
      if (w <= 0) continue;
      ctx.fillRect(Math.round(cx - w), Math.round(cy + j * cell), w * 2, cell);
    }
  }
}
