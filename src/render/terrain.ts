// Terrain: dual-grid autotiling with the imported Wang tilesets, baked into chunk canvases.
//
// Map tiles sit on the corners of render cells (the render grid is offset by half a tile), so each
// cell picks the tile whose four corners match the four map tiles around it. Terrains form layers:
// water over deep water, sand over water, grass over sand, then road / rich ground / hills /
// forest / mountains over grass. A cell with exactly two terrains that form a pair uses that pair's
// tile directly; anything else is painted bottom layer first, each higher layer as a masked tile.
import { T, TERRAIN } from '../data/terrain';
import { PALETTE, PALETTE_RGB } from '../data/palette';
import type { GameMap } from '../sim/types';
import { hash2, valueNoise } from '../sim/rng';
import { sprite, hasSprite, type Sprite } from './art';
import { makeCanvas, ctx2d } from './pixbuf';
import { TILE } from './view';

export const CHUNK = 16;

/** speckles (dark/light share of pixels), wave dashes on water, and small tufts (share of 6x6 cells, denser in meadows) */
interface TextureRule { dark: number; darkC: number; light: number; lightC: number; dash?: number; tuft?: number; tuftC?: number }
const rgbKey = (i: number) => (PALETTE_RGB[i][0] << 16) | (PALETTE_RGB[i][1] << 8) | PALETTE_RGB[i][2];
/** palette color of a flat fill → how to texture it (shares are per pixel) */
const TEXTURE = new Map<number, TextureRule>([
  [rgbKey(37), { dark: 0.012, darkC: 36, light: 0.006, lightC: 38, tuft: 0.12, tuftC: 36 }], // grass
  [rgbKey(38), { dark: 0.04, darkC: 37, light: 0.02, lightC: 4 }], // hills
  [rgbKey(4), { dark: 0.03, darkC: 3, light: 0.03, lightC: 38 }], // sand
  [rgbKey(46), { dark: 0, darkC: 0, light: 0, lightC: 47, dash: 0.025 }], // shallow water
  [rgbKey(44), { dark: 0, darkC: 0, light: 0, lightC: 45, dash: 0.03 }], // deep water (dark shade)
  [rgbKey(45), { dark: 0, darkC: 0, light: 0, lightC: 46, dash: 0.03 }], // deep water (open sea fill)
]);

/** Drawing order, bottom to top. */
const PRIO: number[] = [];
PRIO[T.DEEP] = 0;
PRIO[T.WATER] = 1;
PRIO[T.SAND] = 2;
PRIO[T.GRASS] = 3;
PRIO[T.RICH] = 4;
PRIO[T.ROAD] = 5;
PRIO[T.HILL] = 6;
PRIO[T.FOREST] = 7;
PRIO[T.MOUNTAIN] = 8;
/** terrains that everything above sits on (a corner counts for them if it is anything higher) */
const CHAIN = new Set<number>([T.WATER, T.SAND, T.GRASS]);
/** tileset whose upper terrain this is */
const PAIR: Record<number, string> = {
  [T.WATER]: 'water', [T.SAND]: 'sand', [T.GRASS]: 'grass', [T.RICH]: 'rich', [T.ROAD]: 'road',
  [T.HILL]: 'hill', [T.FOREST]: 'forest', [T.MOUNTAIN]: 'mountain',
};
const LOWER: Record<string, number> = { water: T.DEEP, sand: T.WATER, grass: T.SAND, rich: T.GRASS, road: T.GRASS, hill: T.GRASS, forest: T.GRASS, mountain: T.GRASS };
/** pure terrains whose texture can be mirrored for variety */
const FLIPPABLE = new Set<number>([T.DEEP, T.WATER, T.SAND, T.GRASS, T.RICH]);

function pure(t: number): Sprite | null {
  if (t === T.DEEP) return sprite('t:water:0');
  return sprite(`t:${PAIR[t]}:15`);
}

interface Chunk { c: HTMLCanvasElement; used: number }

export class TerrainLayer {
  private chunks = new Map<number, Chunk>();
  private frame = 0;
  private hasArt: boolean;

  constructor(private map: GameMap) {
    this.hasArt = hasSprite('t:grass:15');
  }

  private at(x: number, y: number): number {
    const m = this.map;
    x = Math.max(0, Math.min(m.w - 1, x));
    y = Math.max(0, Math.min(m.h - 1, y));
    return m.terrain[y * m.w + x];
  }

  /** Draw the visible chunks. */
  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, toScreenX: (tx: number) => number, toScreenY: (ty: number) => number, z: number) {
    this.frame++;
    const cx0 = Math.max(0, Math.floor(x0 / CHUNK)), cy0 = Math.max(0, Math.floor(y0 / CHUNK));
    const cx1 = Math.min(Math.ceil(this.map.w / CHUNK) - 1, Math.floor(x1 / CHUNK)), cy1 = Math.min(Math.ceil(this.map.h / CHUNK) - 1, Math.floor(y1 / CHUNK));
    const size = CHUNK * TILE * z;
    if (z < 1) ctx.imageSmoothingEnabled = true;
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const ch = this.chunk(cx, cy);
        ctx.drawImage(ch.c, toScreenX(cx * CHUNK), toScreenY(cy * CHUNK), Math.ceil(size), Math.ceil(size));
      }
    ctx.imageSmoothingEnabled = false;
    // forget chunks not drawn for a while (memory)
    if (this.chunks.size > 96) for (const [k, ch] of this.chunks) if (this.frame - ch.used > 600) this.chunks.delete(k);
  }

  invalidate() {
    this.chunks.clear();
  }

  private chunk(cx: number, cy: number): Chunk {
    const key = cy * 4096 + cx;
    let ch = this.chunks.get(key);
    if (!ch) {
      ch = { c: this.bake(cx, cy), used: this.frame };
      this.chunks.set(key, ch);
    }
    ch.used = this.frame;
    return ch;
  }

  private bake(cx: number, cy: number): HTMLCanvasElement {
    const c = makeCanvas(CHUNK * TILE, CHUNK * TILE);
    const ctx = ctx2d(c);
    const tx0 = cx * CHUNK, ty0 = cy * CHUNK;
    if (!this.hasArt) {
      for (let y = 0; y < CHUNK; y++)
        for (let x = 0; x < CHUNK; x++) {
          ctx.fillStyle = PALETTE[TERRAIN[this.at(tx0 + x, ty0 + y)].mini];
          ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        }
      return c;
    }
    // render cells (i, j) have map tiles (i-1, j-1) … (i, j) on their corners
    for (let j = ty0; j <= ty0 + CHUNK; j++)
      for (let i = tx0; i <= tx0 + CHUNK; i++) {
        const px = (i - tx0) * TILE - TILE / 2, py = (j - ty0) * TILE - TILE / 2;
        this.cell(ctx, i, j, px, py);
      }
    this.texture(ctx, tx0, ty0);
    this.decorate(ctx, tx0, ty0);
    return c;
  }

  /**
   * The tilesets' flat fills (grass, sand, hills, water) get texture keyed to world position, so
   * it never repeats tile by tile: meadow patches, speckles, and wave dashes on water.
   */
  private texture(ctx: CanvasRenderingContext2D, tx0: number, ty0: number) {
    const S = CHUNK * TILE;
    const img = ctx.getImageData(0, 0, S, S);
    const d = img.data;
    const ox = tx0 * TILE, oy = ty0 * TILE;
    for (let py = 0; py < S; py++)
      for (let px = 0; px < S; px++) {
        const i = (py * S + px) * 4;
        const rule = TEXTURE.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
        if (!rule || !d[i + 3]) continue;
        const wx = ox + px, wy = oy + py;
        let to = -1;
        if (rule.dash) {
          // short horizontal glints that drift a little row to row
          if (hash2(Math.floor((wx + (wy >> 2) * 3) / 3), wy, 911) < rule.dash) to = rule.lightC;
        } else {
          const h = hash2(wx, wy, 517);
          if (h < rule.dark) to = rule.darkC;
          else if (h < rule.dark + rule.light) to = rule.lightC;
          else if (rule.tuft && tuftAt(wx, wy, rule.tuft)) to = rule.tuftC!;
        }
        if (to < 0) continue;
        const [r, g, b] = PALETTE_RGB[to];
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
    ctx.putImageData(img, 0, 0);
  }

  private cell(ctx: CanvasRenderingContext2D, i: number, j: number, px: number, py: number) {
    const nw = this.at(i - 1, j - 1), ne = this.at(i, j - 1), sw = this.at(i - 1, j), se = this.at(i, j);
    const corners = [nw, ne, sw, se];
    const kinds = [...new Set(corners)].sort((a, b) => PRIO[a] - PRIO[b]);
    const blit = (s: Sprite | null, flipX = false, flipY = false) => {
      if (!s) return;
      if (!flipX && !flipY) { ctx.drawImage(s.img, s.x, s.y, s.w, s.h, px, py, TILE, TILE); return; }
      ctx.save();
      ctx.translate(px + (flipX ? TILE : 0), py + (flipY ? TILE : 0));
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(s.img, s.x, s.y, s.w, s.h, 0, 0, TILE, TILE);
      ctx.restore();
    };
    const maskOf = (test: (t: number) => boolean) => (test(nw) ? 8 : 0) | (test(ne) ? 4 : 0) | (test(sw) ? 2 : 0) | (test(se) ? 1 : 0);
    if (kinds.length === 1) {
      const t = kinds[0];
      const h = hash2(i, j, 77);
      const flip = FLIPPABLE.has(t);
      blit(pure(t), flip && h < 0.5, flip && (h * 4) % 1 < 0.5);
      return;
    }
    if (kinds.length === 2 && PAIR[kinds[1]] && LOWER[PAIR[kinds[1]]] === kinds[0]) {
      const pair = PAIR[kinds[1]];
      blit(sprite(`t:${pair}:${maskOf((t) => t === kinds[1])}`));
      return;
    }
    // layered: the lowest terrain, then each higher one masked. A terrain that sits on grass
    // (mountains, forest, hills, road) beside water or sand also gets the shore it stands on (sand,
    // then grass) painted under it, or its tile's fringe would show open water through it.
    const layers = new Set(kinds);
    for (const L of kinds) {
      if (CHAIN.has(L) || !PAIR[L]) continue;
      for (let low = LOWER[PAIR[L]]; low !== undefined && PRIO[low] > PRIO[kinds[0]]; low = LOWER[PAIR[low]]) layers.add(low);
    }
    const order = [...layers].sort((a, b) => PRIO[a] - PRIO[b]);
    blit(pure(order[0]));
    for (let k = 1; k < order.length; k++) {
      const L = order[k];
      const pair = PAIR[L];
      if (!pair) continue;
      const mask = CHAIN.has(L) ? maskOf((t) => PRIO[t] >= PRIO[L]) : maskOf((t) => t === L);
      blit(mask === 15 ? pure(L) : sprite(`tm:${pair}:${mask}`));
    }
  }

  /** Deposits and small ground details. */
  private decorate(ctx: CanvasRenderingContext2D, tx0: number, ty0: number) {
    for (const d of this.map.deposits) {
      if (d.x + 2 < tx0 || d.y + 2 < ty0 || d.x >= tx0 + CHUNK || d.y >= ty0 + CHUNK) continue;
      const s = sprite(d.kind === 'oil' ? 'dep:oil' : d.rich ? 'dep:rich' : 'dep:ore');
      if (s) ctx.drawImage(s.img, s.x, s.y, s.w, s.h, (d.x - tx0) * TILE + (2 * TILE - s.w) / 2, (d.y - ty0) * TILE + (2 * TILE - s.h) / 2, s.w, s.h);
    }
  }
}

/**
 * A grass tuft: a little 'v' of three pixels, at most one per 6x6 cell, placed by hash. Meadows
 * (slow noise) get more of them, so the grass has gentle variation instead of flat or blotchy.
 */
function tuftAt(wx: number, wy: number, density: number): boolean {
  const cx = Math.floor(wx / 6), cy = Math.floor(wy / 6);
  const meadow = valueNoise(cx / 20, cy / 20, 33);
  if (hash2(cx, cy, 61) >= density * (0.4 + meadow * 1.4)) return false;
  const ax = cx * 6 + Math.floor(hash2(cx, cy, 62) * 3), ay = cy * 6 + Math.floor(hash2(cx, cy, 63) * 4);
  const dx = wx - ax, dy = wy - ay;
  return (dy === 0 && (dx === 0 || dx === 2)) || (dy === 1 && dx === 1);
}
