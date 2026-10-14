// Scenery: trees, bushes, boulders, flowers, and farm fields scattered over the map
// by a hash of each tile, so every client sees the same land. Render-only: props are never in the
// match state, never block anything, and are hidden where a building stands.
import { T } from '../data/terrain';
import type { MatchState } from '../sim/types';
import { nav } from '../sim/nav';

export interface Prop {
  kind: string;
  /** world position of the sprite's anchor (bottom-center for tall props, center for flat ones) */
  x: number;
  y: number;
  /** flat props lie on the ground (drawn under everything); tall ones are y-sorted with units */
  flat: boolean;
  /** tile the prop stands on (hidden when a building covers it) */
  tile: number;
}

/** Sprite names (`prop:<kind>`) by role. */
const TREES = ['oak', 'oak2', 'pines'];
const FLAT = new Set(['flowers', 'crops', 'wheat']);
const CHUNK = 16;

/** A stable 0..1 hash of a tile and a salt. */
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Props {
  private chunks = new Map<number, Prop[]>();

  constructor(private s: MatchState) {
    const { w, h, terrain, seed } = { ...s.map, seed: s.setup.seed };
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : terrain[y * w + x]);
    const near = (x: number, y: number, r: number, t: number) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (at(x + dx, y + dy) === t) return true;
      return false;
    };
    const all = (x: number, y: number, r: number, t: number) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (at(x + dx, y + dy) !== t) return false;
      return true;
    };
    const taken = new Uint8Array(w * h);
    const free = (x: number, y: number, r: number) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (at(x + dx, y + dy) >= 0 && taken[(y + dy) * w + x + dx]) return false;
      return true;
    };
    const take = (x: number, y: number, r: number) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (at(x + dx, y + dy) >= 0) taken[(y + dy) * w + x + dx] = 1;
    };
    // keep bases, deposits and city centers clear
    for (const st of s.map.starts) take(Math.floor(st.x), Math.floor(st.y), 6);
    for (const d of s.map.deposits) take(d.x, d.y, 2);
    for (const c of s.map.cities) take(c.x, c.y, 2);
    const cityDist = (x: number, y: number) => Math.min(...s.map.cities.map((c) => Math.hypot(c.x - x, c.y - y)));
    const pick = <K>(list: K[], r: number) => list[Math.floor(r * list.length) % list.length];
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const t = at(x, y);
        const r = hash(x, y, seed), r2 = hash(x, y, seed + 7);
        let kind = '';
        // (no props on mountains: the snowy-peak tileset draws its own peaks)
        if (t === T.FOREST) {
          // a few taller trees poke out of the canopy, so big forests aren't one flat texture
          if (all(x, y, 1, T.FOREST) && r < 0.06 && free(x, y, 1)) kind = r2 < 0.6 ? 'pines' : 'oak';
        } else if (t === T.GRASS && all(x, y, 1, T.GRASS) && free(x, y, 1)) {
          const d = cityDist(x, y);
          if (d >= 3 && d <= 6 && r < 0.09) kind = r2 < 0.4 ? 'crops' : r2 < 0.75 ? 'wheat' : 'hay';
          else if (near(x, y, 2, T.FOREST) && r < 0.1) kind = r2 < 0.75 ? pick(TREES, r2 / 0.75) : 'bush';
          else if (near(x, y, 2, T.MOUNTAIN) && r < 0.06) kind = 'boulders';
          else if (r < 0.012) kind = pick(TREES, r2);
          else if (r < 0.022) kind = 'bush';
          else if (r < 0.034) kind = 'flowers';
          else if (r < 0.038) kind = 'boulders';
          else if (r < 0.0395 && d > 8) kind = 'ruin';
        }
        if (!kind) continue;
        take(x, y, kind === 'crops' || kind === 'wheat' ? 1 : 0);
        const flat = FLAT.has(kind);
        // a little jitter so the scatter doesn't sit on the grid
        const jx = (hash(x, y, seed + 13) - 0.5) * 0.5, jy = (hash(x, y, seed + 17) - 0.5) * 0.3;
        const p: Prop = { kind, x: x + 0.5 + jx, y: flat ? y + 0.5 + jy : y + 0.9 + jy, flat, tile: y * w + x };
        const key = Math.floor(y / CHUNK) * 4096 + Math.floor(x / CHUNK);
        if (!this.chunks.has(key)) this.chunks.set(key, []);
        this.chunks.get(key)!.push(p);
      }
  }

  /** Props with an anchor inside the tile rectangle, minus those on or next to a building (a tree beside one would cover it). */
  visible(x0: number, y0: number, x1: number, y1: number): Prop[] {
    const occ = nav(this.s).occ, w = this.s.map.w, h = this.s.map.h;
    const near = (t: number) => {
      const tx = t % w, ty = (t - tx) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = tx + dx, y = ty + dy;
          if (x >= 0 && y >= 0 && x < w && y < h && occ[y * w + x]) return true;
        }
      return false;
    };
    const out: Prop[] = [];
    for (let cy = Math.floor(Math.max(0, y0) / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++)
      for (let cx = Math.floor(Math.max(0, x0) / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++)
        for (const p of this.chunks.get(cy * 4096 + cx) ?? []) {
          if (p.x < x0 || p.y < y0 || p.x > x1 || p.y > y1 || near(p.tile)) continue;
          out.push(p);
        }
    return out;
  }
}
