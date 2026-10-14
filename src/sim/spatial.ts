// Spatial hash of entities, rebuilt once per tick (derived data, cached outside MatchState).
import type { Ent, MatchState } from './types';
import { BUILDINGS } from '../data/buildings';

const CELL = 4;

export interface Grid {
  tick: number;
  cw: number;
  ch: number;
  cells: number[][];
  /** per cell, a bit for each team owning something there (so enemy searches skip friendly cells) */
  teams: Uint32Array;
  /** false when a team number is too big for the bits: then no cell is skipped */
  masked: boolean;
}

/** bits available for teams in `Grid.teams` */
const TEAM_BITS = 30;

function teamBit(s: MatchState, owner: number): number {
  return owner >= 0 ? 1 << s.players[owner].team : 0;
}

const gridCache = new WeakMap<MatchState, Grid>();

export function grid(s: MatchState): Grid {
  let g = gridCache.get(s);
  if (g && g.tick === s.tick) return g;
  const cw = Math.ceil(s.map.w / CELL), ch = Math.ceil(s.map.h / CELL);
  if (!g || g.cw !== cw || g.ch !== ch) {
    g = { tick: -1, cw, ch, cells: Array.from({ length: cw * ch }, () => []), teams: new Uint32Array(cw * ch), masked: true };
    gridCache.set(s, g);
  }
  for (const c of g.cells) c.length = 0;
  g.teams.fill(0);
  g.masked = s.players.every((p) => p.team >= 0 && p.team < TEAM_BITS);
  g.tick = s.tick;
  for (const id in s.ents) {
    const e = s.ents[id];
    if (e.t === 'u' && e.inside) continue;
    const cx = Math.min(cw - 1, Math.max(0, Math.floor(e.x / CELL)));
    const cy = Math.min(ch - 1, Math.max(0, Math.floor(e.y / CELL)));
    g.cells[cy * cw + cx].push(e.id);
    if (g.masked) g.teams[cy * cw + cx] |= teamBit(s, e.owner);
  }
  return g;
}

/** Add a freshly spawned entity to this tick's grid. */
export function gridAdd(s: MatchState, e: Ent) {
  const g = gridCache.get(s);
  if (!g || g.tick !== s.tick) return;
  const cx = Math.min(g.cw - 1, Math.max(0, Math.floor(e.x / CELL)));
  const cy = Math.min(g.ch - 1, Math.max(0, Math.floor(e.y / CELL)));
  g.cells[cy * g.cw + cx].push(e.id);
  if (g.masked) g.teams[cy * g.cw + cx] |= teamBit(s, e.owner);
}

const BIG = Math.max(...Object.values(BUILDINGS).map((b) => Math.max(b.w, b.h))) / 2 + 1;

/**
 * Call `fn` for every entity whose center is within `r` (+ the largest building half-size, so
 * callers measuring to building edges see them) of (x, y). Order is deterministic (cell order,
 * then insertion order, which is id order).
 */
export function near(s: MatchState, x: number, y: number, r: number, fn: (e: Ent) => void, pad = BIG) {
  const g = grid(s);
  const rr = r + pad;
  const x0 = Math.max(0, Math.floor((x - rr) / CELL)), x1 = Math.min(g.cw - 1, Math.floor((x + rr) / CELL));
  const y0 = Math.max(0, Math.floor((y - rr) / CELL)), y1 = Math.min(g.ch - 1, Math.floor((y + rr) / CELL));
  for (let cy = y0; cy <= y1; cy++)
    for (let cx = x0; cx <= x1; cx++)
      for (const id of g.cells[cy * g.cw + cx]) {
        const e = s.ents[id];
        if (e) fn(e);
      }
}

/**
 * Like `near`, but only visits cells holding something owned by another team than `owner`'s:
 * for enemy searches, whose callbacks ignore everything else anyway. Same order as `near`.
 */
export function nearEnemies(s: MatchState, owner: number, x: number, y: number, r: number, fn: (e: Ent) => void, pad = BIG) {
  const g = grid(s);
  if (!g.masked || owner < 0) return near(s, x, y, r, fn, pad);
  const others = ~teamBit(s, owner);
  const rr = r + pad;
  const x0 = Math.max(0, Math.floor((x - rr) / CELL)), x1 = Math.min(g.cw - 1, Math.floor((x + rr) / CELL));
  const y0 = Math.max(0, Math.floor((y - rr) / CELL)), y1 = Math.min(g.ch - 1, Math.floor((y + rr) / CELL));
  for (let cy = y0; cy <= y1; cy++)
    for (let cx = x0; cx <= x1; cx++) {
      const c = cy * g.cw + cx;
      if (!(g.teams[c] & others)) continue;
      for (const id of g.cells[c]) {
        const e = s.ents[id];
        if (e) fn(e);
      }
    }
}
