// Farmland: the fields around each city. Shared by the painter (which draws the crops into the
// ground) and the props (which keep haybales and carts off the crops and put scarecrows in them),
// so both agree on where every field is. Render-only.
//
// Fields are plots on a world grid (every other row shifted half a plot, like brickwork), each
// with a grass margin, sometimes a hedge along its north or west side, and one crop: wheat, rows of
// vegetables, a ploughed field, lavender, or a fenced pasture. A plot is farmed when its middle is
// plains in the ring around a city.
import { C } from '../data/palette';
import { T } from '../data/terrain';
import type { GameMap } from '../sim/types';
import { hash2 } from '../sim/rng';
import { TILE } from './view';

/** the farmland ring (tiles from the nearest city, measured at a plot's middle) */
export const FARM_RING: [number, number] = [2.7, 3.4];
/** extra ring width per city level (tiles) */
export const RING_PER_LEVEL = 0.55;
/** plot height, the plot widths a row of plots picks from, and the grass margin on a plot's north and west sides (px) */
const WIDTHS = [36, 44, 52, 60], MARGIN = 3;
/** rows of plots come in bands of BAND px, split into rows by one of these patterns */
const BAND = 90, SPLITS = [[30, 30, 30], [24, 36, 30], [36, 24, 30], [45, 45], [26, 32, 32], [40, 50]];

export const CROP = { NONE: -1, WHEAT: 0, VEG: 1, PLOUGHED: 2, LAVENDER: 3, PASTURE: 4, GREEN: 5 } as const;
/** how often each crop turns up */
const KINDS = [CROP.WHEAT, CROP.WHEAT, CROP.WHEAT, CROP.WHEAT, CROP.GREEN, CROP.GREEN, CROP.GREEN, CROP.VEG, CROP.VEG, CROP.PLOUGHED, CROP.PASTURE, CROP.PASTURE, CROP.LAVENDER];

export interface Plot {
  /** grid cell */
  px: number;
  py: number;
  /** position inside the cell (px) */
  lx: number;
  ly: number;
  /** cell size (px) */
  w: number;
  h: number;
  /** the plot's middle (world px) */
  cx: number;
  cy: number;
  kind: number;
}

/** The plot cell under a world pixel (geometry and crop only; `farmed` says whether it is tilled). */
export function plotAt(wx: number, wy: number): Plot {
  // each row of plots has its own width and offset, so the patchwork is no tidy grid
  const band = Math.floor(wy / BAND), split = SPLITS[Math.floor(hash2(band, 0, 537) * SPLITS.length)];
  let row = 0, top = band * BAND;
  while (row < split.length - 1 && wy >= top + split[row]) top += split[row++];
  const py = band * 4 + row, rh = split[row];
  const W = WIDTHS[Math.floor(hash2(0, py, 539) * WIDTHS.length)], shift = Math.floor(hash2(1, py, 539) * W);
  const px = Math.floor((wx + shift) / W);
  const h = hash2(px, py, 541);
  return {
    px, py, w: W, h: rh, lx: wx + shift - px * W, ly: wy - top,
    cx: px * W - shift + W / 2, cy: top + rh / 2,
    kind: h < 0.16 ? CROP.NONE : KINDS[Math.floor(hash2(px, py, 543) * KINDS.length)],
  };
}

/** Is this plot tilled: its middle on plains within the ring around a city? */
export function farmed(p: Plot, map: GameMap): boolean {
  if (p.kind === CROP.NONE) return false;
  const tx = p.cx / TILE, ty = p.cy / TILE;
  const ix = Math.floor(tx), iy = Math.floor(ty);
  if (ix < 0 || iy < 0 || ix >= map.w || iy >= map.h || map.terrain[iy * map.w + ix] !== T.GRASS) return false;
  // and clear of roads and woods at its corners too (a road cuts a verge, not the crop)
  for (const [dx, dy] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]]) {
    const jx = Math.floor(tx + (dx * p.w) / TILE), jy = Math.floor(ty + (dy * p.h) / TILE);
    if (jx < 0 || jy < 0 || jx >= map.w || jy >= map.h || map.terrain[jy * map.w + jx] !== T.GRASS) return false;
  }
  // the ring grows with the city: a village farms a few fields, a metropolis a wide belt
  for (const c of map.cities) {
    const d = Math.hypot(c.x + 0.5 - tx, c.y + 0.5 - ty);
    if (d > FARM_RING[0] && d < FARM_RING[1] + c.level * RING_PER_LEVEL) return true;
  }
  return false;
}

/** Inside the plot proper (not its margin or hedge)? */
export function inCrop(p: Plot): boolean {
  return p.lx >= MARGIN && p.ly >= MARGIN;
}

/** The crop's pixel (palette index), or -1 where the meadow shows (the margin, a pasture's grass). */
export function cropPixel(p: Plot, wx: number, wy: number): number {
  const W = p.w - MARGIN, H = p.h - MARGIN;
  const ix = p.lx - MARGIN, iy = p.ly - MARGIN;
  // the margin: grass, with a hedge along some plots' north or west side
  if (ix < 0 || iy < 0) {
    if (p.kind === CROP.PASTURE) return -1;
    // a hedge along some plots' north side; otherwise a trodden earth track between the fields
    const hedgeN = hash2(p.px, p.py, 551) < 0.35;
    if (hedgeN && iy < 0 && ix >= -1) return iy === -MARGIN ? C.sage : iy === -1 ? C.shade : hash2(wx, wy, 555) < 0.3 ? C.sage : C.fern;
    if (iy === -1 || ix === -1) return C.olive;
    return hash2(wx, wy, 557) < 0.2 ? C.taupe : C.dust;
    return -1;
  }
  // rounded corners
  if ((ix === 0 || ix === W - 1) && (iy === 0 || iy === H - 1)) return -1;
  // rows mostly run the long way
  const rows = hash2(p.px, p.py, 547) < 0.75;
  const along = rows ? iy : ix, across = rows ? ix : iy;
  const h = hash2(wx, wy, 559);
  switch (p.kind) {
    case CROP.WHEAT: {
      // standing grain: stalks catching the light, its south edge in shade, now and then a poppy
      if (iy >= H - 2) return iy === H - 1 ? C.olive : C.khaki;
      if (h < 0.004) return C.red;
      return hash2(wx, (wy + (wx & 1)) >> 1, 561) < 0.38 ? C.khaki : C.straw;
    }
    case CROP.GREEN: {
      // a young crop: dense green blades, a little lighter where the rows catch the sun
      if (iy === H - 1) return C.moss;
      if (along % 4 === 0) return C.straw;
      return hash2(wx, (wy + (wx & 1)) >> 1, 563) < 0.45 ? C.khaki : C.celadon;
    }
    case CROP.VEG: {
      // rows of round leafy plants, the soil showing in a thin line between the rows
      const r = along % 4;
      if (r === 3) return h < 0.3 ? C.olive : C.dust;
      const q = (across + Math.floor(along / 4) * 2) % 4;
      if (q === 3) return r === 2 ? C.fern : C.dust;
      return r === 0 ? C.celadon : r === 1 ? C.sage : C.fern;
    }
    case CROP.PLOUGHED: {
      // fresh furrows: a darker trough every third row, a few stones
      if (h < 0.02) return C.pebble;
      return along % 3 === 0 ? C.olive : C.dust;
    }
    case CROP.LAVENDER: {
      // rounded bushes in rows, lit on top
      const r = along % 4, q = (across + Math.floor(along / 4)) % 5;
      if (r >= 3 || q === 4) return h < 0.4 ? C.sage : C.fern;
      return r === 0 ? C.violet : r === 1 ? C.stone : C.mauve;
    }
    case CROP.PASTURE:
      // a meadow for the livestock (the props put them there)
      return -1;
  }
  return -1;
}
