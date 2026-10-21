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
// 10: a 'sellUnits' command (selling troops), and the building cap
// 11: Mega Tank and Mega Plane (new unit kinds and abilities), Builder work zones ('zone' command, a unit row field);
//     slimmer snapshots: move rows, and players' and cities' fast-changing numbers apart from the rest
export const PROTOCOL_VERSION = 11;
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
 * cargo ids, hidden-until tick, work zone ([x*10, y*10, r*10], or 0 for none).
 */
export type UnitRow = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number[], number, [number, number, number] | 0];
/** Building row: id, kind, owner, tx, ty, hp*10, built*10000, prod, rally, blocked, dep, target. */
export type BuildingRow = [number, number, number, number, number, number, number, [number, number, number][], [number, number] | null, number, number, number];

/** Move row (a unit whose only changes are these): id, x*100, y*100, dir*100, hp*10, flags, fired tick, target. */
export type MoveRow = [number, number, number, number, number, number, number, number];
/** A player's fast-changing numbers: index, cash, oil, science, CP, research progress, cash earned, kills, value destroyed, units lost, units built, then the exchange heat of each trade. */
export type PlayerNums = number[];
/** A city's fast-changing numbers: id, growth*1000, capture*1000, then each queued item's ticks left. */
export type CityNums = number[];

export interface Snapshot {
  tick: number;
  /** true: replaces everything (first snapshot, or a resync) */
  full: boolean;
  u: UnitRow[];
  /** units that only moved, turned, got hurt or fired */
  m: MoveRow[];
  b: BuildingRow[];
  gone: number[];
  /** every player in full, when anything but their fast-changing numbers changed */
  players?: Player[];
  pv?: PlayerNums[];
  /** cities in full, when anything but their fast-changing numbers changed */
  cities?: City[];
  cv?: CityNums[];
  shots: [number, number, number, number, number, number, number, number, string][];
  effects?: Effect[];
  crates?: Crate[];
  weather?: Weather;
  misc?: Misc;
  ev: SimEvent[];
}

type Misc = { supremacy: Record<number, number>; launch: MatchState['launch']; coalition: number; over: MatchState['over']; navVer: number; nextId: number; rng: number; contract: MatchState['contract']; nextContract: number };

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
    u.post ? [Math.round(u.post.x * 10), Math.round(u.post.y * 10), Math.round(u.post.r * 10)] : 0,
  ];
}

/** the unit row fields a move row carries */
const MOVE_FIELDS = [3, 4, 5, 6, 7, 14, 15];
/** the rest: if any of these changed the unit needs a full row */
const FULL_FIELDS = [1, 2, 8, 9, 10, 11, 12, 13, 16, 17, 18];

const sameField = (a: unknown, b: unknown) =>
  a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]));

function buildingRow(b: Building): BuildingRow {
  return [
    b.id, BUILDING_INDEX.get(b.kind)!, b.owner, b.tx, b.ty, Math.round(b.hp * 10), Math.round(b.built * 10000),
    b.prod.map((p) => [UNIT_INDEX.get(p.kind)!, Math.round(p.left), p.total]), b.rally, b.blocked ? 1 : 0, b.dep, b.tgt,
  ];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const TRADES = ['buyOil', 'sellOil', 'fundResearch'] as const;

function playerNums(p: Player): PlayerNums {
  const st = p.stats;
  return [p.id, r2(p.cash), r2(p.oil), r2(p.science), r2(p.cp), r2(p.research.prog), r2(st.cashEarned), st.kills, r2(st.valueDestroyed), st.unitsLost, st.unitsBuilt, ...TRADES.map((k) => r2(p.market[k] ?? 0))];
}

/** A player without the numbers that PlayerNums carries (for spotting other changes). */
function playerRest(p: Player): string {
  return JSON.stringify({
    ...p, cash: 0, oil: 0, science: 0, cp: 0, market: 0, research: { ...p.research, prog: 0 },
    stats: { ...p.stats, cashEarned: 0, kills: 0, valueDestroyed: 0, unitsLost: 0, unitsBuilt: 0 },
  });
}

function cityNums(c: City): CityNums {
  return [c.id, Math.round(c.grow * 1000), Math.round(c.cap * 1000), ...c.prod.map((it) => Math.round(it.left))];
}

function cityRest(c: City): string {
  // weapon cooldowns are the host's business
  return JSON.stringify({ ...c, grow: 0, cap: 0, cd: 0, prod: c.prod.map((it) => [it.kind, it.total]) });
}

/**
 * Everything the host would send this tick, worked out once and shared by every peer's encoder
 * (with three peers, rows are built and compared once instead of three times).
 */
export interface SnapshotFrame {
  units: Map<number, UnitRow>;
  buildings: Map<number, [BuildingRow, string]>;
  pv: PlayerNums[];
  pvKey: string[];
  pRest: string[];
  cv: CityNums[];
  cvKey: string[];
  cRest: string[];
  shots: Snapshot['shots'];
  effects: string;
  crates: string;
  weather: string;
  misc: Misc;
  miscKey: string;
}

export function snapshotFrame(s: MatchState): SnapshotFrame {
  const units = new Map<number, UnitRow>(), buildings = new Map<number, [BuildingRow, string]>();
  for (const id in s.ents) {
    const e = s.ents[id];
    if (e.t === 'u') units.set(e.id, unitRow(e));
    else {
      const row = buildingRow(e);
      buildings.set(e.id, [row, JSON.stringify(row)]);
    }
  }
  const pv = s.players.map(playerNums), cv = s.cities.map(cityNums);
  const misc: Misc = { supremacy: s.supremacy, launch: s.launch, coalition: s.coalition, over: s.over, navVer: s.navVer, nextId: s.nextId, rng: s.rng, contract: s.contract, nextContract: s.nextContract };
  return {
    units, buildings,
    pv, pvKey: pv.map((r) => r.join()), pRest: s.players.map(playerRest),
    cv, cvKey: cv.map((r) => r.join()), cRest: s.cities.map(cityRest),
    shots: s.shots.map((sh) => [sh.x0, sh.y0, sh.x, sh.y, sh.t0, sh.land, sh.t, sh.owner, sh.cls]),
    effects: JSON.stringify(s.effects), crates: JSON.stringify(s.crates), weather: JSON.stringify(s.weather),
    misc, miscKey: JSON.stringify(misc),
  };
}

/** Host side: remembers what was sent last, and builds the next snapshot. */
export class SnapshotEncoder {
  private units = new Map<number, UnitRow>();
  private buildings = new Map<number, string>();
  private pvKey: string[] = [];
  private pRest: string[] = [];
  private cvKey: string[] = [];
  private cRest: string[] = [];
  private lastEffects = '';
  private lastCrates = '';
  private lastWeather = '';
  private lastMisc = '';
  private sent = false;

  /** Forget everything (the next snapshot is full). */
  reset() {
    this.sent = false;
    this.units.clear();
    this.buildings.clear();
    this.pvKey = [];
    this.pRest = [];
    this.cvKey = [];
    this.cRest = [];
    this.lastEffects = this.lastCrates = this.lastWeather = this.lastMisc = '';
  }

  /** The snapshot for this peer. `frame` is this tick's shared work (see snapshotFrame). */
  encode(s: MatchState, ev: SimEvent[], full = false, frame = snapshotFrame(s)): Snapshot {
    if (full) this.reset();
    full = !this.sent;
    this.sent = true;
    const snap: Snapshot = { tick: s.tick, full, u: [], m: [], b: [], gone: [], shots: frame.shots, ev };
    for (const [id, row] of frame.units) {
      const last = this.units.get(id);
      if (last && FULL_FIELDS.every((i) => sameField(last[i], row[i]))) {
        if (!MOVE_FIELDS.every((i) => last[i] === row[i])) snap.m.push([id, row[3], row[4], row[5], row[6], row[7], row[14], row[15]]);
      } else snap.u.push(row);
      this.units.set(id, row);
    }
    for (const [id, [row, key]] of frame.buildings) {
      if (this.buildings.get(id) === key) continue;
      this.buildings.set(id, key);
      snap.b.push(row);
    }
    for (const id of this.units.keys()) if (!frame.units.has(id)) { snap.gone.push(id); this.units.delete(id); }
    for (const id of this.buildings.keys()) if (!frame.buildings.has(id)) { snap.gone.push(id); this.buildings.delete(id); }
    if (frame.pRest.some((k, i) => k !== this.pRest[i]) || frame.pRest.length !== this.pRest.length) {
      snap.players = s.players;
      this.pRest = frame.pRest;
    }
    const pv = frame.pv.filter((_, i) => frame.pvKey[i] !== this.pvKey[i]);
    if (pv.length) { snap.pv = pv; this.pvKey = frame.pvKey; }
    const cities = s.cities.filter((_, i) => frame.cRest[i] !== this.cRest[i]);
    if (cities.length) { snap.cities = cities; this.cRest = frame.cRest; }
    const cv = frame.cv.filter((_, i) => frame.cvKey[i] !== this.cvKey[i]);
    if (cv.length) { snap.cv = cv; this.cvKey = frame.cvKey; }
    if (frame.effects !== this.lastEffects) { snap.effects = s.effects; this.lastEffects = frame.effects; }
    if (frame.crates !== this.lastCrates) { snap.crates = s.crates; this.lastCrates = frame.crates; }
    if (frame.weather !== this.lastWeather) { snap.weather = s.weather; this.lastWeather = frame.weather; }
    if (frame.miscKey !== this.lastMisc) { snap.misc = frame.misc; this.lastMisc = frame.miscKey; }
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
    const [id, k, owner, x, y, dir, hp, flags, vet, inside, oc, ot, abReady, abUntil, fired, tgt, cargo, hide, post] = r;
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
    if (post) u.post = { x: post[0] / 10, y: post[1] / 10, r: post[2] / 10, leg: 0, wait: 0 };
    else delete u.post;
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
  for (const r of snap.m ?? []) {
    const u = s.ents[r[0]];
    if (!u || u.t !== 'u') continue;
    u.x = r[1] / 100;
    u.y = r[2] / 100;
    u.dir = r[3] / 100;
    u.hp = r[4] / 10;
    u.mv = !!(r[5] & 1);
    u.dug = !!(r[5] & 2);
    u.hold = !!(r[5] & 4);
    u.fired = r[6];
    u.tgt = r[7];
  }
  if (snap.players) s.players = snap.players;
  for (const r of snap.pv ?? []) {
    const p = s.players[r[0]];
    if (!p) continue;
    [, p.cash, p.oil, p.science, p.cp, p.research.prog, p.stats.cashEarned, p.stats.kills, p.stats.valueDestroyed, p.stats.unitsLost, p.stats.unitsBuilt] = r;
    TRADES.forEach((k, i) => { if (r[11 + i]) p.market[k] = r[11 + i]; else delete p.market[k]; });
  }
  if (snap.cities) for (const c of snap.cities) s.cities[c.id] = c;
  for (const r of snap.cv ?? []) {
    const c = s.cities[r[0]];
    if (!c) continue;
    c.grow = r[1] / 1000;
    c.cap = r[2] / 1000;
    c.prod.forEach((it, i) => { if (r[3 + i] !== undefined) it.left = r[3 + i]; });
  }
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
