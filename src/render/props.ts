// Scenery: lone trees, bushes, rocks, flowers, farmland and livestock around cities, beach litter,
// reeds and lily pads in the shallows, and the debris of old wars, scattered over the map by a hash
// of each tile so every client sees the same land. Render-only: props are never in the match
// state, never block anything, and are hidden where a building stands. (Forests and mountains
// paint their own trees and peaks into the ground: ./painter.ts.)
import { T } from '../data/terrain';
import type { MatchState } from '../sim/types';
import { nav } from '../sim/nav';
import { hasSprite, spriteNames, sprite, opaqueBounds } from './art';
import { plotAt, farmed, inCrop, CROP } from './farmland';
import { TILE } from './view';

export interface Prop {
  /** sprite name */
  name: string;
  /** world position of the sprite's anchor (bottom-center for tall props, center for flat ones) */
  x: number;
  y: number;
  /** flat props lie on the ground (drawn under everything); tall ones are y-sorted with units */
  flat: boolean;
  /** tile the prop stands on (hidden when a building covers it) */
  tile: number;
  /** livestock and wildlife: turn around now and then */
  alive: boolean;
  /** mirrored (set once, by hash) */
  flip: boolean;
}

/** Decorations that lie flat on the ground. */
const FLAT = new Set(['flowers', 'crops', 'wheat', 'flowersw', 'flowersy', 'heather', 'lilypads', 'pond', 'shells', 'crater', 'pumpkins', 'cabbages', 'tulips', 'puddle', 'campfire', 'slab']);
const ALIVE = new Set(['sheep', 'cow', 'chicken', 'pig', 'goat', 'deer', 'fox', 'gull']);
/** what can turn up where: [kind, weight] */
type Table = [string, number][];
/** farmyard bits in the grass between the fields, livestock in the pastures */
const FARMYARD: Table = [['haybale', 3], ['cart', 1], ['well', 0.8], ['beehives', 1], ['chicken', 1.5], ['pig', 1], ['pumpkins', 1], ['sunflowers', 1], ['firewood', 0.6]];
const PASTURE: Table = [['sheep', 4], ['cow', 2]];
const WOODS_EDGE: Table = [['tree', 6], ['shrub', 2], ['berrybush', 1], ['stump', 1.5], ['log', 1.2], ['mushrooms', 1.2], ['fern', 2], ['firewood', 0.4], ['fox', 0.3]];
const FOOTHILLS: Table = [['rock', 3], ['mossyrocks', 2], ['cairn', 0.6], ['slab', 1], ['snowrock', 0.5]];
const MEADOW: Table = [['tree', 3], ['shrub', 2], ['berrybush', 1], ['flowersw', 2], ['flowersy', 2], ['heather', 1.5], ['lavender', 1], ['grassclump', 3], ['rock', 1], ['fern', 0.6]];
const DRY: Table = [['thornbush', 2], ['deadbush', 1.5], ['termites', 0.5], ['grassclump', 2], ['rock', 1]];
const RELICS: Table = [['ruin', 2], ['column', 1.5], ['tankwreck', 1.2], ['crater', 2], ['sandbags', 1.5], ['wire', 1], ['barrels', 1], ['crates', 1], ['campfire', 0.6]];
const BEACH: Table = [['driftwood', 2], ['shells', 2], ['beachrocks', 2], ['palm', 3], ['gull', 1], ['rowboat', 0.4]];
const SHALLOWS: Table = [['reeds', 3], ['lilypads', 2], ['searock', 1.5], ['marshgrass', 1]];
const ROADSIDE: Table = [['signpost', 1], ['milestone', 1], ['lamppost', 0.6]];
const CHUNK = 16;

/** A stable 0..1 hash of a tile and a salt. */
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Props {
  private chunks = new Map<number, Prop[]>();

  constructor(private s: MatchState, blocked: (x0: number, y0: number, x1: number, y1: number) => boolean = () => false) {
    const { w, h, terrain } = s.map, seed = s.setup.seed;
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : terrain[y * w + x]);
    const near = (x: number, y: number, r: number, t: number) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (at(x + dx, y + dy) === t) return true;
      return false;
    };
    const all = (x: number, y: number, r: number, ok: (t: number) => boolean) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!ok(at(x + dx, y + dy))) return false;
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
    for (const c of s.map.cities) take(c.x, c.y, 3);
    for (const b of s.map.bridges ?? [])
      for (let t = 0; t <= 1; t += 0.1) take(Math.floor(b.x0 + (b.x1 - b.x0) * t), Math.floor(b.y0 + (b.y1 - b.y0) * t), Math.ceil(b.w / 2) + 1);
    const cityDist = (x: number, y: number) => Math.min(...s.map.cities.map((c) => Math.hypot(c.x - x, c.y - y)));
    const startDist = (x: number, y: number) => Math.min(...s.map.starts.map((c) => Math.hypot(c.x - x, c.y - y)));
    const trees = [...spriteNames('tree:d'), ...spriteNames('tree:c'), ...spriteNames('tree:x')];
    const pick = (table: Table, r: number): string => {
      const tot = table.reduce((a, [, wt]) => a + wt, 0);
      let k = r * tot;
      for (const [kind, wt] of table) if ((k -= wt) < 0) return kind;
      return table[table.length - 1][0];
    };
    const landish = (t: number) => t === T.GRASS || t === T.HILL || t === T.ROAD || t === T.RICH || t === T.FOREST;
    const dryAt = (x: number, y: number) => hash(x >> 3, y >> 3, seed + 31) < 0.18;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const t = at(x, y);
        const r = hash(x, y, seed), r2 = hash(x, y, seed + 7);
        let kind = '';
        // tall scenery keeps a tile clear of roads, and of the trees and peaks the painter spills
        // past forest and mountain edges, so nothing stands on top of anything else
        // (trees and peaks two rows down still reach up over this tile with their crowns)
        const below = (k: number, dy: number) => at(x - 1, y + dy) !== k && at(x, y + dy) !== k && at(x + 1, y + dy) !== k;
        const clearOf = (k: number) => !near(x, y, 1, k) && below(k, 2) && (k !== T.MOUNTAIN || below(k, 3));
        const sideRoad = at(x - 1, y) === T.ROAD || at(x + 1, y) === T.ROAD;
        if (t === T.GRASS && all(x, y, 1, landish) && free(x, y, 1) && clearOf(T.FOREST) && clearOf(T.MOUNTAIN) && !near(x, y, 2, T.WATER) && !near(x, y, 2, T.DEEP)) {
          const d = cityDist(x, y);
          // what the prop's footprint lands on: nothing stands in the crops; livestock graze the pastures
          const foot = [[16, 29], [2, 29], [30, 29], [16, 8], [4, 12], [28, 12]].map(([fx, fy]) => {
            const pl = plotAt(x * TILE + fx, y * TILE + fy);
            return farmed(pl, s.map) && inCrop(pl) ? pl.kind : -2;
          });
          const pasture = foot.every((k) => k === CROP.PASTURE);
          const crops = foot.some((k) => k !== -2);
          if (pasture) { if (r < 0.35) kind = pick(PASTURE, r2); }
          else if (crops) { /* the fields stay clear */ }
          else if (d >= 2.5 && d <= 7) {
            if (r < 0.1 && clearOf(T.ROAD)) kind = pick(FARMYARD, r2);
          } else if (!clearOf(T.ROAD)) {
            if (sideRoad && !near(x, y, 1, T.SAND) && r < 0.012 && d < 12) kind = pick(ROADSIDE, r2);
          } else if (near(x, y, 2, T.FOREST) && r < 0.11) kind = pick(WOODS_EDGE, r2);
          else if (near(x, y, 2, T.MOUNTAIN) && r < 0.08) kind = pick(FOOTHILLS, r2);
          else if (dryAt(x, y) && r < 0.04) kind = pick(DRY, r2);
          else if (r < 0.042) kind = pick(MEADOW, r2 * 0.999);
          else if (r < 0.046 && d > 8 && startDist(x, y) > 10) kind = pick(RELICS, r2);
        } else if (t === T.SAND && free(x, y, 1) && clearOf(T.ROAD) && clearOf(T.FOREST) && clearOf(T.MOUNTAIN)) {
          // a tile back from the waterline (the painted shore wanders), so nothing straddles it
          if (near(x, y, 2, T.WATER) && !near(x, y, 1, T.WATER) && !near(x, y, 1, T.DEEP) && r < 0.09) kind = pick(BEACH, r2);
          else if (!near(x, y, 1, T.WATER) && !near(x, y, 1, T.DEEP) && r < 0.025) kind = r2 < 0.6 ? 'palm' : 'beachrocks';
        } else if (t === T.WATER && free(x, y, 1) && clearOf(T.FOREST) && clearOf(T.MOUNTAIN) && r < 0.07) {
          // only in calm shallows: open water all round (nothing straddles the shore), land close by, no deep sea near
          // (real land: a lone sand tile is smoothed away by the painter)
          let land = 0;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const k = at(x + dx, y + dy); if (k === T.SAND || k === T.GRASS) land++; }
          const shore = land >= 4;
          // calm water only (no open sea within 4 tiles), in the band next to the land, its own neighbours water
          const four = at(x - 1, y) === T.WATER && at(x + 1, y) === T.WATER && at(x, y - 1) === T.WATER && at(x, y + 1) === T.WATER;
          const bank = near(x, y, 1, T.SAND) || near(x, y, 1, T.GRASS);
          if (shore && four && bank && !near(x, y, 4, T.DEEP)) kind = pick(SHALLOWS, r2);
        } else if (t === T.HILL && free(x, y, 1) && !near(x, y, 1, T.ROAD) && !near(x, y, 1, T.FOREST) && !near(x, y, 1, T.MOUNTAIN) && r < 0.05) kind = pick(r2 < 0.5 ? FOOTHILLS : MEADOW, (r2 * 2) % 1);
        if (!kind) continue;
        let name = 'prop:' + kind;
        if (kind === 'tree') {
          if (!trees.length) continue;
          name = trees[Math.floor(hash(x, y, seed + 3) * trees.length)];
        }
        if (!hasSprite(name)) continue;
        const flat = FLAT.has(kind);
        // a little jitter so the scatter doesn't sit on the grid
        const jx = (hash(x, y, seed + 13) - 0.5) * 0.5, jy = (hash(x, y, seed + 17) - 0.5) * 0.3;
        // the art's own box: it may not cover a baked tree or peak, nor a crop (livestock may graze a pasture)
        const sp = sprite(name, -1), ob = opaqueBounds(name);
        if (sp && ob) {
          const ax = (x + 0.5 + jx) * TILE, ay = (flat ? y + 0.5 + jy : y + 0.9 + jy) * TILE;
          const bx0 = ax - sp.ox + ob.x0, by0 = ay - sp.oy + ob.y0, bx1 = ax - sp.ox + ob.x1, by1 = ay - sp.oy + ob.y1;
          let bad = !flat && blocked(bx0, by0, bx1, by1);
          for (let py = by0; py <= by1 && !bad; py += 4)
            for (let px = bx0; px <= bx1 && !bad; px += 4) {
              const pl = plotAt(Math.floor(px), Math.floor(py));
              if (inCrop(pl) && pl.kind !== CROP.PASTURE && farmed(pl, s.map)) bad = true;
            }
          if (bad) continue;
        }
        take(x, y, 0);
        const p: Prop = {
          name, x: x + 0.5 + jx, y: flat ? y + 0.5 + jy : y + 0.9 + jy, flat, tile: y * w + x,
          alive: ALIVE.has(kind), flip: hash(x, y, seed + 19) < 0.5,
        };
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
