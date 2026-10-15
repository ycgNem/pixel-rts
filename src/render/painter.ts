// Ground painter: the battlefield drawn pixel by pixel from the tile map, so the land looks like
// land rather than a grid. Render-only (the sim still thinks in whole tiles).
//
// Every terrain is a field: 1 on its tiles, 0 elsewhere, read between tile centers by bilinear
// filtering, so the 0.5 contour runs along tile edges and cuts the corners of staircases. Slow
// noise added to each field makes coasts, forest edges and ridges wander naturally. Then:
// - water is shaded by its distance from land (turquoise shallows to navy deeps), with a foam rim;
// - higher ground shows its south face (¾ view): grass over sand a dirt bank, hills a shaded
//   slope, mountains a cliff, all inside their own tiles so the footprint matches the sim;
// - grass gets meadows (lush and dry patches), tufts and flowers; sand gets wet edges and pebbles;
// - forests are packed with tree sprites and mountains carry peak sprites, baked in y order.
// Animated water (lapping waves, glints) is a separate per-chunk layer (`WaterAnim`).
import { T } from '../data/terrain';
import { PALETTE_RGB, C } from '../data/palette';
import type { GameMap } from '../sim/types';
import { hash2, valueNoise } from '../sim/rng';
import { sprite, spriteNames, opaqueBounds, type Sprite } from './art';
import { TILE } from './view';
import { FARM_RING, RING_PER_LEVEL, plotAt, farmed, cropPixel } from './farmland';

/** Pixel classes of the painted ground. */
export const G = { DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, RICH: 4, ROAD: 5, HILL: 6, FOREST: 7, MOUNTAIN: 8 } as const;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

/** rows painted below a chunk, so mountains and banks can see where their south face ends */
const BELOW = 14;
/** how tall a mountain's cliff face is (px), and a hill's or a grass bank's */
const CLIFF = 10, HILL_BANK = 3, GRASS_BANK = 2;
/** water depth bands (tiles from land) and their colors, shallow → deep */
const DEPTHS = [0.75, 6.5];
const WATER_C = [C.sky, C.blue, C.dusk];
/** mountain rock ramp (dark → light) and snow ramp */
const ROCK = [C.ink, C.plum, C.slate, C.stone, C.pebble];
const SNOW = [C.pebble, C.frost, C.white];
const FLOWERS = [C.white, C.gold, C.orchid, C.ice, 61, C.cream];
/** Noise channels (each a sum of two octaves of value noise on world pixels). */
function chan(wx: number, wy: number, seed: number): number {
  return valueNoise(wx / 44, wy / 44, seed) * 0.65 + valueNoise(wx / 13, wy / 13, seed + 9) * 0.35;
}
function meadow(wx: number, wy: number, seed: number): number {
  return valueNoise(wx / 170, wy / 170, seed + 40) * 0.7 + valueNoise(wx / 47, wy / 47, seed + 41) * 0.3;
}

export interface Painted {
  /** RGBA pixels of the chunk (S × S) */
  img: ImageData;
  /** water pixels near the shore for the wave layer: pixel index and closeness to land (0-255) */
  shore: Uint32Array;
  shoreK: Uint8Array;
  /** a sprinkle of open-water pixels for glints */
  glints: Uint32Array;
  /** sprites to bake over the ground, in draw order: [sprite, x, y] in chunk px */
  sprites: [Sprite, number, number][];
}

export class Painter {
  readonly w: number;
  readonly h: number;
  private land: Float32Array;
  private grass: Float32Array;
  private ind: Record<number, Float32Array> = {};
  private shoreDist: Float32Array;
  private mDepth: Float32Array;
  private hillSoft: Float32Array;
  private richSoft: Float32Array;
  /** tiles to the nearest city (farmland rings) */
  private cityDist: Float32Array;
  /** tiles where no tree or peak is baked: around cities, deposits and starting bases */
  private clear: Uint8Array;
  private seed: number;
  private trees: { d: Sprite[]; c: Sprite[] };
  private peaks: { snow: Sprite[]; rock: Sprite[] };
  /** each baked sprite's opaque box relative to its anchor */
  private boxes = new Map<Sprite, [number, number, number, number]>();

  constructor(private map: GameMap, seed: number) {
    const { w, h, terrain } = map;
    this.w = w;
    this.h = h;
    this.seed = seed % 1000;
    const n = w * h;
    this.land = new Float32Array(n);
    this.grass = new Float32Array(n);
    for (const t of [T.RICH, T.ROAD, T.HILL, T.FOREST, T.MOUNTAIN]) this.ind[t] = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = terrain[i];
      const wet = t === T.DEEP || t === T.WATER;
      this.land[i] = wet ? 0 : 1;
      this.grass[i] = wet || t === T.SAND ? 0 : 1;
      if (this.ind[t]) this.ind[t][i] = 1;
    }
    // water: tiles from the nearest land (deep water counts a little deeper still)
    this.shoreDist = distance(w, h, (i) => this.land[i] === 1, 6);
    for (let i = 0; i < n; i++) if (terrain[i] === T.DEEP) this.shoreDist[i] += 1.2;
    // mountains: tiles from the nearest foot of the range
    this.mDepth = distance(w, h, (i) => terrain[i] !== T.MOUNTAIN, 5);
    this.hillSoft = blur(blur(this.ind[T.HILL], w, h), w, h);
    this.richSoft = blur(this.ind[T.RICH], w, h);
    this.clear = new Uint8Array(n);
    const keep = (cx: number, cy: number, r: number) => {
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++)
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++)
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) this.clear[y * w + x] = 1;
    };
    for (const c of map.cities) keep(c.x + 0.5, c.y + 0.5, 2.6);
    for (const d of map.deposits) keep(d.x + 1, d.y + 1, 1.6);
    for (const st of map.starts) keep(st.x, st.y, 4.5);
    for (const b of map.bridges ?? []) for (const t of [0, 0.25, 0.5, 0.75, 1]) keep(b.x0 + (b.x1 - b.x0) * t, b.y0 + (b.y1 - b.y0) * t, b.w / 2 + 1.5);
    this.cityDist = new Float32Array(n).fill(99);
    for (const c of map.cities)
      for (let y = Math.max(0, c.y - 9); y <= Math.min(h - 1, c.y + 9); y++)
        for (let x = Math.max(0, c.x - 9); x <= Math.min(w - 1, c.x + 9); x++) {
          const i = y * w + x;
          this.cityDist[i] = Math.min(this.cityDist[i], Math.hypot(x - c.x, y - c.y));
        }

    const pick = (prefix: string, fallback: string[]) => {
      const names = spriteNames(prefix);
      return (names.length ? names : fallback).map((nm) => {
        const sp = sprite(nm, -1), b = opaqueBounds(nm);
        if (sp && b) this.boxes.set(sp, [b.x0 - sp.ox, b.y0 - sp.oy, b.x1 - sp.ox, b.y1 - sp.oy]);
        return sp;
      }).filter((s): s is Sprite => !!s);
    };
    this.trees = { d: pick('tree:d', ['prop:oak', 'prop:oak2']), c: pick('tree:c', ['prop:pines']) };
    this.peaks = { snow: pick('peak:s', ['prop:peak', 'prop:peaks']), rock: pick('peak:r', ['prop:peak']) };
  }

  /** Bilinear read of a tile field at tile coordinates (tile centers at whole numbers). */
  private bil(f: Float32Array, u: number, v: number): number {
    const w = this.w, h = this.h;
    const i = Math.floor(u), j = Math.floor(v);
    const fx = u - i, fy = v - j;
    const i0 = i < 0 ? 0 : i >= w ? w - 1 : i, i1 = i + 1 < 0 ? 0 : i + 1 >= w ? w - 1 : i + 1;
    const j0 = j < 0 ? 0 : j >= h ? h - 1 : j, j1 = j + 1 < 0 ? 0 : j + 1 >= h ? h - 1 : j + 1;
    const a = f[j0 * w + i0], b = f[j0 * w + i1], c = f[j1 * w + i0], d = f[j1 * w + i1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  /** In a kept-clear tile (city, deposit, base)? */
  private clearAt(wx: number, wy: number): boolean {
    const tx = Math.min(this.w - 1, Math.max(0, Math.floor(wx / TILE))), ty = Math.min(this.h - 1, Math.max(0, Math.floor(wy / TILE)));
    return this.clear[ty * this.w + tx] === 1;
  }

  /** The class of the ground at a world pixel (used for sprites placed at arbitrary points). */
  private classAt(wx: number, wy: number, n0: number, n1: number, n2: number): number {
    const u = wx / TILE - 0.5, v = wy / TILE - 0.5;
    if (this.bil(this.land, u, v) + (n0 - 0.5) * 0.42 < 0.5) return G.WATER;
    if (this.bil(this.grass, u, v) + (n1 - 0.5) * 0.5 < 0.5) return G.SAND;
    if (this.bil(this.ind[T.MOUNTAIN], u, v) + (n2 - 0.5) * 0.36 > 0.5) return G.MOUNTAIN;
    if (this.bil(this.ind[T.FOREST], u, v) + (n2 - 0.5) * 0.4 > 0.5) return G.FOREST;
    if (this.bil(this.ind[T.HILL], u, v) + (n1 - 0.5) * 0.3 > 0.5) return G.HILL;
    if (this.bil(this.ind[T.ROAD], u, v) + (n1 - 0.5) * 0.14 > 0.44) return G.ROAD;
    if (this.bil(this.richSoft, u, v) + (n2 - 0.5) * 0.4 > 0.42) return G.RICH;
    return G.GRASS;
  }

  /** Paint a chunk of S × S world pixels whose top-left is world pixel (ox, oy). */
  paint(ox: number, oy: number, S: number): Painted {
    const H = S + BELOW, seed = this.seed;
    const cls = new Uint8Array(S * H);
    const col = new Uint8Array(S * H);
    // per-pixel scalars: closeness to land (water/sand), field value at the edge (rims), height (hills, mountains)
    const val = new Float32Array(S * H);
    // noise on a 4 px lattice, read bilinearly (smooth enough at these scales, and 16× cheaper)
    const NS = 4, NW = S / NS + 2, NH = Math.ceil(H / NS) + 2;
    const lat = (s: number) => {
      const a = new Float32Array(NW * NH);
      for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) a[j * NW + i] = chan(ox + i * NS, oy + j * NS, s);
      return a;
    };
    const L0 = lat(seed + 1), L1 = lat(seed + 2), L2 = lat(seed + 3);
    const LM = new Float32Array(NW * NH);
    for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) LM[j * NW + i] = meadow(ox + i * NS, oy + j * NS, seed);
    const nz = (a: Float32Array, x: number, y: number) => {
      const i = x >> 2, j = y >> 2, fx = (x & 3) / NS, fy = (y & 3) / NS, k = j * NW + i;
      const p = a[k], q = a[k + 1], r = a[k + NW], s = a[k + NW + 1];
      return p + (q - p) * fx + (r - p) * fy + (p - q - r + s) * fx * fy;
    };
    const land = this.land, grass = this.grass, ind = this.ind;
    const shoreN: number[] = [], shoreK: number[] = [], glints: number[] = [];
    const farmCache = new Map<number, boolean>();

    // ---- pass 1: classify and color each pixel
    for (let y = 0; y < H; y++) {
      const wy = oy + y, v = wy / TILE - 0.5;
      for (let x = 0; x < S; x++) {
        const wx = ox + x, u = wx / TILE - 0.5, p = y * S + x;
        const n0 = nz(L0, x, y), n1 = nz(L1, x, y), n2 = nz(L2, x, y);
        const L = this.bil(land, u, v) + (n0 - 0.5) * 0.42;
        if (L < 0.5) {
          // ---- water, shaded by depth
          const d = Math.max(0, this.bil(this.shoreDist, u, v) - 0.5 + (n1 - 0.5) * 0.7);
          let band = 0;
          while (band < DEPTHS.length && d > DEPTHS[band] + (bayer(wx, wy) - 0.5) * 0.5) band++;
          let c: number = WATER_C[band];
          // short glints that drift row to row on open water
          if (band > 0 && hash2(Math.floor((wx + (wy >> 2) * 3) / 3), wy, 911) < 0.012) c = WATER_C[band - 1];
          // a foam rim where it laps the sand, and a lighter wash just off it
          if (L > 0.47) c = C.ice;
          else if (L > 0.43 && bayer(wx, wy) < (L - 0.43) / 0.04) c = C.sky;
          cls[p] = d > 3 ? G.DEEP : G.WATER;
          col[p] = c;
          val[p] = L;
          if (y < S) {
            if (L > 0.26) { shoreN.push(p); shoreK.push(Math.round(((L - 0.26) / 0.24) * 255)); }
            else if (band >= 1 && hash2(wx, wy, 313) < 0.0008) glints.push(p);
          }
          continue;
        }
        const Gv = this.bil(grass, u, v) + (n1 - 0.5) * 0.5;
        if (Gv < 0.5) {
          // ---- sand: wet at the waterline, dry speckles and pebbles inland
          cls[p] = G.SAND;
          val[p] = L;
          const h = hash2(wx, wy, 517);
          let c: number = C.taupe;
          if (L < 0.535 || (L < 0.57 && bayer(wx, wy) < (0.57 - L) / 0.035)) c = C.dust;
          else if (h < 0.035) c = C.straw;
          else if (h < 0.06) c = C.dust;
          else if (h < 0.063) c = C.pebble;
          col[p] = c;
          continue;
        }
        // ---- land on top of grass: the highest field over its threshold wins
        const fm = this.bil(ind[T.MOUNTAIN], u, v) + (n2 - 0.5) * 0.36;
        if (fm > 0.5) {
          // every mountain cell is solid rock (the peaks stand on it), so a range reads as a wall
          cls[p] = G.MOUNTAIN;
          // height: tiles in from the foot, plus craggy ridges
          const ridge = 1 - Math.abs(valueNoise(wx / 22, wy / 22, seed + 60) * 2 - 1);
          val[p] = this.bil(this.mDepth, u, v) + (n2 - 0.5) * 1.1 + ridge * 0.5;
          // light from the north-west: the slope of the depth field plus the ridges' own
          const e = 0.07;
          const gx = this.bil(this.mDepth, u + e, v) - this.bil(this.mDepth, u - e, v);
          const gy = this.bil(this.mDepth, u, v + e) - this.bil(this.mDepth, u, v - e);
          const r2 = valueNoise((wx + 3) / 22, (wy + 3) / 22, seed + 60);
          const lit = -(gx + gy) * 2.2 + (Math.abs(r2 * 2 - 1) - Math.abs(valueNoise(wx / 22, wy / 22, seed + 60) * 2 - 1)) * 5;
          const snowy = val[p] > 2.1 + (n1 - 0.5) * 0.8;
          const ramp = snowy ? SNOW : ROCK;
          let k = snowy ? 1 : 3;
          const t = lit + (bayer(wx, wy) - 0.5) * 0.5;
          if (t > 0.35) k++;
          if (t < -0.35) k--;
          if (t < -1.1) k--;
          k = Math.max(0, Math.min(ramp.length - 1, k));
          let rc = ramp[k];
          if (!snowy) {
            // loose stones (lit top left, dark bottom right) and dark cracks, so bare rock never reads as a flat slab
            const hs = hash2(wx >> 1, wy >> 1, 575);
            if (hs < 0.14) rc = !(wx & 1) && !(wy & 1) ? C.pebble : (wx & 1) && (wy & 1) ? C.plum : C.stone;
            else if (Math.abs(valueNoise(wx / 9, wy / 13, seed + 62) - 0.5) < 0.025) rc = C.plum;
          }
          col[p] = rc;
          continue;
        }
        const ff = this.bil(ind[T.FOREST], u, v) + (n2 - 0.5) * 0.4;
        if (ff > 0.5) {
          cls[p] = G.FOREST;
          // the floor shows only between trunks and where no tree may stand: lush grass, shadier inside
          const cl = clumpAt(wx, wy, 0.45, 0);
          col[p] = cl >= 0 ? cl : hash2(wx, wy, 519) < Math.min(0.5, (ff - 0.5) * 1.5) ? C.sage : C.celadon;
          continue;
        }
        const fh = this.bil(ind[T.HILL], u, v) + (n1 - 0.5) * 0.3;
        if (fh > 0.5) {
          cls[p] = G.HILL;
          // rounded mounds: shade the softened hill field (and a little noise) from the north-west
          const e = 0.09, hs = this.hillSoft;
          const gx = this.bil(hs, u + e, v) - this.bil(hs, u - e, v);
          const gy = this.bil(hs, u, v + e) - this.bil(hs, u, v - e);
          const t = -(gx + gy * 1.3) * 5 + (n1 - 0.5) * 0.5;
          // a pale, dry plateau (so hills stand out from the meadows), its slopes shaded
          let c: number = C.straw;
          if (fh < 0.53) c = C.sage;
          else if (t < -0.45 - bayer(wx, wy) * 0.3) c = C.sage;
          else if (t < -0.12 - bayer(wx, wy) * 0.3) c = C.celadon;
          else { const cl = clumpAt(wx, wy, 0.22, 1); if (cl >= 0) c = cl === C.straw ? C.khaki : C.celadon; }
          col[p] = c;
          val[p] = fh;
          continue;
        }
        const fr = this.bil(ind[T.ROAD], u, v) + (n1 - 0.5) * 0.14;
        if (fr > 0.44) {
          cls[p] = G.ROAD;
          col[p] = roadAt(wx, wy, fr, this.bil(ind[T.ROAD], u, v - 2 / TILE) + (n1 - 0.5) * 0.14);
          continue;
        }
        const fc = this.bil(this.richSoft, u, v) + (n2 - 0.5) * 0.4;
        if (fc > 0.42) {
          cls[p] = G.RICH;
          col[p] = richAt(wx, wy, fc);
          continue;
        }
        // ---- scree: stones strewn over the grass at the foot of a range
        cls[p] = G.GRASS;
        if (fm > 0.36) {
          const hs = hash2(wx >> 1, wy >> 1, 531), stony = (fm - 0.36) * 2.6;
          if (hs < stony) { col[p] = (wy & 1) ? (hs < stony * 0.5 ? C.slate : C.stone) : hs < stony * 0.4 ? C.stone : C.pebble; continue; }
        }
        // ---- farmland: fields in a ring around each city (./farmland.ts)
        if (Gv > 0.56 && ff < 0.35 && fr < 0.4 && !this.clearAt(wx, wy) && this.cityDist[Math.min(this.h - 1, Math.max(0, Math.floor(wy / TILE))) * this.w + Math.min(this.w - 1, Math.max(0, Math.floor(wx / TILE)))] < FARM_RING[1] + 5 * RING_PER_LEVEL + 1) {
          const pl = plotAt(wx, wy), key = pl.py * 100000 + pl.px;
          let on = farmCache.get(key);
          if (on === undefined) farmCache.set(key, (on = farmed(pl, this.map)));
          if (on) {
            const fc2 = cropPixel(pl, wx, wy);
            if (fc2 >= 0) { col[p] = fc2; continue; }
          }
        }
        // ---- grass: meadows, tufts, flowers, darker under forest edges and beside roads
        const m = nz(LM, x, y);
        let lush = m < 0.42 ? (0.42 - m) * 0.9 : 0;
        const dry = m > 0.6 ? (m - 0.6) * 1.3 : 0;
        if (ff > 0.3) lush += (ff - 0.3) * 1.6;
        if (fr > 0.36) lush += 0.45;
        if (fh > 0.34) lush += (fh - 0.34) * 0.8;
        let c: number = C.celadon;
        if (Gv < 0.53) c = C.sage;
        else {
          // grass clumps (dark blades with sunlit tips), thicker in lush meadows; pale dry tufts in dry ones
          const patch = 0.35 + n0 * 1.3;
          const cl = clumpAt(wx, wy, (0.07 + lush * 1.2) * patch, 0);
          const dl = cl < 0 && dry > 0.03 ? clumpAt(wx + 4, wy + 3, dry * 0.9, 1) : -1;
          if (cl >= 0) c = cl;
          else if (dl >= 0) c = dl;
          else if (bladeAt(wx, wy, 0.012 + lush * 0.05)) c = C.sage;
          else if (dry > 0.05 && bladeAt(wx + 1, wy, dry * 0.06)) c = C.straw;
          else {
            const f = flowerAt(wx, wy, m);
            if (f >= 0) c = f;
          }
        }
        col[p] = c;
      }
    }

    // ---- pass 2: south faces. A pixel of higher ground with lower ground just below it shows a
    // face: mountains a cliff, hills a shaded bank, grass a dirt lip over sand.
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const p = y * S + x, c = cls[p];
        if (c === G.MOUNTAIN) {
          let k = 0;
          while (k < CLIFF && y + k + 1 < H && cls[p + (k + 1) * S] === G.MOUNTAIN) k++;
          if (k >= CLIFF) continue;
          // k = rows of mountain left below this pixel: 0 is the foot of the cliff
          const wx = ox + x, streak = hash2(wx, 0, 529) < 0.35 ? 1 : 0;
          col[p] = k === 0 ? C.ink : k < 3 ? C.plum : k < 7 ? (streak ? C.plum : C.slate) : streak ? C.slate : C.mauve;
        } else if (c === G.HILL) {
          // the hill's shaded south slope: denser toward its foot
          let k = 0;
          while (k < HILL_BANK && y + k + 1 < H && cls[p + (k + 1) * S] === G.HILL) k++;
          if (k < HILL_BANK) col[p] = k === 0 ? C.fern : C.sage;
        } else if (c >= G.GRASS && c !== G.MOUNTAIN) {
          for (let k = 1; k <= GRASS_BANK; k++) {
            const below = cls[p + k * S];
            if (y + k < H && below === G.SAND) { col[p] = k === 1 ? C.dust : C.olive; break; }
          }
        } else if (c === G.SAND && y + 1 < H && cls[p + S] <= G.WATER) {
          col[p] = C.dust;
        }
      }
    // a soft contact shadow on the ground at the foot of each cliff
    for (let y = 1; y < S; y++)
      for (let x = 0; x < S; x++) {
        const p = y * S + x;
        if (cls[p] !== G.MOUNTAIN && cls[p - S] === G.MOUNTAIN && cls[p] >= G.SAND && (x + y) % 2 === 0) col[p] = cls[p] === G.SAND ? C.dust : C.fern;
      }

    // ---- bridges: a plank deck between stone parapets, its stone face and shadow on the water
    const deck = this.bridges(ox, oy, S, H, cls, col);
    if (deck) {
      // no waves or glints over the deck
      const keepS: number[] = [], keepK: number[] = [];
      shoreN.forEach((p, i) => { if (!deck[p]) { keepS.push(p); keepK.push(shoreK[i]); } });
      shoreN.length = 0; shoreN.push(...keepS);
      shoreK.length = 0; shoreK.push(...keepK);
      const g2 = glints.filter((p) => !deck[p]);
      glints.length = 0; glints.push(...g2);
    }

    // ---- to RGBA
    const img = new ImageData(S, S);
    const d = img.data;
    for (let p = 0; p < S * S; p++) {
      const rgb = PALETTE_RGB[col[p]];
      d[p * 4] = rgb[0]; d[p * 4 + 1] = rgb[1]; d[p * 4 + 2] = rgb[2]; d[p * 4 + 3] = 255;
    }
    return {
      img, shore: Uint32Array.from(shoreN), shoreK: Uint8Array.from(shoreK), glints: Uint32Array.from(glints),
      sprites: this.scatter(ox, oy, S),
    };
  }

  /**
   * Paint the river bridges over this chunk. Returns a mask of the pixels they cover (deck, face
   * and shadow), or null when no bridge reaches the chunk.
   */
  private bridges(ox: number, oy: number, S: number, H: number, cls: Uint8Array, col: Uint8Array): Uint8Array | null {
    const list = this.map.bridges;
    if (!list?.length) return null;
    let mask: Uint8Array | null = null;
    const FACE = 6, SHADOW = 4, WALL = 5, RAMP = 14;
    for (const b of list) {
      const x0 = b.x0 * TILE, y0 = b.y0 * TILE, x1 = b.x1 * TILE, y1 = b.y1 * TILE;
      const len = Math.hypot(x1 - x0, y1 - y0), half = (b.w * TILE) / 2;
      const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
      const pad = half + FACE + SHADOW + 2;
      if (Math.max(x0, x1) + pad < ox || Math.min(x0, x1) - pad > ox + S || Math.max(y0, y1) + pad < oy || Math.min(y0, y1) - pad > oy + H) continue;
      // along (px from the first end) and across (px from the center line) at a world pixel
      const on = (wx: number, wy: number): [number, number] | null => {
        const px = wx + 0.5 - x0, py = wy + 0.5 - y0;
        const a = px * ux + py * uy, c = px * -uy + py * ux;
        return a >= 0 && a <= len && Math.abs(c) <= half ? [a, c] : null;
      };
      mask ??= new Uint8Array(S * H);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < S; x++) {
          const wx = ox + x, wy = oy + y, p = y * S + x;
          const hit = on(wx, wy);
          if (hit) {
            const [a, c] = hit;
            const edge = half - Math.abs(c), end = Math.min(a, len - a);
            // the ends run out onto the banks and fade into the road there
            if (end < RAMP && bayer(wx, wy) > end / RAMP) continue;
            const walled = end > RAMP + 2;
            let k: number;
            if (walled && edge < 1) k = C.ink;
            else if (walled && edge < WALL) {
              // stone parapets: blocks with mortar joints, lit on the outer course
              const course = edge < 3 ? 0 : 1, joint = (a + course * 5) % 10 < 1;
              k = joint ? C.slate : course === 0 ? C.pebble : C.stone;
            } else if (walled && edge < WALL + 1) k = C.ink;
            else {
              // cobbles: rows across the deck, each stone lit top-left, joints between them
              const row = Math.floor(a / 5), ra = a - row * 5;
              const cc = c + half + (row % 2) * 4, col8 = Math.floor(cc / 8), rc = cc - col8 * 8;
              const h = hash2(row, col8, 647);
              k = ra < 1 || rc < 1 ? C.slate : ra < 2 || rc < 2 ? C.pebble : h < 0.2 ? C.slate : h > 0.9 ? C.pebble : C.stone;
              // worn smooth where the wheels run
              if (k !== C.slate && Math.abs(Math.abs(c) - half * 0.4) < 2.5 && hash2(wx, wy, 649) < 0.5) k = C.stone;
            }
            col[p] = k;
            cls[p] = G.ROAD;
            mask[p] = 1;
            continue;
          }
          // below the deck (¾ view): its stone face, then its shadow on the water (light from the north-west)
          if (cls[p] > G.WATER) continue;
          for (let k = 1; k <= FACE + SHADOW; k++) {
            if (on(wx, wy - k)) {
              if (k <= FACE) col[p] = k <= 3 ? C.slate : k < FACE ? C.plum : C.ink;
              else col[p] = bayer(wx, wy) < 0.6 ? C.navy : C.dusk;
              mask[p] = 1;
              break;
            }
            if (k <= SHADOW + 2 && on(wx - k, wy - Math.floor(k / 2))) {
              col[p] = k === 1 ? C.ink : bayer(wx, wy) < 0.7 ? C.navy : C.dusk;
              mask[p] = 1;
              break;
            }
          }
        }
    }
    return mask;
  }

  /**
   * May this tree or peak stand with its anchor at this world pixel? Nothing of it (its whole
   * opaque box, crown included) may cover a road, a city, a deposit or a starting base.
   */
  private canStand(s: Sprite, wx: number, wy: number): boolean {
    const b = this.boxes.get(s) ?? [-8, -24, 8, 0];
    const road = this.ind[T.ROAD];
    for (let y = wy + b[1]; y <= wy + b[3]; y += 6)
      for (let x = wx + b[0]; x <= wx + b[2]; x += 6) {
        const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
        if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h || this.clear[ty * this.w + tx]) return false;
        if (this.bil(road, x / TILE - 0.5, y / TILE - 0.5) > 0.4) return false;
      }
    // and its foot stays on the land it grows from, not out over the beach
    for (const dx of [b[0], 0, b[2]]) if (this.bil(this.grass, (wx + dx) / TILE - 0.5, (wy + b[3]) / TILE - 0.5) < 0.6) return false;
    return true;
  }

  /** Does any baked tree or peak cover part of this world-pixel box? */
  blocks(x0: number, y0: number, x1: number, y1: number): boolean {
    // (the scatter of a region a little bigger than the box: crowns reach in from below and the sides)
    const ox = Math.floor(x0) - 2, oy = Math.floor(y0) - 2, S = Math.ceil(Math.max(x1 - x0, y1 - y0)) + 4;
    for (const [s, x, y] of this.scatter(ox, oy, S)) {
      const b = this.boxes.get(s);
      if (!b) continue;
      const bx0 = ox + x + b[0] + 2, by0 = oy + y + b[1] + 2, bx1 = ox + x + b[2] - 2, by1 = oy + y + b[3] - 2;
      if (bx0 < x1 && x0 < bx1 && by0 < y1 && y0 < by1) return true;
    }
    return false;
  }

  /** Trees packed into forests and peaks on the high ground, overlapping into this chunk, in y order. */
  private scatter(ox: number, oy: number, S: number): [Sprite, number, number][] {
    const out: [Sprite, number, number, number][] = [];
    const seed = this.seed;
    // trees: a jittered grid; anything whose sprite could reach the chunk
    const SP = 11, padX = 28, padTop = 8, padBottom = 48;
    const { d: dec, c: con } = this.trees;
    if (dec.length || con.length)
      for (let gy = Math.floor((oy - padTop) / SP); gy <= Math.floor((oy + S + padBottom) / SP); gy++)
        for (let gx = Math.floor((ox - padX) / SP); gx <= Math.floor((ox + S + padX) / SP); gx++) {
          const wx = Math.floor(gx * SP + hash2(gx, gy, seed + 701) * SP), wy = Math.floor(gy * SP + hash2(gx, gy, seed + 702) * SP);
          const n2 = chan(wx, wy, seed + 3);
          const u = wx / TILE - 0.5, v = wy / TILE - 0.5;
          const ff = this.bil(this.ind[T.FOREST], u, v) + (n2 - 0.5) * 0.4;
          if (ff < 0.5) continue;
          // thinner at the edge, so the forest frays into the meadow
          if (ff < 0.62 && hash2(gx, gy, seed + 703) < 0.45) continue;
          const k = this.classAt(wx, wy, chan(wx, wy, seed + 1), chan(wx, wy, seed + 2), n2);
          if (k !== G.FOREST && k !== G.GRASS && k !== G.HILL) continue;
          // stands of conifers and of broadleaves, conifers more likely by the mountains
          const pine = valueNoise(wx / 230, wy / 230, seed + 77) + this.bil(this.ind[T.MOUNTAIN], u, v) * 0.6 > 0.62;
          const list = (pine && con.length) || !dec.length ? con : dec;
          const s = list[Math.floor(hash2(gx, gy, seed + 704) * list.length)];
          if (!this.canStand(s, wx, wy)) continue;
          out.push([s, wx - ox, wy - oy, wy]);
        }
    // peaks: a coarser jittered grid on the heart of each range
    const PS = 12;
    if (this.peaks.snow.length || this.peaks.rock.length)
      for (let gy = Math.floor((oy - 16) / PS); gy <= Math.floor((oy + S + 80) / PS); gy++)
        for (let gx = Math.floor((ox - 48) / PS); gx <= Math.floor((ox + S + 48) / PS); gx++) {
          const wx = Math.floor(gx * PS + hash2(gx, gy, seed + 711) * PS), wy = Math.floor(gy * PS + hash2(gx, gy, seed + 712) * PS);
          const md = this.bil(this.mDepth, wx / TILE - 0.5, wy / TILE - 0.5);
          if (md < 0.4) continue;
          // snow caps only on the heart of a big range; bare rock on its flanks and on thin ridges
          const snowy = (md > 1.05 || hash2(gx, gy, seed + 716) < 0.3) && this.peaks.snow.length;
          const list = snowy || !this.peaks.rock.length ? this.peaks.snow : this.peaks.rock;
          const s = list[Math.floor(hash2(gx, gy, seed + 714) * list.length)];
          if (!this.canStand(s, wx, wy)) continue;
          out.push([s, wx - ox, wy - oy, wy]);
        }
    out.sort((a, b) => a[3] - b[3]);
    return out.map(([s, x, y]) => [s, x, y]);
  }
}

/** Chamfer distance (in tiles, capped) from the tiles where `src` holds; 0 on them. */
function distance(w: number, h: number, src: (i: number) => boolean, cap: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = src(i) ? 0 : cap;
  const D = Math.SQRT2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) d[i] = Math.min(d[i], d[i - 1] + 1);
      if (y > 0) {
        d[i] = Math.min(d[i], d[i - w] + 1);
        if (x > 0) d[i] = Math.min(d[i], d[i - w - 1] + D);
        if (x < w - 1) d[i] = Math.min(d[i], d[i - w + 1] + D);
      }
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) d[i] = Math.min(d[i], d[i + 1] + 1);
      if (y < h - 1) {
        d[i] = Math.min(d[i], d[i + w] + 1);
        if (x < w - 1) d[i] = Math.min(d[i], d[i + w + 1] + D);
        if (x > 0) d[i] = Math.min(d[i], d[i + w - 1] + D);
      }
    }
  return d;
}

/** 3×3 box blur of a tile field. */
function blur(f: Float32Array, w: number, h: number): Float32Array {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += f[yy * w + xx];
          n++;
        }
      o[y * w + x] = s / n;
    }
  return o;
}

/**
 * Rich-ore ground: dark earth strewn with rocks and glinting ore chunks (2×2, lit at the top
 * left), with a dark rim. `fc` is the rich field (0.42 at the rim).
 */
function richAt(wx: number, wy: number, fc: number): number {
  if (fc < 0.47) return fc < 0.445 ? C.plum : C.slate;
  const hs = hash2(wx >> 1, wy >> 1, 571), lit = !(wx & 1) && !(wy & 1), dark = (wx & 1) && (wy & 1);
  if (hs < 0.07) return lit ? C.gold : dark ? C.copper : C.amber;
  if (hs < 0.2) return lit ? C.pebble : dark ? C.slate : C.stone;
  return hash2(wx, wy, 573) < 0.3 ? C.mauve : C.dust;
}

/**
 * A dirt road: wheel ruts worn along both sides of a grassy crown, pebbles, a frayed edge where it
 * meets the grass, and a shaded north edge (the track is sunk a little below the turf). `fr` is
 * the road field here (about 1 on the middle of the track, 0.44 at its edge), `above` the field
 * 2 px further north.
 */
function roadAt(wx: number, wy: number, fr: number, above: number): number {
  const h = hash2(wx, wy, 523);
  // frayed edge: grass tufts hang over the dirt, which shows through between them
  if (fr < 0.5) {
    const cl = clumpAt(wx, wy, 0.75, 0);
    if (cl >= 0) return cl;
    return bayer(wx, wy) < (0.5 - fr) / 0.06 ? C.celadon : C.dust;
  }
  // the north bank's shadow on the track
  if (above < 0.45) return C.dust;
  // ruts: two darker bands where the field is about 0.7, with dark pits in them
  if (Math.abs(fr - 0.68) < 0.02) return h < 0.5 ? C.olive : C.dust;
  // a grassy crown down the middle of the track
  if (fr > 0.93 && clumpAt(wx, wy, 0.35, 0) >= 0) return C.sage;
  // a little grit, and pebbles with their shadow under them
  if (h < 0.03) return C.dust;
  if (h < 0.045) return C.straw;
  const pb = hash2(wx >> 1, (wy - 1) >> 1, 557);
  if (pb < 0.012) return (wy & 1) ? C.stone : C.pebble;
  return C.taupe;
}

/**
 * A grass clump: a few blades on a 5×4 cell grid, placed by hash; dark blades with sunlit tips
 * (kind 0) or pale dry ones (kind 1). Returns a palette index or -1.
 */
function clumpAt(wx: number, wy: number, density: number, kind: number): number {
  const cx = Math.floor(wx / 5), cy = Math.floor(wy / 4);
  if (hash2(cx, cy, 71 + kind * 10) >= density) return -1;
  const ax = cx * 5 + Math.floor(hash2(cx, cy, 72) * 2), ay = cy * 4 + Math.floor(hash2(cx, cy, 73) * 2);
  const dx = wx - ax, dy = wy - ay;
  // rows from the top:   .t.t
  //                      bbtb
  //                      .bb.
  const tip = (dy === 0 && (dx === 1 || dx === 3)) || (dy === 1 && dx === 2);
  const blade = (dy === 1 && (dx === 0 || dx === 1 || dx === 3)) || (dy === 2 && (dx === 1 || dx === 2));
  if (kind === 1) return tip ? C.straw : blade ? (dy === 2 ? C.sage : C.straw) : -1;
  return tip ? C.straw : blade ? C.sage : -1;
}

/** A single blade: a 1×2 vertical stroke (so the fine texture reads as grass, not dust). */
function bladeAt(wx: number, wy: number, density: number): boolean {
  return hash2(wx, (wy + (wx & 1)) >> 1, 551) < density;
}

/**
 * A grass tuft: a little 'v' of three pixels, at most one per 6x6 cell, placed by hash. Meadows
 * (slow noise) get more of them.
 */
function tuftAt(wx: number, wy: number, density: number): boolean {
  const cx = Math.floor(wx / 6), cy = Math.floor(wy / 6);
  const meadowN = valueNoise(cx / 20, cy / 20, 33);
  if (hash2(cx, cy, 61) >= density * (0.4 + meadowN * 1.4)) return false;
  const ax = cx * 6 + Math.floor(hash2(cx, cy, 62) * 3), ay = cy * 6 + Math.floor(hash2(cx, cy, 63) * 4);
  const dx = wx - ax, dy = wy - ay;
  return (dy === 0 && (dx === 0 || dx === 2)) || (dy === 1 && dx === 1);
}

/** Wildflowers: little clusters in the middling meadows (palette index, or -1). */
function flowerAt(wx: number, wy: number, m: number): number {
  const cx = Math.floor(wx / 9), cy = Math.floor(wy / 9);
  const want = m > 0.42 && m < 0.64 ? Math.max(0, valueNoise(cx / 7, cy / 7, 91) - 0.45) * 0.5 : 0.004;
  if (hash2(cx, cy, 81) >= want) return -1;
  const ax = cx * 9 + 2 + Math.floor(hash2(cx, cy, 82) * 5), ay = cy * 9 + 2 + Math.floor(hash2(cx, cy, 83) * 5);
  const dx = wx - ax, dy = wy - ay;
  // a little clump: five blooms around a point
  const on = (dx === 0 && dy === 0) || (dx === 2 && dy === 1) || (dx === -1 && dy === 2) || (dx === 1 && dy === -2) || (dx === -2 && dy === 0 && hash2(cx, cy, 84) < 0.6);
  return on ? FLOWERS[Math.floor(hash2(cx, cy, 85) * FLOWERS.length)] : -1;
}
