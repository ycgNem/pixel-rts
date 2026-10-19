// Small shared helpers over MatchState: lookups, ownership, geometry.
import { UNITS, type UnitDef } from '../data/units';
import { BUILDINGS, type BuildingDef } from '../data/buildings';
import { VETERANCY } from '../data/damage';
import { ACES, BUILD_CAP, INSURGENCY } from '../data/rules';
import type { Building, City, Ent, MatchState, Player, Unit } from './types';
import { TICK_RATE } from './types';
import { modMul } from './mods';

export const sec = (s: number) => Math.round(s * TICK_RATE);

export function udef(kind: string): UnitDef {
  return UNITS[kind];
}
export function bdef(kind: string): BuildingDef {
  return BUILDINGS[kind];
}

/**
 * What a player lacks to pay `cost`, in words ("$120 more", "30 more oil: Oil Derricks on oil wells
 * make it"), or null when they can afford it.
 */
export function shortfall(p: Player, cost: { cash: number; oil: number }): string | null {
  const cash = Math.ceil(cost.cash - p.cash), oil = Math.ceil(cost.oil - p.oil);
  if (cash <= 0 && oil <= 0) return null;
  const parts = [...(cash > 0 ? [`$${cash} more`] : []), ...(oil > 0 ? [`${oil} more oil`] : [])];
  return `need ${parts.join(' and ')}${oil > 0 ? ' (Oil Derricks on oil wells make oil)' : ''}`;
}

/** The building player `p` must finish before placing `kind` (null when nothing is missing). */
export function missingBuilding(s: MatchState, p: number, kind: string): string | null {
  const need = BUILDINGS[kind]?.needs;
  if (!need) return null;
  for (const id in s.ents) {
    const e = s.ents[id];
    if (e.t === 'b' && e.owner === p && e.kind === need && e.built >= 1) return null;
  }
  return need;
}

/** Buildings player `p` owns toward the building cap: every one but the HQ, finished or not. */
export function buildingCount(s: MatchState, p: number): number {
  let n = 0;
  for (const id in s.ents) {
    const e = s.ents[id];
    if (e.t === 'b' && e.owner === p && !BUILDINGS[e.kind].start) n++;
  }
  return n;
}

/** How many buildings player `p` may own (BUILD_CAP): a base plus some for every city held. */
export function buildingCap(s: MatchState, p: number): number {
  let cities = 0;
  for (const c of s.cities) if (c.owner === p) cities++;
  return BUILD_CAP.base + BUILD_CAP.perCity * cities;
}

export function ent(s: MatchState, id: number): Ent | undefined {
  return id ? s.ents[id] : undefined;
}
export function unit(s: MatchState, id: number): Unit | undefined {
  const e = s.ents[id];
  return e && e.t === 'u' ? e : undefined;
}
export function building(s: MatchState, id: number): Building | undefined {
  const e = s.ents[id];
  return e && e.t === 'b' ? e : undefined;
}

/** Entities in id order (deterministic iteration). */
export function allEnts(s: MatchState): Ent[] {
  return Object.values(s.ents);
}

export function teamOf(s: MatchState, p: number): number {
  return p >= 0 ? s.players[p].team : -1;
}
export function allied(s: MatchState, a: number, b: number): boolean {
  if (a < 0 || b < 0) return false;
  return a === b || s.players[a].team === s.players[b].team;
}
/** A knocked-out player who fights on (Insurgency): their units still count and capture. */
export function insurgent(s: MatchState, p: Player): boolean {
  return !p.alive && !p.surrendered && s.setup.insurgency !== false && p.comebacks < INSURGENCY.comebacks;
}
/** Is this player still fighting: in the match, or an insurgent? */
export function fighting(s: MatchState, id: number): boolean {
  const p = s.players[id];
  return !!p && (p.alive || insurgent(s, p));
}

export function enemies(s: MatchState, a: number, b: number): boolean {
  return a >= 0 && b >= 0 && !allied(s, a, b);
}

export function maxHp(s: MatchState, e: Ent): number {
  return e.t === 'u' ? unitMaxHp(s, e) : buildingMaxHp(s, e);
}

export function unitMaxHp(s: MatchState, u: Unit): number {
  const d = UNITS[u.kind];
  const p = s.players[u.owner];
  let m = 1 + u.vet * VETERANCY.hpPerStar;
  // an ace's field promotion
  if (p?.ace === u.id) m *= 1 + ACES.hp;
  if (d.cls === 'vehicle') m *= modMul(p, 'vehicleHp');
  else if (d.cls === 'infantry') m *= modMul(p, 'infantryHp');
  else if (d.cls === 'aircraft') m *= modMul(p, 'aircraftHp');
  else if (d.cls === 'ship') m *= modMul(p, 'shipHp');
  return Math.round(d.hp * m);
}
export function buildingMaxHp(s: MatchState, b: Building): number {
  return Math.round(BUILDINGS[b.kind].hp * modMul(s.players[b.owner], 'structureHp'));
}

/** Distance from a point to an entity's edge (0 inside a building footprint). */
export function distTo(e: Ent, x: number, y: number): number {
  if (e.t === 'u') return Math.hypot(e.x - x, e.y - y);
  const d = BUILDINGS[e.kind];
  const dx = Math.max(e.tx - x, 0, x - (e.tx + d.w));
  const dy = Math.max(e.ty - y, 0, y - (e.ty + d.h));
  return Math.hypot(dx, dy);
}

/** Rough radius used for culling and splash: units use their collision radius. */
export function entRadius(e: Ent): number {
  if (e.t === 'u') return UNITS[e.kind].radius;
  const d = BUILDINGS[e.kind];
  return Math.max(d.w, d.h) / 2;
}

export function layerOf(e: Ent): 'ground' | 'naval' | 'air' {
  return e.t === 'u' ? UNITS[e.kind].layer : 'ground';
}

export function cityAt(s: MatchState, id: number): City | undefined {
  return s.cities[id];
}

/** The exiled capital, once it is working (see EXILE). */
export function exileCapital(s: MatchState, p: number): City | undefined {
  const pl = s.players[p];
  if (!pl || pl.capital < 0 || s.tick < pl.capitalAt) return undefined;
  const c = s.cities[pl.capital];
  return c && c.owner === p ? c : undefined;
}

export function hqOf(s: MatchState, p: number): Building | undefined {
  for (const e of allEnts(s)) if (e.t === 'b' && e.owner === p && e.kind === 'hq') return e;
  return undefined;
}

export function livingPlayers(s: MatchState): Player[] {
  return s.players.filter((p) => p.alive);
}

export function unitCost(s: MatchState, p: number, kind: string): { cash: number; oil: number } {
  const d = UNITS[kind];
  const pl = s.players[p];
  let m = modMul(pl, 'unitCost');
  if (d.cls === 'aircraft') m *= modMul(pl, 'aircraftCost');
  return { cash: Math.round(d.cost.cash * m), oil: Math.round(d.cost.oil * m) };
}
