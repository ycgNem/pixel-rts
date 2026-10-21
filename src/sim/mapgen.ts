// Seeded map generator (GAME_DESIGN §3). The same setup always gives the same map, so clients
// rebuild the map from the setup instead of receiving it over the network.
import { T, TERRAIN } from '../data/terrain';
import { MAPGEN, MAP_SIZES } from '../data/rules';
import { CITY_NAMES } from '../data/cities';
import { BUILDINGS } from '../data/buildings';
import type { Bridge, CitySeed, Deposit, GameMap, MatchSetup } from './types';
import { fbm, hashStr, rand, randInt, shuffle, type RngHolder } from './rng';
import { Heap } from './heap';

const HQ = BUILDINGS.hq;

export function generateMap(setup: MatchSetup): GameMap {
  const size = MAP_SIZES[setup.mapSize];
  const w = size, h = size;
  const n = Math.max(1, setup.players.length);
  const seed = setup.seed >>> 0;
  const R: RngHolder = { rng: (seed ^ 0x5eed1234) >>> 0 };
  const type = setup.mapType;
  const terrain = new Array<number>(w * h).fill(T.GRASS);
  const idx = (x: number, y: number) => y * w + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;

  // ---- 1. height field
  const scale = { pangaea: 46, continents: 34, islands: 17, lakes: 26 }[type];
  const fall = { pangaea: 0.6, continents: 0.42, islands: 0.25, lakes: 0.3 }[type];
  const height = new Float64Array(w * h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const wx = x + (fbm(x / 40, y / 40, seed + 7, 3) - 0.5) * 24;
      const wy = y + (fbm(x / 40, y / 40, seed + 13, 3) - 0.5) * 24;
      let v = fbm(wx / scale, wy / scale, seed, 5);
      const d = Math.hypot(x - cx, y - cy) / (size / 2);
      v -= type === 'lakes' ? fall * d ** 6 : fall * d * d;
      // keep a water rim on every map except lakes
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (type !== 'lakes' && edge < 4) v -= (4 - edge) * 0.15;
      height[idx(x, y)] = v;
    }
  const sorted = Float64Array.from(height).sort();
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
  const landFrac = MAPGEN.land[type];
  const sea = pct(1 - landFrac);
  const deep = pct((1 - landFrac) * 0.55);
  for (let i = 0; i < w * h; i++) terrain[i] = height[i] < deep ? T.DEEP : height[i] < sea ? T.WATER : T.GRASS;

  // ---- 1b. islands and continents: every start on its own landmass, around a neutral middle
  const angle0 = rand(R) * Math.PI * 2;
  const ring = size * (n <= 2 ? 0.36 : 0.37);
  const ringAt = (i: number) => {
    const a = angle0 + (i * Math.PI * 2) / n;
    return { x: Math.round(cx + Math.cos(a) * ring), y: Math.round(cy + Math.sin(a) * ring) };
  };
  const sep = n > 1 ? MAPGEN.separate[type] : undefined;
  if (sep) separateLands(sep);
  // mountains and hills follow ridged noise so they form ranges, not one blob at the highest point
  const ridge = new Float64Array(w * h);
  const landScores: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (terrain[i] !== T.GRASS) continue;
      const r = 1 - Math.abs(2 * fbm(x / 22, y / 22, seed + 55, 4) - 1);
      ridge[i] = r * 0.75 + Math.min(1, (height[i] - sea) * 4) * 0.25;
      landScores.push(ridge[i]);
    }
  landScores.sort((a, b) => a - b);
  const at = (p: number) => landScores[Math.min(landScores.length - 1, Math.floor(p * landScores.length))] ?? 2;
  const mountain = at(1 - MAPGEN.mountains), hill = at(1 - MAPGEN.mountains - MAPGEN.hills);
  for (let i = 0; i < w * h; i++) if (terrain[i] === T.GRASS) terrain[i] = ridge[i] >= mountain ? T.MOUNTAIN : ridge[i] >= hill ? T.HILL : T.GRASS;
  // forests: a second noise over plains
  const forestNoise = new Float64Array(w * h);
  const plains: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (terrain[i] !== T.GRASS) continue;
      forestNoise[i] = fbm(x / 11, y / 11, seed + 99, 4);
      plains.push(forestNoise[i]);
    }
  plains.sort((a, b) => a - b);
  const forestCut = plains[Math.floor(plains.length * (1 - MAPGEN.forest / (1 - MAPGEN.mountains - MAPGEN.hills)))] ?? 1;
  for (let i = 0; i < w * h; i++) if (terrain[i] === T.GRASS && forestNoise[i] > forestCut) terrain[i] = T.FOREST;

  const bridges: Bridge[] = [];
  const isLand = (i: number) => terrain[i] !== T.WATER && terrain[i] !== T.DEEP && terrain[i] !== T.BRIDGE;
  const stamp = (x0: number, y0: number, r: number, to: number, only?: (t: number) => boolean) => {
    for (let y = Math.floor(y0 - r); y <= Math.ceil(y0 + r); y++)
      for (let x = Math.floor(x0 - r); x <= Math.ceil(x0 + r); x++) {
        if (!inside(x, y) || Math.hypot(x - x0, y - y0) > r) continue;
        const i = idx(x, y);
        if (!only || only(terrain[i])) terrain[i] = to;
      }
  };

  // ---- 1c. a river with two bridges across the land-war maps
  if (n > 1 && setup.river !== false && MAPGEN.river.on.includes(type)) carveRiver();

  // ---- 2. start positions on a ring, cleared and flattened
  const starts: { x: number; y: number }[] = [];
  const clear = MAPGEN.startClear;
  for (let i = 0; i < n; i++) {
    const origin = ringAt(i);
    let best = origin;
    // nudge toward the most land-rich spot near the ring point (separated maps already built land
    // there); candidates are measured from the ring point, so a start never drifts further
    let bestScore = -1;
    for (let r = 0; r <= (sep ? -1 : MAPGEN.startNudge); r += 2)
      for (let k = 0; k < 12; k++) {
        const bx = Math.round(origin.x + Math.cos((k / 12) * Math.PI * 2) * r);
        const by = Math.round(origin.y + Math.sin((k / 12) * Math.PI * 2) * r);
        if (!inside(bx, by)) continue;
        let land = 0;
        for (let yy = -clear; yy <= clear; yy += 3) for (let xx = -clear; xx <= clear; xx += 3) if (inside(bx + xx, by + yy) && isLand(idx(bx + xx, by + yy))) land++;
        const score = land - r * 0.2;
        if (score > bestScore) { bestScore = score; best = { x: bx, y: by }; }
        if (r === 0) break;
      }
    best.x = Math.max(clear + 2, Math.min(w - clear - 3, best.x));
    best.y = Math.max(clear + 2, Math.min(h - clear - 3, best.y));
    starts.push(best);
  }
  for (const s of starts) {
    stamp(s.x, s.y, clear + 2, T.GRASS, (t) => t === T.WATER || t === T.DEEP);
    stamp(s.x, s.y, clear, T.GRASS);
  }

  // make sure every start can walk to every other on maps meant for land wars
  if (type === 'pangaea' || type === 'lakes') connectStarts();

  // ---- 3. resources at each start, the same layout rotated toward the map center
  const deposits: Deposit[] = [];
  const cities: CitySeed[] = [];
  const names = shuffle(R, [...CITY_NAMES]);
  const footprintFree = (x: number, y: number, fw: number, fh: number, pad = 0) => {
    for (let yy = y - pad; yy < y + fh + pad; yy++)
      for (let xx = x - pad; xx < x + fw + pad; xx++) {
        if (!inside(xx, yy)) return false;
        const t = terrain[idx(xx, yy)];
        if (!TERRAIN[t].buildable && t !== T.FOREST) return false;
      }
    for (const d of deposits) if (d.x < x + fw + 1 && d.x + 2 > x - 1 && d.y < y + fh + 1 && d.y + 2 > y - 1) return false;
    for (const c of cities) if (Math.hypot(c.x - (x + fw / 2), c.y - (y + fh / 2)) < 4) return false;
    for (const s of starts) {
      const hx = s.x - HQ.w / 2, hy = s.y - HQ.h / 2;
      if (hx < x + fw + 1 && hx + HQ.w > x - 1 && hy < y + fh + 1 && hy + HQ.h > y - 1) return false;
    }
    return true;
  };
  const addDeposit = (kind: 'ore' | 'oil', x: number, y: number, rich = false) => {
    x = Math.round(x - 1);
    y = Math.round(y - 1);
    // search outward for a free 2x2 spot
    for (let r = 0; r < 8; r++)
      for (let k = 0; k < Math.max(1, r * 8); k++) {
        const a = (k / Math.max(1, r * 8)) * Math.PI * 2;
        const px = Math.round(x + Math.cos(a) * r), py = Math.round(y + Math.sin(a) * r);
        if (!footprintFree(px, py, 2, 2)) continue;
        for (let yy = py; yy < py + 2; yy++) for (let xx = px; xx < px + 2; xx++) terrain[idx(xx, yy)] = T.GRASS;
        deposits.push({ kind, x: px, y: py, ...(rich ? { rich: true } : {}) });
        return true;
      }
    return false;
  };
  const addCity = (x: number, y: number, level: number, minGap: number) => {
    x = Math.round(x);
    y = Math.round(y);
    for (let r = 0; r < 14; r++)
      for (let k = 0; k < Math.max(1, r * 8); k++) {
        const a = (k / Math.max(1, r * 8)) * Math.PI * 2;
        const px = Math.round(x + Math.cos(a) * r), py = Math.round(y + Math.sin(a) * r);
        if (px < 4 || py < 4 || px >= w - 4 || py >= h - 4) continue;
        let ok = true;
        for (let yy = -2; yy <= 2 && ok; yy++) for (let xx = -2; xx <= 2 && ok; xx++) if (!isLand(idx(px + xx, py + yy)) || terrain[idx(px + xx, py + yy)] === T.MOUNTAIN) ok = false;
        if (!ok) continue;
        if (cities.some((c) => Math.hypot(c.x - px, c.y - py) < minGap)) continue;
        if (starts.some((s) => Math.hypot(s.x - px, s.y - py) < 12)) continue;
        if (deposits.some((d) => Math.hypot(d.x + 1 - px, d.y + 1 - py) < 4)) continue;
        stamp(px, py, 2.6, T.GRASS, (t) => t !== T.WATER && t !== T.DEEP);
        cities.push({ x: px, y: py, level, name: names[cities.length % names.length], coastal: false });
        return true;
      }
    return false;
  };

  for (const s of starts) {
    const dir = Math.atan2(cy - s.y, cx - s.x);
    const at = (a: number, d: number) => [s.x + Math.cos(dir + a) * d, s.y + Math.sin(dir + a) * d] as const;
    addDeposit('ore', ...at(1.2, 6.5));
    addDeposit('ore', ...at(-1.2, 6.5));
    addDeposit('oil', ...at(Math.PI, 6.5));
  }
  for (const s of starts) {
    const dir = Math.atan2(cy - s.y, cx - s.x);
    const d = sep ? MAPGEN.homeCity.near : MAPGEN.homeCity.far;
    for (const a of [0.75, -0.75]) addCity(s.x + Math.cos(dir + a) * d, s.y + Math.sin(dir + a) * d, 1, 9);
  }

  // ---- 4. the capital in the middle, then neutral cities: the same pattern around every start,
  // rotated with it (fair starts), and random ones only if a slot can't be placed for everyone
  if (n > 1) addCity(cx, cy, 3, 10);
  const want = cities.length + MAPGEN.citiesPerPlayer * n;
  const spread = Math.min(MAPGEN.fairCities.maxAngle, Math.PI / Math.max(2, n));
  // each start's own slot cities (indexes into `cities`), the same slots in the same order
  const slotCities: number[][] = starts.map(() => []);
  for (let slot = 0, tries = 0; slot < MAPGEN.citiesPerPlayer && tries < MAPGEN.fairCities.tries; tries++) {
    const a = (rand(R) * 2 - 1) * spread;
    const d = MAPGEN.fairCities.minDist + rand(R) * Math.max(0, ring * MAPGEN.fairCities.maxShare - MAPGEN.fairCities.minDist);
    const before = cities.length;
    let ok = true;
    for (const s of starts) {
      const dir = Math.atan2(cy - s.y, cx - s.x);
      const x = s.x + Math.cos(dir + a) * d, y = s.y + Math.sin(dir + a) * d;
      const dc = Math.hypot(x - cx, y - cy) / (size / 2);
      const level = dc < 0.35 ? 2 : 1;
      if (!addCity(x, y, level, 13)) { ok = false; break; }
    }
    if (ok) {
      starts.forEach((_, i) => slotCities[i].push(before + i));
      slot++;
    } else cities.length = before;
  }
  for (let tries = 0; tries < 4000 && cities.length < want; tries++) {
    const x = randInt(R, 6, w - 7), y = randInt(R, 6, h - 7);
    if (!isLand(idx(x, y))) continue;
    if (starts.some((s) => Math.hypot(s.x - x, s.y - y) < 22)) continue;
    const d = Math.hypot(x - cx, y - cy) / (size / 2);
    const level = d < 0.35 ? 2 + (rand(R) < 0.4 ? 1 : 0) : d < 0.7 ? 1 + (rand(R) < 0.5 ? 1 : 0) : 1;
    addCity(x, y, level, 15);
  }

  // ---- 5. rich ore in the contested middle, and extra deposits near neutral cities
  for (let i = 0; i < MAPGEN.richOre * Math.max(1, Math.floor(n / 2)); i++) {
    const a = rand(R) * Math.PI * 2, d = 5 + rand(R) * size * 0.08;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    if (addDeposit('ore', x, y, true)) {
      const dep = deposits[deposits.length - 1];
      stamp(dep.x + 1, dep.y + 1, 2.4, T.RICH, (t) => t === T.GRASS || t === T.FOREST || t === T.HILL);
    }
  }
  // the same extra ore and oil for every start: beside its own slot cities, at the same angle
  // (turned with the start, like the cities); random spots only if a start has no slot cities
  for (let k = 0; k < MAPGEN.extraOre + MAPGEN.extraOil; k++) {
    const kind = k < MAPGEN.extraOre ? 'ore' : 'oil';
    const a = rand(R) * Math.PI * 2;
    starts.forEach((s, i) => {
      const list = slotCities[i];
      let x: number, y: number;
      if (list.length) {
        const c = cities[list[k % list.length]];
        const dir = Math.atan2(cy - s.y, cx - s.x);
        x = c.x + Math.cos(dir + a) * 6;
        y = c.y + Math.sin(dir + a) * 6;
      } else {
        x = randInt(R, 8, w - 9);
        y = randInt(R, 8, h - 9);
        if (!isLand(idx(x, y))) return;
      }
      if (starts.some((o) => Math.hypot(o.x - x, o.y - y) < 14)) return;
      addDeposit(kind, x, y);
    });
  }

  // ---- 6. roads between cities and starts
  buildRoads();

  // ---- 7. shores, then coastal flags
  const shore: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (!isLand(i) || terrain[i] === T.ROAD || terrain[i] === T.MOUNTAIN) continue;
      let wet = false;
      for (let yy = -1; yy <= 1 && !wet; yy++) for (let xx = -1; xx <= 1; xx++) if (inside(x + xx, y + yy) && !isLand(idx(x + xx, y + yy))) { wet = true; break; }
      if (wet) shore.push(i);
    }
  for (const i of shore) terrain[i] = T.SAND;
  for (const d of deposits) for (let yy = d.y; yy < d.y + 2; yy++) for (let xx = d.x; xx < d.x + 2; xx++) if (terrain[idx(xx, yy)] !== T.RICH) terrain[idx(xx, yy)] = T.GRASS;
  for (const c of cities) {
    let coastal = false;
    for (let yy = -4; yy <= 4 && !coastal; yy++) for (let xx = -4; xx <= 4; xx++) if (inside(c.x + xx, c.y + yy) && !isLand(idx(c.x + xx, c.y + yy))) { coastal = true; break; }
    c.coastal = coastal;
  }

  return { w, h, terrain, deposits, starts, cities, ...(bridges.length ? { bridges } : {}) };

  // ---- helpers that need the closure ----

  /**
   * The river: a curve from the map edge through the middle and out again, each half along the
   * gap between two neighbouring starts (opposite gaps when the player count is even, so it runs
   * straight), wandering a little. Two bridges cross it, the same distance from the middle.
   */
  function carveRiver() {
    const o = MAPGEN.river;
    const gap = Math.PI / n;
    const aA = angle0 + gap, aB = angle0 + gap + (Math.floor(n / 2) * 2 * Math.PI) / n;
    const far = size * 0.75;
    const A = { x: cx + Math.cos(aA) * far, y: cy + Math.sin(aA) * far };
    const B = { x: cx + Math.cos(aB) * far, y: cy + Math.sin(aB) * far };
    // a quadratic curve through the middle at t = 0.5
    const K = { x: 2 * cx - (A.x + B.x) / 2, y: 2 * cy - (A.y + B.y) / 2 };
    const steps = Math.ceil(far * 6);
    const pts: { x: number; y: number }[] = [];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, u = 1 - t;
      const x = u * u * A.x + 2 * t * u * K.x + t * t * B.x;
      const y = u * u * A.y + 2 * t * u * K.y + t * t * B.y;
      pts.push({ x, y });
    }
    // wander sideways (not at the very middle, so it stays fair), along the normal of the curve
    const out = pts.map((p, k) => {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
      const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / tl, ny = (b.x - a.x) / tl;
      const t = k / steps;
      const amp = o.meander * Math.min(1, Math.abs(t - 0.5) * 8);
      const m = ((fbm(t * 8, 0.5, seed + 811, 3) - 0.5) * 2.4 + (fbm(t * 26, 3.5, seed + 812, 2) - 0.5) * 0.9) * amp;
      return { x: p.x + nx * m, y: p.y + ny * m };
    });
    // a little wider here and there
    out.forEach((p, k) => stamp(p.x, p.y, o.width / 2 + (fbm(k / 40, 7.5, seed + 813, 2) > 0.55 ? 0.6 : 0), T.WATER, (t) => t !== T.DEEP));
    // the bridges: on each half, where the river is `bridgeAt` × size from the middle
    const D = size * o.bridgeAt;
    for (const half of [0, 1]) {
      let best = -1, bd = Infinity;
      for (let k = 12; k < out.length - 12; k++) {
        if ((k < steps / 2) !== (half === 0)) continue;
        const d = Math.abs(Math.hypot(out[k].x - cx, out[k].y - cy) - D);
        if (d < bd) { bd = d; best = k; }
      }
      if (best < 0) continue;
      // square to the river's general course here, not to its every wiggle
      const p = out[best], a = out[Math.max(0, best - 12)], b = out[Math.min(out.length - 1, best + 12)];
      const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / tl, ny = (b.x - a.x) / tl;
      // the deck spans the water and rests a tile onto each bank
      let lo = 0, hi = 0;
      while (lo < 12 && !isDry(p.x - nx * (lo + 1), p.y - ny * (lo + 1))) lo++;
      while (hi < 12 && !isDry(p.x + nx * (hi + 1), p.y + ny * (hi + 1))) hi++;
      const br: Bridge = { x0: p.x - nx * (lo + 1.6), y0: p.y - ny * (lo + 1.6), x1: p.x + nx * (hi + 1.6), y1: p.y + ny * (hi + 1.6), w: o.bridgeWidth };
      bridges.push(br);
      const len = Math.hypot(br.x1 - br.x0, br.y1 - br.y0);
      for (let y = Math.floor(Math.min(br.y0, br.y1) - 3); y <= Math.ceil(Math.max(br.y0, br.y1) + 3); y++)
        for (let x = Math.floor(Math.min(br.x0, br.x1) - 3); x <= Math.ceil(Math.max(br.x0, br.x1) + 3); x++) {
          if (!inside(x, y)) continue;
          // distance from the tile's middle to the deck's center line
          const px = x + 0.5 - br.x0, py = y + 0.5 - br.y0;
          const along = (px * (br.x1 - br.x0) + py * (br.y1 - br.y0)) / len;
          const across = Math.abs(px * ny - py * nx);
          if (along < 0 || along > len || across > br.w / 2) continue;
          const i = idx(x, y);
          if (terrain[i] === T.WATER || terrain[i] === T.DEEP) terrain[i] = T.BRIDGE;
          // a clear landing at each end
          else if (TERRAIN[terrain[i]].ground === 0 || terrain[i] === T.FOREST) terrain[i] = T.GRASS;
        }
    }
  }

  function isDry(x: number, y: number): boolean {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!inside(tx, ty)) return true;
    const t = terrain[idx(tx, ty)];
    return t !== T.WATER && t !== T.DEEP;
  }

  /**
   * Water channels along the borders between the starts and the middle (a Voronoi diagram with
   * a warped edge), then a guaranteed home island at each start and a middle island.
   */
  function separateLands(o: { channel: number; home: number; shift: number; middle: number }) {
    const sites = [...Array.from({ length: n }, (_, i) => ringAt(i)), { x: cx, y: cy }];
    const border = ring / 2;
    const islandAt = (x0: number, y0: number, r: number, salt: number) => {
      for (let y = Math.floor(y0 - r * 1.2); y <= Math.ceil(y0 + r * 1.2); y++)
        for (let x = Math.floor(x0 - r * 1.2); x <= Math.ceil(x0 + r * 1.2); x++) {
          if (!inside(x, y)) continue;
          // a ragged coast: at least 0.9 r, up to 1.15 r
          if (Math.hypot(x - x0, y - y0) < r * (0.9 + 0.25 * fbm(x / 9, y / 9, seed + salt, 3))) terrain[idx(x, y)] = T.GRASS;
        }
    };
    for (let i = 0; i < n; i++) {
      const s = sites[i];
      const dir = Math.atan2(cy - s.y, cx - s.x);
      const edge = Math.min(s.x, s.y, w - 1 - s.x, h - 1 - s.y);
      const r = Math.min(size * o.home, border - o.channel / 2 - 1 - o.shift, (edge - 3 + o.shift) / 1.15);
      islandAt(s.x + Math.cos(dir) * o.shift, s.y + Math.sin(dir) * o.shift, r, 201 + i);
    }
    islandAt(cx, cy, (border - o.channel / 2 - 2) * o.middle, 301);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const wx = x + (fbm(x / 26, y / 26, seed + 401, 3) - 0.5) * 16;
        const wy = y + (fbm(x / 26, y / 26, seed + 409, 3) - 0.5) * 16;
        let d1 = Infinity, d2 = Infinity;
        for (const st of sites) {
          const d = Math.hypot(wx - st.x, wy - st.y);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        // cut through land only, so open sea doesn't get ruler-straight lines
        const gap = d2 - d1, i = idx(x, y);
        if (gap < o.channel && terrain[i] !== T.WATER && terrain[i] !== T.DEEP) terrain[i] = gap < o.channel * 0.4 ? T.DEEP : T.WATER;
      }
  }

  function component(from: number): Int32Array {
    const comp = new Int32Array(w * h).fill(-1);
    const stack = [from];
    comp[from] = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        if (comp[j] >= 0 || TERRAIN[terrain[j]].ground === 0) continue;
        comp[j] = 0;
        stack.push(j);
      }
    }
    return comp;
  }

  function connectStarts() {
    for (let k = 1; k < starts.length; k++) {
      const comp = component(idx(starts[0].x, starts[0].y));
      const s = starts[k];
      if (comp[idx(s.x, s.y)] >= 0) continue;
      // carve a 3-wide land bridge toward the first start until it joins the reachable area
      const a = starts[0];
      const steps = Math.ceil(Math.hypot(a.x - s.x, a.y - s.y));
      for (let t = 0; t <= steps; t++) {
        const x = Math.round(s.x + ((a.x - s.x) * t) / steps), y = Math.round(s.y + ((a.y - s.y) * t) / steps);
        if (comp[idx(x, y)] >= 0 && TERRAIN[terrain[idx(x, y)]].ground > 0) break;
        stamp(x, y, 1.5, T.GRASS, (tt) => TERRAIN[tt].ground === 0);
      }
    }
  }

  function buildRoads() {
    const nodes = [...starts.map((s) => ({ x: s.x, y: s.y })), ...cities.map((c) => ({ x: c.x, y: c.y }))];
    if (nodes.length < 2) return;
    // Prim's minimum spanning tree over straight-line distance, plus a few extra links for loops
    const inTree = [0];
    const edges: [number, number][] = [];
    const left = new Set(nodes.map((_, i) => i).slice(1));
    while (left.size) {
      let best: [number, number] | null = null, bd = Infinity;
      for (const a of inTree)
        for (const b of left) {
          const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
          if (d < bd) { bd = d; best = [a, b]; }
        }
      if (!best) break;
      edges.push(best);
      inTree.push(best[1]);
      left.delete(best[1]);
    }
    // every bridge gets a road: from the nearest town or start on one bank, over, to the nearest on the other
    const towns = nodes.length;
    for (const br of bridges) {
      const ends = [[br.x0, br.y0], [br.x1, br.y1]].map(([x, y]) => ({ x: Math.max(0, Math.min(w - 1, Math.round(x))), y: Math.max(0, Math.min(h - 1, Math.round(y))) }));
      const [e0, e1] = [nodes.length, nodes.length + 1];
      nodes.push(...ends);
      edges.push([e0, e1]);
      for (const e of [e0, e1]) {
        const other = nodes[e === e0 ? e1 : e0];
        let near = -1, nd = Infinity;
        for (let k = 0; k < towns; k++) {
          const d = Math.hypot(nodes[k].x - nodes[e].x, nodes[k].y - nodes[e].y);
          // a town on this bank: nearer this end than the other one
          if (d < nd && d <= Math.hypot(nodes[k].x - other.x, nodes[k].y - other.y)) { nd = d; near = k; }
        }
        if (near >= 0) edges.push([near, e]);
      }
    }
    const cost = new Float64Array(w * h);
    const from = new Int32Array(w * h);
    const heap = new Heap(4096);
    const nearDep = new Uint8Array(w * h);
    for (const d of deposits) for (let y = d.y - 1; y <= d.y + 2; y++) for (let x = d.x - 1; x <= d.x + 2; x++) if (inside(x, y)) nearDep[idx(x, y)] = 1;
    for (const [a, b] of edges) {
      const s = idx(nodes[a].x, nodes[a].y), g = idx(nodes[b].x, nodes[b].y);
      cost.fill(Infinity);
      from.fill(-1);
      heap.clear();
      cost[s] = 0;
      heap.push(s, 0);
      const gx = nodes[b].x, gy = nodes[b].y;
      let found = false;
      while (heap.size) {
        const i = heap.pop();
        if (i === g) { found = true; break; }
        const x = i % w, y = (i - x) / w;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (!inside(nx, ny)) continue;
          const j = idx(nx, ny);
          const t = terrain[j];
          let c = t === T.ROAD || t === T.BRIDGE ? 0.4 : t === T.GRASS || t === T.SAND || t === T.RICH ? 1 : t === T.HILL ? 2.5 : t === T.FOREST ? 2.2 : Infinity;
          if (c === Infinity) continue;
          if (nearDep[j]) c += 20;
          const nc = cost[i] + c;
          if (nc < cost[j]) {
            cost[j] = nc;
            from[j] = i;
            heap.push(j, nc + (Math.abs(nx - gx) + Math.abs(ny - gy)) * 0.4);
          }
        }
      }
      if (!found || cost[g] > Math.hypot(nodes[a].x - gx, nodes[a].y - gy) * 3) continue;
      // keep roads out of the HQ footprints, all but the tile where a road enters one, so the road
      // meets the building instead of stopping a strip of grass short of its roof
      const underHq = (i: number) => {
        const x = i % w, y = (i - x) / w;
        return starts.some((st) => x >= st.x - HQ.w / 2 && x < st.x + HQ.w / 2 && y >= st.y - HQ.h / 2 && y < st.y + HQ.h / 2);
      };
      for (let prev = -1, i = g; i >= 0; prev = i, i = from[i]) {
        const next = from[i];
        if (underHq(i) && !((prev >= 0 && !underHq(prev)) || (next >= 0 && !underHq(next)))) continue;
        if (terrain[i] !== T.BRIDGE) terrain[i] = T.ROAD;
      }
    }
  }
}

/** Stable hash of a map, for tests and for checking clients built the same map as the host. */
export function mapHash(m: GameMap): number {
  let s = `${m.w}x${m.h}|`;
  s += m.terrain.join('');
  s += JSON.stringify(m.deposits) + JSON.stringify(m.starts) + JSON.stringify(m.cities);
  return hashStr(s);
}
