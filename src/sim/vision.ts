// Vision and fog of war. A team sees every tile within sight of its units, buildings, cities and
// reveal effects. Grids are derived data, cached per team per tick.
import { UNITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { TERRAIN } from '../data/terrain';
import { TECHS } from '../data/techs';
import type { Ent, MatchState, Unit } from './types';
import { TICK_RATE } from './types';
import { modMul } from './mods';
import { sightMul } from './weather';
import { near } from './spatial';

const SATELLITE = TECHS.find((t) => t.id === 'satellites')!.reveal!;
/** a stealth unit stays visible this long after firing */
const FIRED_VISIBLE = 3 * TICK_RATE;
const CITY_SIGHT = 6;

interface VisCache { tick: number; grids: Map<number, Uint8Array> }
const visCache = new WeakMap<MatchState, VisCache>();

const discs = new Map<number, Int16Array>();
/** tile offsets (dx, dy pairs) within radius r */
function disc(r: number): Int16Array {
  const k = Math.round(r * 2) / 2;
  let d = discs.get(k);
  if (!d) {
    const out: number[] = [];
    const R = Math.ceil(k);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= k * k + 0.5) out.push(dx, dy);
    d = Int16Array.from(out);
    discs.set(k, d);
  }
  return d;
}

export function unitSight(s: MatchState, u: Unit): number {
  const d = UNITS[u.kind];
  const t = s.map.terrain[Math.floor(u.y) * s.map.w + Math.floor(u.x)] ?? 0;
  const hill = d.layer === 'ground' ? TERRAIN[t]?.sight ?? 0 : 0;
  return (d.sight + hill) * modMul(s.players[u.owner], 'sight') * sightMul(s);
}

/** Visibility grid for a team (1 = visible). Fog 'off' and satellite windows see everything. */
export function vision(s: MatchState, team: number): Uint8Array {
  let c = visCache.get(s);
  if (!c || c.tick !== s.tick) {
    c = { tick: s.tick, grids: new Map() };
    visCache.set(s, c);
  }
  let g = c.grids.get(team);
  if (g) return g;
  const { w, h } = s.map;
  g = new Uint8Array(w * h);
  c.grids.set(team, g);
  if (s.setup.fog === 'off' || satelliteActive(s, team)) {
    g.fill(1);
    return g;
  }
  const mark = (x: number, y: number, r: number) => {
    const d = disc(r);
    const cx = Math.floor(x), cy = Math.floor(y);
    for (let i = 0; i < d.length; i += 2) {
      const tx = cx + d[i], ty = cy + d[i + 1];
      if (tx >= 0 && ty >= 0 && tx < w && ty < h) g![ty * w + tx] = 1;
    }
  };
  const night = sightMul(s);
  for (const id in s.ents) {
    const e = s.ents[id];
    if (e.owner < 0 || s.players[e.owner].team !== team) continue;
    if (e.t === 'u') {
      if (e.inside) continue;
      mark(e.x, e.y, unitSight(s, e));
    } else {
      const d = BUILDINGS[e.kind];
      const r = (e.built < 1 ? 3 : d.sight) * (e.kind === 'radar' ? 1 : night) * modMul(s.players[e.owner], 'sight');
      mark(e.tx + d.w / 2, e.ty + d.h / 2, r + Math.max(d.w, d.h) / 2);
    }
  }
  for (const c2 of s.cities) if (c2.owner >= 0 && s.players[c2.owner].team === team) mark(c2.x + 0.5, c2.y + 0.5, CITY_SIGHT);
  for (const fx of s.effects) if (fx.k === 'reveal' && fx.team === team) mark(fx.x, fx.y, fx.r);
  return g;
}

function satelliteActive(s: MatchState, team: number): boolean {
  if (!s.players.some((p) => p.team === team && p.alive && p.techs.includes('satellites'))) return false;
  const t = s.tick / TICK_RATE;
  return t % SATELLITE.every < SATELLITE.duration;
}

export function tileVisible(s: MatchState, team: number, x: number, y: number): boolean {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= s.map.w || ty >= s.map.h) return false;
  return vision(s, team)[ty * s.map.w + tx] === 1;
}

/** Is this unit hidden from those without a detector (a submarine, or partisans just landed)? */
export function stealthy(s: MatchState, u: Unit): boolean {
  return !!UNITS[u.kind].stealth || u.hide > s.tick;
}

/** Can this team see the entity right now (fog and stealth)? Own and allied entities always. */
export function canSee(s: MatchState, team: number, e: Ent): boolean {
  if (e.owner >= 0 && s.players[e.owner].team === team) return true;
  if (e.t === 'b') {
    const d = BUILDINGS[e.kind];
    const g = vision(s, team);
    for (let y = e.ty; y < e.ty + d.h; y++) for (let x = e.tx; x < e.tx + d.w; x++) if (g[y * s.map.w + x]) return true;
    return false;
  }
  if (e.inside) return false;
  if (!tileVisible(s, team, e.x, e.y)) return false;
  if (stealthy(s, e) && !detected(s, team, e)) return false;
  return true;
}

/** Stealth units are seen only after firing, or near a detector (destroyer, radar, coastal gun, sonar). */
export function detected(s: MatchState, team: number, u: Unit): boolean {
  if (s.tick - u.fired < FIRED_VISIBLE) return true;
  for (const fx of s.effects) if (fx.k === 'reveal' && fx.team === team && fx.r >= 12 && Math.hypot(fx.x - u.x, fx.y - u.y) <= fx.r) return true;
  let found = false;
  near(s, u.x, u.y, 20, (e) => {
    if (found || e.owner < 0 || s.players[e.owner].team !== team) return;
    const det = e.t === 'u' ? UNITS[e.kind].detects : BUILDINGS[e.kind].detects && e.built >= 1;
    if (!det) return;
    const r = e.t === 'u' ? UNITS[e.kind].sight : BUILDINGS[e.kind].sight;
    if (Math.hypot(e.x - u.x, e.y - u.y) <= r) found = true;
  });
  return found;
}
