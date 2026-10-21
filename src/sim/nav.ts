// Navigation: passability grids per movement layer, connected components, flow fields and
// line-of-sight walk checks. Everything here is derived from MatchState (terrain + building
// footprints) and cached outside it; caches rebuild when `navVer` changes.
//
// Flow fields: one Dijkstra from the goal tile(s) serves every unit heading there. The search is
// resumable — it only expands as far as the units asking need — so short moves stay cheap. A
// building going up or coming down only throws away the fields whose search got near it, and the
// movement step shares a budget of search steps per tick (see `NAV_BUDGET`), so a burst of new
// paths is spread over a few ticks instead of stalling one.
import { TERRAIN } from '../data/terrain';
import { BUILDINGS } from '../data/buildings';
import type { Layer } from '../data/damage';
import type { MatchState } from './types';
import { Heap } from './heap';

const SQRT2 = Math.SQRT2;
const MAX_FIELDS = 64;
/** spare flow-field arrays kept for reuse (each set is 9 bytes a tile: ~750 KB on a Large map) */
const MAX_POOL = 8;
/**
 * Flow-field search steps the movement step may spend per tick. A unit whose path isn't ready
 * waits where it is (a tick or two), and the search carries on next tick.
 */
export const NAV_BUDGET = 40000;

export interface Nav {
  w: number;
  h: number;
  ver: number;
  /** ground step cost per tile (0 = blocked) */
  ground: Uint8Array;
  /** 1 = ships can sail */
  naval: Uint8Array;
  /** building id on each tile (0 = none) */
  occ: Int32Array;
  /** ground speed multiplier per tile */
  speed: Float32Array;
  compGround: Int32Array;
  compNaval: Int32Array;
  /** tiles (Chebyshev) to the nearest blocked tile or the map edge, capped at 255 */
  clearGround: Uint8Array;
  clearNaval: Uint8Array;
  fields: Map<string, FlowField>;
  /** flow-field arrays to reuse */
  pool: FieldBufs[];
  /** search steps left this tick (Infinity outside the movement step) */
  budget: number;
}

interface FieldBufs { dist: Float32Array; closed: Uint8Array; nextOf: Int32Array }

const navCache = new WeakMap<object, Nav>();

export function nav(s: MatchState): Nav {
  let n = navCache.get(s.map);
  if (n && n.ver === s.navVer) return n;
  const { w, h, terrain } = s.map;
  // terrain never changes during a match: only building footprints do, and they only block ground
  const fresh = !n;
  if (!n) {
    n = {
      w, h, ver: -1,
      ground: new Uint8Array(w * h), naval: new Uint8Array(w * h), occ: new Int32Array(w * h),
      speed: new Float32Array(w * h), compGround: new Int32Array(w * h), compNaval: new Int32Array(w * h),
      clearGround: new Uint8Array(w * h), clearNaval: new Uint8Array(w * h),
      fields: new Map(), pool: [], budget: Infinity,
    };
    navCache.set(s.map, n);
    for (let i = 0; i < w * h; i++) {
      const t = TERRAIN[terrain[i]];
      n.naval[i] = t.naval ? 1 : 0;
      n.speed[i] = t.ground;
    }
    label(n.naval, n.compNaval, w, h);
    clearance(n.naval, n.clearNaval, w, h);
  }
  n.ver = s.navVer;
  const before = fresh ? null : n.ground.slice();
  n.occ.fill(0);
  for (let i = 0; i < w * h; i++) n.ground[i] = TERRAIN[terrain[i]].cost;
  for (const id in s.ents) {
    const e = s.ents[id];
    if (e.t !== 'b') continue;
    const d = BUILDINGS[e.kind];
    for (let y = e.ty; y < e.ty + d.h; y++)
      for (let x = e.tx; x < e.tx + d.w; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        n.occ[i] = e.id;
        n.ground[i] = 0;
      }
  }
  label(n.ground, n.compGround, w, h);
  clearance(n.ground, n.clearGround, w, h);
  // keep every ground field whose search never came near a changed tile: carrying on with it gives
  // exactly what a new search would (sea fields never see buildings)
  if (before) {
    const changed: number[] = [];
    for (let i = 0; i < w * h; i++) if (before[i] !== n.ground[i]) changed.push(i);
    for (const [k, f] of n.fields)
      if (f.layer === 'ground' && f.near(changed)) {
        n.fields.delete(k);
        f.release();
      }
  }
  return n;
}

/** Chebyshev distance transform: how many tiles to the nearest blocked tile (or off the map). */
function clearance(pass: Uint8Array, out: Uint8Array, w: number, h: number) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = pass[i] ? Math.min(255, x + 1, y + 1, w - x, h - y) : 0;
    }
  // forward pass (left and the row above), then backward (right and the row below)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = out[i];
      if (!v) continue;
      if (x > 0) v = Math.min(v, out[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, out[i - w] + 1);
        if (x > 0) v = Math.min(v, out[i - w - 1] + 1);
        if (x < w - 1) v = Math.min(v, out[i - w + 1] + 1);
      }
      out[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = out[i];
      if (!v) continue;
      if (x < w - 1) v = Math.min(v, out[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, out[i + w] + 1);
        if (x < w - 1) v = Math.min(v, out[i + w + 1] + 1);
        if (x > 0) v = Math.min(v, out[i + w - 1] + 1);
      }
      out[i] = v;
    }
}

/** Connected components (4-connected) of passable tiles; -1 = blocked. */
function label(pass: Uint8Array, comp: Int32Array, w: number, h: number) {
  comp.fill(-1);
  let next = 0;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!pass[i] || comp[i] >= 0) continue;
    comp[i] = next;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w, y = (j - x) / w;
      if (x > 0 && pass[j - 1] && comp[j - 1] < 0) { comp[j - 1] = next; stack.push(j - 1); }
      if (x < w - 1 && pass[j + 1] && comp[j + 1] < 0) { comp[j + 1] = next; stack.push(j + 1); }
      if (y > 0 && pass[j - w] && comp[j - w] < 0) { comp[j - w] = next; stack.push(j - w); }
      if (y < h - 1 && pass[j + w] && comp[j + w] < 0) { comp[j + w] = next; stack.push(j + w); }
    }
    next++;
  }
}

export function passable(n: Nav, layer: Layer, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= n.w || ty >= n.h) return false;
  if (layer === 'air') return true;
  const i = ty * n.w + tx;
  return layer === 'naval' ? n.naval[i] === 1 : n.ground[i] > 0;
}

export function compOf(n: Nav, layer: Layer, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= n.w || ty >= n.h) return -1;
  if (layer === 'air') return 0;
  const i = ty * n.w + tx;
  return layer === 'naval' ? n.compNaval[i] : n.compGround[i];
}

/**
 * The passable tile closest to (gx, gy) that is reachable from component `comp`, searching in
 * growing rings. Returns null if nothing within `maxR`.
 */
export function nearestReachable(n: Nav, layer: Layer, gx: number, gy: number, comp: number, maxR = 48): [number, number] | null {
  gx = Math.max(0, Math.min(n.w - 1, gx));
  gy = Math.max(0, Math.min(n.h - 1, gy));
  if (layer === 'air') return [gx, gy];
  if (compOf(n, layer, gx, gy) === comp) return [gx, gy];
  for (let r = 1; r <= maxR; r++) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = gx + dx, y = gy + dy;
        if (compOf(n, layer, x, y) !== comp) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = [x, y]; }
      }
    if (best) return best;
  }
  return null;
}

/** Is the straight segment walkable for a body of `radius` (samples the center and both sides)? */
export function lineWalkable(n: Nav, layer: Layer, x0: number, y0: number, x1: number, y1: number, radius = 0.2): boolean {
  if (layer === 'air') return true;
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return passable(n, layer, Math.floor(x0), Math.floor(y0));
  // open ground: every tile a sample could touch is within floor(len + radius) + 1 of the start
  // tile, so if the nearest obstacle is farther than that the answer is yes without sampling
  const sx = Math.floor(x0), sy = Math.floor(y0);
  if (sx >= 0 && sy >= 0 && sx < n.w && sy < n.h) {
    const clear = (layer === 'naval' ? n.clearNaval : n.clearGround)[sy * n.w + sx];
    if (clear > Math.floor(len + Math.abs(radius)) + 1) return true;
  }
  const steps = Math.ceil(len / 0.25);
  const px = (-dy / len) * radius, py = (dx / len) * radius;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + dx * t, y = y0 + dy * t;
    if (!passable(n, layer, Math.floor(x), Math.floor(y))) return false;
    if (radius > 0 && (!passable(n, layer, Math.floor(x + px), Math.floor(y + py)) || !passable(n, layer, Math.floor(x - px), Math.floor(y - py)))) return false;
  }
  return true;
}

export class FlowField {
  dist: Float32Array;
  closed: Uint8Array;
  /** next() per tile once known (-2 = not yet): final as soon as the tile is settled */
  private nextOf: Int32Array;
  private heap = new Heap(1024);
  used = 0;

  constructor(private n: Nav, readonly layer: Layer, goals: number[]) {
    const b = n.pool.pop();
    if (b) {
      this.dist = b.dist.fill(Infinity);
      this.closed = b.closed.fill(0);
      this.nextOf = b.nextOf.fill(-2);
    } else {
      this.dist = new Float32Array(n.w * n.h).fill(Infinity);
      this.closed = new Uint8Array(n.w * n.h);
      this.nextOf = new Int32Array(n.w * n.h).fill(-2);
    }
    for (const g of goals) {
      this.dist[g] = 0;
      this.heap.push(g, 0);
    }
  }

  /** Hand the arrays back for another field to use (this one must not be used again). */
  release() {
    if (this.n.pool.length < MAX_POOL) this.n.pool.push({ dist: this.dist, closed: this.closed, nextOf: this.nextOf });
  }

  /**
   * Has the search reached any of these tiles or a neighbor of one? (Every cost it has read is of
   * a tile next to one it reached, so if not, the change can't have made it any different.)
   */
  near(tiles: number[]): boolean {
    const { n, dist } = this;
    for (const t of tiles) {
      const x = t % n.w, y = (t - x) / n.w;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(n.h - 1, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(n.w - 1, x + 1); xx++) if (dist[yy * n.w + xx] !== Infinity) return true;
    }
    return false;
  }

  private cost(i: number): number {
    if (this.layer === 'naval') return this.n.naval[i] ? 10 : 0;
    return this.n.ground[i];
  }

  /**
   * Expand until tile `i` is settled. Returns its distance (Infinity if unreachable, NaN if this
   * tick's search budget ran out first: ask again next tick).
   */
  ensure(i: number): number {
    const { n, dist, closed, heap } = this;
    const w = n.w, h = n.h;
    while (!closed[i] && heap.size) {
      if (n.budget <= 0) return NaN;
      const j = heap.pop();
      if (closed[j]) continue;
      n.budget--;
      closed[j] = 1;
      const x = j % w, y = (j - x) / w;
      const cj = this.cost(j) || 10;
      const dj = dist[j];
      for (let k = 0; k < 8; k++) {
        const dx = DX[k], dy = DY[k];
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (closed[ni]) continue;
        const cn = this.cost(ni);
        if (!cn) continue;
        if (dx && dy && (!this.cost(y * w + nx) || !this.cost(ny * w + x))) continue; // no corner cutting
        const nd = dj + ((cj + cn) / 2) * (dx && dy ? SQRT2 : 1);
        if (nd < dist[ni]) {
          dist[ni] = nd;
          heap.push(ni, nd);
        }
      }
    }
    return closed[i] ? dist[i] : Infinity;
  }

  /**
   * The neighbor tile to step to from tile (tx, ty): the settled neighbor with the lowest distance.
   * Returns -1 at the goal or when stuck.
   */
  next(tx: number, ty: number): number {
    const { n } = this;
    const w = n.w;
    const i = ty * w + tx;
    const known = this.nextOf[i];
    if (known !== -2) return known;
    // Dijkstra settles tiles in order of distance, so once this tile is settled every neighbor
    // closer to the goal is too: the answer can't change and is worth keeping
    const here = this.ensure(i);
    if (Number.isNaN(here)) return -1;
    if (here === 0 || here === Infinity) return (this.nextOf[i] = -1);
    let best = -1, bd = here;
    for (let k = 0; k < 8; k++) {
      const dx = DX[k], dy = DY[k];
      const nx = tx + dx, ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= n.h) continue;
      const ni = ny * w + nx;
      if (!this.closed[ni]) continue;
      if (dx && dy && (!this.cost(ty * w + nx) || !this.cost(ny * w + tx))) continue;
      if (this.dist[ni] < bd) { bd = this.dist[ni]; best = ni; }
    }
    return (this.nextOf[i] = best);
  }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/** A cached flow field toward one tile. */
export function fieldTo(n: Nav, layer: Layer, gx: number, gy: number): FlowField {
  const key = `${layer}:${gy * n.w + gx}`;
  return cachedField(n, key, () => new FlowField(n, layer, [gy * n.w + gx]));
}

/** A cached flow field toward the passable tiles around a building (to build, repair or attack it). */
export function fieldToBuilding(n: Nav, layer: Layer, id: number, tx: number, ty: number, bw: number, bh: number): FlowField {
  const key = `${layer}:b${id}`;
  return cachedField(n, key, () => {
    const goals: number[] = [];
    for (let y = ty - 1; y <= ty + bh; y++)
      for (let x = tx - 1; x <= tx + bw; x++) {
        if (x >= tx && x < tx + bw && y >= ty && y < ty + bh) continue;
        if (passable(n, layer, x, y)) goals.push(y * n.w + x);
      }
    return new FlowField(n, layer, goals);
  });
}

let fieldClock = 0;
const lastUse = new WeakMap<FlowField, number>();

/** Fields are kept least-recently-used; which one is evicted never changes results, only speed. */
function cachedField(n: Nav, key: string, make: () => FlowField): FlowField {
  let f = n.fields.get(key);
  if (!f) {
    if (n.fields.size >= MAX_FIELDS) {
      let old = '', oldest = Infinity;
      for (const [k, g] of n.fields) { const t = lastUse.get(g) ?? 0; if (t < oldest) { oldest = t; old = k; } }
      n.fields.get(old)?.release();
      n.fields.delete(old);
    }
    f = make();
    n.fields.set(key, f);
  }
  lastUse.set(f, ++fieldClock);
  return f;
}

/** The passable tile of a layer closest to (gx, gy), or null within `maxR`. */
export function nearestPassable(n: Nav, layer: Layer, gx: number, gy: number, maxR = 8): [number, number] | null {
  if (passable(n, layer, gx, gy)) return [gx, gy];
  for (let r = 1; r <= maxR; r++) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !passable(n, layer, gx + dx, gy + dy)) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = [gx + dx, gy + dy]; }
      }
    if (best) return best;
  }
  return null;
}
