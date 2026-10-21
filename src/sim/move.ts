// Movement: following orders and targets with flow fields, direct steering when the way is clear,
// separation between units, and group arrival.
import { STEAMROLL, UNITS, type UnitDef } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { COMBAT, SEPARATION } from '../data/rules';
import { T, TERRAIN } from '../data/terrain';
import type { Ent, MatchState, Unit } from './types';
import { DT } from './types';
import { distTo, sec } from './world';
import { nav, fieldTo, fieldToBuilding, lineWalkable, passable, nearestPassable, type Nav, type FlowField } from './nav';
import { canFireAt } from './combat';
import { hasPerk, modMul } from './mods';
import { groundWeatherMul, stormy } from './weather';
import { unstick } from './lifecycle';

/** How close a Builder must be to a footprint to work on it. */
export const BUILD_REACH = 0.9;

// ---------------------------------------------------------------- separation grid
// Units by 2-tile cell, air and the rest kept apart, rebuilt at the start of each movement step
// (derived data, cached outside MatchState). A flat counting-sort layout: `items` holds the
// units of cell c at [start[c], start[c + 1]), in id order, so the result is deterministic.
const SEP_CELL = 2;
/** units move at most this far in one tick, so a cell list is never staler than this */
const SEP_STALE = 0.3;
const MAX_R_AIR = Math.max(...Object.values(UNITS).filter((d) => d.layer === 'air').map((d) => d.radius));
const MAX_R_LOW = Math.max(...Object.values(UNITS).filter((d) => d.layer !== 'air').map((d) => d.radius));
interface SepGrid { cw: number; ch: number; start: Int32Array; fill: Int32Array; items: Unit[]; cell: number[] }
const sepCache = new WeakMap<MatchState, SepGrid>();

function sepGrid(s: MatchState, n: Nav): SepGrid {
  const cw = Math.ceil(n.w / SEP_CELL), ch = Math.ceil(n.h / SEP_CELL), cells = cw * ch * 2;
  let g = sepCache.get(s);
  if (!g || g.cw !== cw || g.ch !== ch) {
    g = { cw, ch, start: new Int32Array(cells + 1), fill: new Int32Array(cells), items: [], cell: [] };
    sepCache.set(s, g);
  }
  const { start, fill, items, cell } = g;
  start.fill(0);
  items.length = 0;
  cell.length = 0;
  for (const id in s.ents) {
    const u = s.ents[id];
    if (u.t !== 'u' || u.inside) continue;
    const cx = Math.min(cw - 1, Math.max(0, Math.floor(u.x / SEP_CELL)));
    const cy = Math.min(ch - 1, Math.max(0, Math.floor(u.y / SEP_CELL)));
    const c = (UNITS[u.kind].layer === 'air' ? cw * ch : 0) + cy * cw + cx;
    items.push(u);
    cell.push(c);
    start[c + 1]++;
  }
  for (let i = 0; i < cells; i++) start[i + 1] += start[i];
  fill.set(start.subarray(0, cells));
  const sorted = new Array<Unit>(items.length);
  for (let i = 0; i < items.length; i++) sorted[fill[cell[i]]++] = items[i];
  g.items = sorted;
  return g;
}

export function nextOrder(u: Unit) {
  u.order = u.queue.shift() ?? null;
  u._stuck = 0;
  u._best = 1e9;
  if (!u.order) {
    u.gx = u.x;
    u.gy = u.y;
  }
}

export function unitSpeed(s: MatchState, u: Unit, n: Nav): number {
  const d = UNITS[u.kind];
  const p = s.players[u.owner];
  let v = d.speed;
  if (d.cls === 'vehicle') v *= modMul(p, 'vehicleSpeed');
  else if (d.cls === 'infantry') v *= modMul(p, 'infantrySpeed');
  else if (d.cls === 'aircraft') v *= modMul(p, 'aircraftSpeed');
  if (d.layer === 'ground') {
    const t = Math.floor(u.y) * n.w + Math.floor(u.x);
    v *= n.speed[t] || 1;
    // Blitzkrieg vehicles don't bog down in the rain
    if (!(d.cls === 'vehicle' && hasPerk(p, 'allWeather'))) v *= groundWeatherMul(s);
  }
  if (d.ability === 'afterburner' && s.tick < u.abUntil) v *= 1.8;
  if (d.ability === 'steamroll' && s.tick < u.abUntil) v *= STEAMROLL.speed;
  for (const fx of s.effects) if (fx.k === 'rally' && fx.owner === u.owner && Math.hypot(fx.x - u.x, fx.y - u.y) <= fx.r) { v *= 1.3; break; }
  return v;
}

interface Goal {
  x: number;
  y: number;
  field: () => FlowField;
  /** stop within this distance */
  arrive: number;
}

function goalForEnt(s: MatchState, n: Nav, u: Unit, t: Ent): Goal {
  const layer = UNITS[u.kind].layer;
  if (t.t === 'b') {
    const d = BUILDINGS[t.kind];
    return { x: t.x, y: t.y, field: () => fieldToBuilding(n, layer, t.id, t.tx, t.ty, d.w, d.h), arrive: 0 };
  }
  const tx = Math.floor(t.x), ty = Math.floor(t.y);
  return { x: t.x, y: t.y, field: () => fieldTo(n, layer, tx, ty), arrive: 0 };
}

function goalForPoint(n: Nav, layer: UnitDef['layer'], x: number, y: number, gx: number, gy: number, arrive = 0.12): Goal {
  return { x, y, field: () => fieldTo(n, layer, gx, gy), arrive };
}

/** Where does this unit want to go this tick? null = stay. */
function goalOf(s: MatchState, n: Nav, u: Unit): Goal | null {
  const d = UNITS[u.kind];
  const o = u.order;
  const tgt = u.tgt ? s.ents[u.tgt] : undefined;
  if (o?.o === 'attack') {
    const t = s.ents[o.t];
    if (!t || t.hp <= 0) { nextOrder(u); return goalOf(s, n, u); }
    if (canFireAt(s, u, t)) return orbit(s, u, t);
    return goalForEnt(s, n, u, t);
  }
  if (o?.o === 'build') {
    const b = s.ents[o.t];
    if (!b || b.t !== 'b' || b.owner !== u.owner) { nextOrder(u); return goalOf(s, n, u); }
    if (distTo(b, u.x, u.y) <= BUILD_REACH + d.radius) return null;
    return goalForEnt(s, n, u, b);
  }
  if (o?.o === 'move' || o?.o === 'patrol') {
    if (tgt && (o.o === 'patrol' || o.am)) {
      if (canFireAt(s, u, tgt)) return orbit(s, u, tgt);
      return goalForEnt(s, n, u, tgt);
    }
    if (o.o === 'patrol') {
      const [x, y] = o.leg === 0 ? [o.bx, o.by] : [o.ax, o.ay];
      if (Math.hypot(x - u.x, y - u.y) < 0.4) {
        o.leg = 1 - o.leg;
        u.gx = u.x; u.gy = u.y;
      }
      const [nx, ny] = o.leg === 0 ? [o.bx, o.by] : [o.ax, o.ay];
      return goalForPoint(n, d.layer, nx, ny, Math.floor(nx), Math.floor(ny), 0.3);
    }
    return goalForPoint(n, d.layer, o.x, o.y, o.gx, o.gy);
  }
  if (o?.o === 'load') {
    const t = s.ents[o.t];
    if (!t || t.t !== 'u') { nextOrder(u); return goalOf(s, n, u); }
    // meet the transport at the nearest shore tile
    const shore = nearestPassable(n, d.layer, Math.floor(t.x), Math.floor(t.y), 3);
    if (!shore) return null;
    return { x: shore[0] + 0.5, y: shore[1] + 0.5, field: () => fieldTo(n, d.layer, shore[0], shore[1]), arrive: 0.3 };
  }
  if (o?.o === 'unload') return goalForPoint(n, d.layer, o.gx + 0.5, o.gy + 0.5, o.gx, o.gy, 0.5);
  // idle: chase what we're shooting at (within the leash), else drift back to the guard point
  if (tgt && !u.hold && !u.dug) {
    if (canFireAt(s, u, tgt)) return orbit(s, u, tgt);
    if (Math.hypot(tgt.x - u.gx, tgt.y - u.gy) <= COMBAT.leash + d.sight) return goalForEnt(s, n, u, tgt);
  }
  if (!tgt && !u.hold && Math.hypot(u.gx - u.x, u.gy - u.y) > 1.5) return goalForPoint(n, d.layer, u.gx, u.gy, Math.floor(u.gx), Math.floor(u.gy), 0.6);
  return null;
}

/** Aircraft keep moving around their target while attacking; everything else stands still. */
function orbit(s: MatchState, u: Unit, t: Ent): Goal | null {
  const d = UNITS[u.kind];
  if (d.layer !== 'air' || u.kind === 'helicopter') return null;
  const a = (s.tick * 0.06 + u.id) % (Math.PI * 2);
  const r = Math.max(1.2, d.weapons[0]?.range ?? 2) * 0.8;
  const x = t.x + Math.cos(a) * r, y = t.y + Math.sin(a) * r;
  return { x, y, field: () => { throw new Error('air'); }, arrive: 0 };
}

export function stepMovement(s: MatchState) {
  const n = nav(s);
  const storm = stormy(s);
  sepGrid(s, n);
  for (const id in s.ents) {
    const u = s.ents[id];
    if (u.t !== 'u' || u.inside) continue;
    const d = UNITS[u.kind];
    u.mv = false;
    if (d.layer !== 'air' && !passable(n, d.layer, Math.floor(u.x), Math.floor(u.y))) unstick(s, u, n);
    if (u.dug || (storm && d.layer === 'air' && !hasPerk(s.players[u.owner], 'stormFlight'))) continue;
    const g = goalOf(s, n, u);
    if (!g) {
      separate(s, n, u, d, false);
      continue;
    }
    const arrived = steer(s, n, u, d, g);
    if (arrived && u.order?.o === 'move' && !u.tgt) {
      const grp = u.order.grp;
      nextOrder(u);
      if (!u.order) u._grp = grp;
    }
  }
}

/** set by `separate`: the unit touched a friendly unit that is on the move */
let crowded = false;

/** a flow field's cost for one tile of open ground */
const PLAIN_COST = TERRAIN[T.GRASS].cost;

/** Move toward a goal. Returns true when arrived (or when the goal can't be reached). */
function steer(s: MatchState, n: Nav, u: Unit, d: UnitDef, g: Goal): boolean {
  const dist = Math.hypot(g.x - u.x, g.y - u.y);
  if (dist <= g.arrive) {
    separate(s, n, u, d, false);
    return true;
  }
  let ax = g.x, ay = g.y;
  // progress is measured along the path (field cost ÷ a plain tile's cost), so a detour to a
  // bridge, or a wait in the queue to cross it, isn't mistaken for being stuck
  let pathLeft = -1;
  if (d.layer !== 'air') {
    const direct = dist < 16 && lineWalkable(n, d.layer, u.x, u.y, g.x, g.y, d.radius * 0.7);
    if (!direct) {
      const f = g.field();
      const cx = Math.floor(u.x), cy = Math.floor(u.y);
      const here = f.ensure(cy * n.w + cx);
      if (here === Infinity) {
        // unreachable: give up on this goal
        return true;
      }
      pathLeft = here / PLAIN_COST;
      // follow the field a few steps and aim at the farthest step we can see
      let ti = cy * n.w + cx, aim = -1;
      for (let k = 0; k < 5; k++) {
        const nx = f.next(ti % n.w, (ti - (ti % n.w)) / n.w);
        if (nx < 0) break;
        ti = nx;
        const px = (ti % n.w) + 0.5, py = (ti - (ti % n.w)) / n.w + 0.5;
        if (k === 0 || lineWalkable(n, d.layer, u.x, u.y, px, py, d.radius * 0.7)) aim = ti;
        else break;
      }
      if (aim >= 0) {
        ax = (aim % n.w) + 0.5;
        ay = (aim - (aim % n.w)) / n.w + 0.5;
      }
    }
  }
  const speed = unitSpeed(s, u, n) * DT;
  const dx = ax - u.x, dy = ay - u.y;
  const len = Math.hypot(dx, dy) || 1;
  const stepLen = Math.min(speed, len);
  const vx = (dx / len) * stepLen, vy = (dy / len) * stepLen;
  tryMove(n, u, d, vx, vy);
  if (stepLen > 0.001) {
    u.mv = true;
    turnToward(u, d, Math.atan2(vy, vx));
  }
  crowded = false;
  const groupStop = separate(s, n, u, d, true);
  // progress tracking: give up if we stop getting closer for a while
  const nd = Math.hypot(g.x - u.x, g.y - u.y);
  const left = pathLeft >= 0 ? pathLeft : nd;
  if (left < u._best - 0.05) { u._best = left; u._stuck = 0; }
  // waiting in a moving column (a bridge, a pass) is patience, not being stuck
  else u._stuck += crowded ? SEPARATION.queuePatience : 1;
  if (groupStop && nd < 3) return true;
  if (u._stuck > sec(nd < 3 ? 1.5 : 6)) return true;
  return nd <= Math.max(g.arrive, 0.12);
}

function turnToward(u: Unit, d: UnitDef, a: number) {
  if (d.cls === 'infantry') { u.dir = a; return; }
  let diff = a - u.dir;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const rate = d.cls === 'aircraft' ? 0.25 : 0.35;
  u.dir += Math.max(-rate, Math.min(rate, diff));
}

function tryMove(n: Nav, u: Unit, d: UnitDef, vx: number, vy: number) {
  const ok = (x: number, y: number) => d.layer === 'air' ? x > 0 && y > 0 && x < n.w && y < n.h : passable(n, d.layer, Math.floor(x), Math.floor(y));
  if (ok(u.x + vx, u.y + vy)) { u.x += vx; u.y += vy; return; }
  if (ok(u.x + vx, u.y)) { u.x += vx; return; }
  if (ok(u.x, u.y + vy)) { u.y += vy; }
}

/**
 * Push apart from overlapping units of the same layer. Returns true if a moving unit is touching a
 * friendly unit that has already arrived at the same group move (time to stop and spread out).
 */
function separate(s: MatchState, n: Nav, u: Unit, d: UnitDef, moving: boolean): boolean {
  let px = 0, py = 0, stop = false;
  const grp = u.order?.o === 'move' ? u.order.grp : -1;
  const g = sepCache.get(s);
  if (!g) return false;
  const air = d.layer === 'air';
  // the farthest another unit can be and still overlap, plus how far cells can be out of date
  const reach = (d.radius + (air ? MAX_R_AIR : MAX_R_LOW)) * (air ? 0.6 : Math.max(1, SEPARATION.infantry)) + SEP_STALE;
  const { cw, ch, start, items } = g;
  const x0 = Math.max(0, Math.floor((u.x - reach) / SEP_CELL)), x1 = Math.min(cw - 1, Math.floor((u.x + reach) / SEP_CELL));
  const y0 = Math.max(0, Math.floor((u.y - reach) / SEP_CELL)), y1 = Math.min(ch - 1, Math.floor((u.y + reach) / SEP_CELL));
  const base = air ? cw * ch : 0;
  for (let cy = y0; cy <= y1; cy++)
    for (let cx = x0; cx <= x1; cx++) {
      const c = base + cy * cw + cx;
      for (let i = start[c], end = start[c + 1]; i < end; i++) {
        const o = items[i];
        if (o === u || o.inside) continue;
        const dx = u.x - o.x, dy = u.y - o.y;
        const od = UNITS[o.kind];
        const spread = air ? 0.6 : d.cls === 'infantry' && od.cls === 'infantry' ? SEPARATION.infantry : 1;
        const min = (d.radius + od.radius) * spread;
        if (dx * dx + dy * dy >= min * min) continue;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1e-4) {
          // exactly on top of each other: split by id
          px += u.id > o.id ? 0.05 : -0.05;
          continue;
        }
        const push = (min - dist) / min;
        // units on the move push idle allies aside more than they get pushed
        const w = moving && !o.mv ? 0.3 : 0.5;
        px += (dx / dist) * push * w * min;
        py += (dy / dist) * push * w * min;
        if (moving && grp >= 0 && o.owner === u.owner && !o.order && !o.mv && o._grp === grp) stop = true;
        if (moving && o.mv && o.owner === u.owner) crowded = true;
      }
    }
  if (px || py) {
    const max = SEPARATION.maxStep;
    const len = Math.hypot(px, py);
    if (len > max) { px = (px / len) * max; py = (py / len) * max; }
    tryMove(n, u, d, px, py);
  }
  return stop;
}
