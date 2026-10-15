// Network protocol (CLAUDE.md rule 9): every message between peers, and the snapshot codec.
// Any breaking change here bumps PROTOCOL_VERSION (peers with another version can't join).
//
// The host runs the sim. Clients build the same starting state from the match setup (map
// generation is deterministic), then apply snapshots: compact rows for units and buildings that
// changed since the last snapshot, whole objects for players, cities and small lists when they
// changed, ids that disappeared, and the events since the last snapshot.
import { UNITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import type { Building, City, Command, Crate, Effect, MatchSetup, MatchState, Order, Player, ProdItem, Shot, SimEvent, Unit, Weather } from '../sim/types';

// 8: setups can carry an Auto time limit (-1) and a Random AI style; sub armor and depth charges
// 9: bigger maps with a river and bridges (a new terrain id): the same setup builds another map
export const PROTOCOL_VERSION = 9;
/** the host sends a snapshot every this many ticks (20 Hz / 2 = 10 per second) */
export const SNAP_EVERY = 2;

export interface LobbyPlayer {
  /** peer id of a human player ('' = an AI slot) */
  peer: string;
  name: string;
  team: number;
  color: number;
  ready: boolean;
}

export interface LobbyState {
  code: string;
  host: string;
  setup: MatchSetup;
  /** one per setup.players entry */
  seats: LobbyPlayer[];
  started: boolean;
}

export type NetMsg =
  /** client → host when it connects; `id` is a private token kept in the browser, so a player who
   *  reloads the page (and gets a new peer id) can take their seat back */
  | { t: 'hello'; v: number; name: string; id?: string }
  /** host → everyone: the lobby changed */
  | { t: 'lobby'; lobby: LobbyState }
  /** client → host: change my seat */
  | { t: 'seat'; color?: number; team?: number; ready?: boolean; name?: string }
  | { t: 'chat'; name: string; text: string }
  /** host → each client: the match begins and you are player `me` */
  | { t: 'start'; setup: MatchSetup; me: number }
  /** client → host */
  | { t: 'cmd'; c: Command }
  /** host → client */
  | { t: 'snap'; s: Snapshot }
  | { t: 'pause'; on: boolean }
  /** host → client: you can't join (version mismatch, game full, already started) */
  | { t: 'refuse'; why: string };

// ---------------------------------------------------------------- snapshots

const UNIT_KINDS = Object.keys(UNITS);
const BUILDING_KINDS = Object.keys(BUILDINGS);
const UNIT_INDEX = new Map(UNIT_KINDS.map((k, i) => [k, i]));
const BUILDING_INDEX = new Map(BUILDING_KINDS.map((k, i) => [k, i]));
const ORDER_CODES = ['', 'move', 'amove', 'attack', 'build', 'load', 'unload', 'patrol'] as const;

/**
 * Unit row: id, kind, owner, x*100, y*100, dir*100, hp*10, flags (1 moving, 2 dug in, 4 hold),
 * vet, inside, order code, order target, ability ready tick, ability until tick, fired tick, target,
 * cargo ids, hidden-until tick.
 */
export type UnitRow = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number[], number];
/** Building row: id, kind, owner, tx, ty, hp*10, built*10000, prod, rally, blocked, dep, target. */
export type BuildingRow = [number, number, number, number, number, number, number, [number, number, number][], [number, number] | null, number, number, number];

export interface Snapshot {
  tick: number;
  /** true: replaces everything (first snapshot, or a resync) */
  full: boolean;
  u: UnitRow[];
  b: BuildingRow[];
  gone: number[];
  players?: Player[];
  cities?: City[];
  shots: [number, number, number, number, number, number, number, number, string][];
  effects?: Effect[];
  crates?: Crate[];
  weather?: Weather;
  misc?: { supremacy: Record<number, number>; launch: MatchState['launch']; coalition: number; over: MatchState['over']; navVer: number; nextId: number; rng: number; contract: MatchState['contract']; nextContract: number };
  ev: SimEvent[];
}

function orderCode(o: Order | null): [number, number] {
  if (!o) return [0, 0];
  switch (o.o) {
    case 'move': return [o.am ? 2 : 1, 0];
    case 'attack': return [3, o.t];
    case 'build': return [4, o.t];
    case 'load': return [5, o.t];
    case 'unload': return [6, 0];
    case 'patrol': return [7, 0];
  }
}

function unitRow(u: Unit): UnitRow {
  const [oc, ot] = orderCode(u.order);
  return [
    u.id, UNIT_INDEX.get(u.kind)!, u.owner, Math.round(u.x * 100), Math.round(u.y * 100), Math.round(u.dir * 100), Math.round(u.hp * 10),
    (u.mv ? 1 : 0) | (u.dug ? 2 : 0) | (u.hold ? 4 : 0), u.vet, u.inside, oc, ot, u.abReady, u.abUntil, u.fired, u.tgt, u.cargo, u.hide,
  ];
}

function buildingRow(b: Building): BuildingRow {
  return [
    b.id, BUILDING_INDEX.get(b.kind)!, b.owner, b.tx, b.ty, Math.round(b.hp * 10), Math.round(b.built * 10000),
    b.prod.map((p) => [UNIT_INDEX.get(p.kind)!, Math.round(p.left), p.total]), b.rally, b.blocked ? 1 : 0, b.dep, b.tgt,
  ];
}

/** Host side: remembers what was sent last, and builds the next snapshot. */
export class SnapshotEncoder {
  private rows = new Map<number, string>();
  private lastPlayers = '';
  private lastCities = new Map<number, string>();
  private lastEffects = '';
  private lastCrates = '';
  private lastWeather = '';
  private lastMisc = '';
  private sent = false;

  /** Forget everything (the next snapshot is full). */
  reset() {
    this.sent = false;
    this.rows.clear();
    this.lastPlayers = '';
    this.lastCities.clear();
    this.lastEffects = this.lastCrates = this.lastWeather = this.lastMisc = '';
  }

  encode(s: MatchState, ev: SimEvent[], full = false): Snapshot {
    if (full) this.reset();
    full = !this.sent;
    this.sent = true;
    const snap: Snapshot = { tick: s.tick, full, u: [], b: [], gone: [], shots: [], ev };
    const seen = new Set<number>();
    for (const id in s.ents) {
      const e = s.ents[id];
      seen.add(e.id);
      const row = e.t === 'u' ? unitRow(e) : buildingRow(e);
      const key = JSON.stringify(row);
      if (this.rows.get(e.id) === key) continue;
      this.rows.set(e.id, key);
      if (e.t === 'u') snap.u.push(row as UnitRow);
      else snap.b.push(row as BuildingRow);
    }
    for (const id of this.rows.keys()) if (!seen.has(id)) { snap.gone.push(id); this.rows.delete(id); }
    const players = JSON.stringify(s.players);
    if (players !== this.lastPlayers) { snap.players = s.players; this.lastPlayers = players; }
    const cities: City[] = [];
    for (const c of s.cities) {
      const k = JSON.stringify(c);
      if (this.lastCities.get(c.id) !== k) { cities.push(c); this.lastCities.set(c.id, k); }
    }
    if (cities.length) snap.cities = cities;
    snap.shots = s.shots.map((sh) => [sh.x0, sh.y0, sh.x, sh.y, sh.t0, sh.land, sh.t, sh.owner, sh.cls]);
    const effects = JSON.stringify(s.effects);
    if (effects !== this.lastEffects) { snap.effects = s.effects; this.lastEffects = effects; }
    const crates = JSON.stringify(s.crates);
    if (crates !== this.lastCrates) { snap.crates = s.crates; this.lastCrates = crates; }
    const weather = JSON.stringify(s.weather);
    if (weather !== this.lastWeather) { snap.weather = s.weather; this.lastWeather = weather; }
    const misc = { supremacy: s.supremacy, launch: s.launch, coalition: s.coalition, over: s.over, navVer: s.navVer, nextId: s.nextId, rng: s.rng, contract: s.contract, nextContract: s.nextContract };
    const mk = JSON.stringify(misc);
    if (mk !== this.lastMisc) { snap.misc = misc; this.lastMisc = mk; }
    return snap;
  }
}

function decodeOrder(code: number, target: number, u: Unit): Order | null {
  switch (ORDER_CODES[code]) {
    case 'move': return { o: 'move', x: u.x, y: u.y, gx: u.x, gy: u.y, am: false, grp: 0 };
    case 'amove': return { o: 'move', x: u.x, y: u.y, gx: u.x, gy: u.y, am: true, grp: 0 };
    case 'attack': return { o: 'attack', t: target };
    case 'build': return { o: 'build', t: target };
    case 'load': return { o: 'load', t: target };
    case 'unload': return { o: 'unload', x: u.x, y: u.y, gx: u.x, gy: u.y };
    case 'patrol': return { o: 'patrol', ax: u.x, ay: u.y, bx: u.x, by: u.y, leg: 0 };
    default: return null;
  }
}

/**
 * Client side: apply a snapshot to the local copy of the state. Returns the positions units had
 * before (for interpolation).
 */
export function applySnapshot(s: MatchState, snap: Snapshot): Map<number, [number, number, number]> {
  const prev = new Map<number, [number, number, number]>();
  for (const id in s.ents) {
    const e = s.ents[id];
    if (e.t === 'u') prev.set(e.id, [e.x, e.y, e.dir]);
  }
  if (snap.full) s.ents = {};
  for (const id of snap.gone) delete s.ents[id];
  for (const r of snap.u) {
    const [id, k, owner, x, y, dir, hp, flags, vet, inside, oc, ot, abReady, abUntil, fired, tgt, cargo, hide] = r;
    let u = s.ents[id] as Unit | undefined;
    if (!u || u.t !== 'u') {
      u = {
        t: 'u', id, kind: UNIT_KINDS[k], owner, hp: 0, x: x / 100, y: y / 100, dir: 0, order: null, queue: [], tgt: 0, cd: [], hold: false, dug: false,
        xp: 0, vet: 0, abReady: 0, abUntil: 0, cargo: [], inside: 0, fired: -100000, hide: 0, gx: x / 100, gy: y / 100, mv: false, _stuck: 0, _best: 0, _grp: -1,
      };
      s.ents[id] = u;
    }
    u.kind = UNIT_KINDS[k];
    u.owner = owner;
    u.x = x / 100;
    u.y = y / 100;
    u.dir = dir / 100;
    u.hp = hp / 10;
    u.mv = !!(flags & 1);
    u.dug = !!(flags & 2);
    u.hold = !!(flags & 4);
    u.vet = vet;
    u.inside = inside;
    u.order = decodeOrder(oc, ot, u);
    u.abReady = abReady;
    u.abUntil = abUntil;
    u.fired = fired;
    u.hide = hide;
    u.tgt = tgt;
    u.cargo = cargo;
  }
  for (const r of snap.b) {
    const [id, k, owner, tx, ty, hp, built, prod, rally, blocked, dep, tgt] = r;
    const d = BUILDINGS[BUILDING_KINDS[k]];
    let b = s.ents[id] as Building | undefined;
    if (!b || b.t !== 'b') {
      b = { t: 'b', id, kind: d.id, owner, hp: 0, x: tx + d.w / 2, y: ty + d.h / 2, tx, ty, built: 0, prod: [], rally: null, dep, cd: [], tgt: 0, blocked: false };
      s.ents[id] = b;
    }
    b.owner = owner;
    b.hp = hp / 10;
    b.built = built / 10000;
    b.prod = prod.map(([pk, left, total]): ProdItem => ({ kind: UNIT_KINDS[pk], left, total }));
    b.rally = rally;
    b.blocked = !!blocked;
    b.tgt = tgt;
  }
  if (snap.players) s.players = snap.players;
  if (snap.cities) for (const c of snap.cities) s.cities[c.id] = c;
  s.shots = snap.shots.map(([x0, y0, x, y, t0, land, t, owner, cls]): Shot => ({ x0, y0, x, y, t0, land, t, owner, cls, src: 0, kind: '', w: 0, dmg: 0, splash: 0, hits: [] }));
  if (snap.effects) s.effects = snap.effects;
  if (snap.crates) s.crates = snap.crates;
  if (snap.weather) s.weather = snap.weather;
  if (snap.misc) {
    s.supremacy = snap.misc.supremacy;
    s.launch = snap.misc.launch;
    s.coalition = snap.misc.coalition;
    s.over = snap.misc.over;
    s.navVer = snap.misc.navVer;
    s.nextId = snap.misc.nextId;
    s.rng = snap.misc.rng;
    s.contract = snap.misc.contract;
    s.nextContract = snap.misc.nextContract;
  }
  s.tick = snap.tick;
  return prev;
}
