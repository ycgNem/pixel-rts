// Fog of war for the local viewer: what is visible now, what was explored, and the last-seen
// state of enemy buildings ("ghosts") in explored areas.
import { BUILDINGS } from '../data/buildings';
import type { MatchState } from '../sim/types';
import { vision } from '../sim/vision';
import { makeCanvas } from './pixbuf';
import { CELL, dither } from './dither';
import type { Camera } from './view';
import { TILE } from './view';

/** fog alpha: in sight, explored, never seen */
const SEEN = 0, EXPLORED = 120, UNKNOWN = 235;
const LEVELS = [SEEN, EXPLORED, UNKNOWN];
/** dither cells per tile */
const SUB = TILE / CELL;

export interface Ghost { id: number; kind: string; owner: number; tx: number; ty: number; built: number }

export class Fog {
  explored: Uint8Array;
  visible: Uint8Array;
  canvas: HTMLCanvasElement;
  ghosts = new Map<number, Ghost>();
  private img: ImageData;
  private lastTick = -1;
  private all: Uint8Array | null = null;
  /** zoomed in: the dithered fog over the tiles in view, rebuilt when the fog or the view changes */
  private near = makeCanvas(1, 1);
  private nearImg: ImageData | null = null;
  private nearKey = '';

  constructor(private w: number, private h: number) {
    this.explored = new Uint8Array(w * h);
    this.visible = new Uint8Array(w * h);
    this.canvas = makeCanvas(w, h);
    this.img = new ImageData(w, h);
  }

  /**
   * Recompute for this team (at most a few times per second). A viewer who is out with no
   * teammate left in the match spectates: they see everything.
   */
  update(s: MatchState, team: number, force = false) {
    if (!force && s.tick - this.lastTick < 4 && this.lastTick >= 0) return;
    this.lastTick = s.tick;
    const spectate = !s.players.some((p) => p.alive && p.team === team);
    const v = spectate ? (this.all ??= new Uint8Array(this.w * this.h).fill(1)) : vision(s, team);
    this.visible = v;
    const showAll = s.setup.fog === 'off';
    const exploredMode = s.setup.fog === 'explored';
    const d = this.img.data;
    for (let i = 0; i < this.w * this.h; i++) {
      if (v[i]) this.explored[i] = 1;
      const a = showAll || v[i] ? SEEN : this.explored[i] || exploredMode ? EXPLORED : UNKNOWN;
      d[i * 4] = 12;
      d[i * 4 + 1] = 10;
      d[i * 4 + 2] = 20;
      d[i * 4 + 3] = a;
    }
    this.canvas.getContext('2d')!.putImageData(this.img, 0, 0);
    // remember enemy buildings we can see; forget ones we see are gone
    for (const id in s.ents) {
      const e = s.ents[id];
      if (e.t !== 'b' || e.owner < 0 || s.players[e.owner].team === team) continue;
      const bd = BUILDINGS[e.kind];
      let seen = false;
      for (let y = e.ty; y < e.ty + bd.h && !seen; y++) for (let x = e.tx; x < e.tx + bd.w; x++) if (v[y * this.w + x]) { seen = true; break; }
      if (seen) this.ghosts.set(e.id, { id: e.id, kind: e.kind, owner: e.owner, tx: e.tx, ty: e.ty, built: e.built });
    }
    for (const [id, g] of this.ghosts) {
      if (s.ents[id]) continue;
      const bd = BUILDINGS[g.kind];
      let seen = false;
      for (let y = g.ty; y < g.ty + bd.h && !seen; y++) for (let x = g.tx; x < g.tx + bd.w; x++) if (v[y * this.w + x]) { seen = true; break; }
      if (seen) this.ghosts.delete(id);
    }
  }

  /**
   * Draw the fog. Zoomed in, it is a dithered band on a world-anchored grid of art-pixel cells
   * (blended between tile centres); in the strategic view, the tile map smoothed.
   */
  draw(ctx: CanvasRenderingContext2D, cam: Camera) {
    const z = cam.z, w = this.w, h = this.h;
    if (cam.strategic) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.canvas, cam.sx(0), cam.sy(0), w * TILE * z, h * TILE * z);
      ctx.imageSmoothingEnabled = false;
      return;
    }
    const tx0 = Math.max(0, Math.floor(cam.wx(0)) - 1), ty0 = Math.max(0, Math.floor(cam.wy(0)) - 1);
    const tx1 = Math.min(w - 1, Math.ceil(cam.wx(cam.w)) + 1), ty1 = Math.min(h - 1, Math.ceil(cam.wy(cam.h)) + 1);
    if (tx1 < tx0 || ty1 < ty0) return;
    const tw = tx1 - tx0 + 1, th = ty1 - ty0 + 1;
    const key = `${this.lastTick}:${tx0}:${ty0}:${tw}:${th}`;
    if (key !== this.nearKey) {
      this.nearKey = key;
      const cw = tw * SUB, ch = th * SUB;
      if (this.near.width !== cw || this.near.height !== ch || !this.nearImg) {
        this.near.width = cw;
        this.near.height = ch;
        this.nearImg = new ImageData(cw, ch);
      }
      const d = this.nearImg.data, fog = this.img.data;
      const at = (x: number, y: number) => fog[((Math.min(h - 1, Math.max(0, y)) * w) + Math.min(w - 1, Math.max(0, x))) * 4 + 3];
      for (let cy = 0; cy < ch; cy++) {
        const v = ty0 + (cy + 0.5) / SUB - 0.5, j = Math.floor(v), fy = v - j;
        for (let cx = 0; cx < cw; cx++) {
          const u = tx0 + (cx + 0.5) / SUB - 0.5, i = Math.floor(u), fx = u - i;
          const a = (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
          const k = (cy * cw + cx) * 4;
          d[k] = 12; d[k + 1] = 10; d[k + 2] = 20;
          d[k + 3] = dither(a, LEVELS, tx0 * SUB + cx, ty0 * SUB + cy);
        }
      }
      this.near.getContext('2d')!.putImageData(this.nearImg, 0, 0);
    }
    ctx.drawImage(this.near, cam.sx(tx0), cam.sy(ty0), tw * TILE * z, th * TILE * z);
  }

  isVisible(tx: number, ty: number): boolean {
    tx = Math.floor(tx);
    ty = Math.floor(ty);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return this.visible[ty * this.w + tx] === 1;
  }

  isExplored(tx: number, ty: number): boolean {
    tx = Math.floor(tx);
    ty = Math.floor(ty);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return this.explored[ty * this.w + tx] === 1;
  }
}
