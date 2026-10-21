// Income, supply, Command Points, research, construction and training.
import { UNITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { CITY_LEVELS, SPECS } from '../data/cities';
import { COMMAND } from '../data/powers';
import { LAST_STAND, PRODUCTION, SANDBOX, SUPPLY, VICTORY, WORK_ZONE } from '../data/rules';
import { ERAS, TECHS, TECHS_PER_ERA, TECH_COST, TECH_ESCALATE, ALLY_TECH_DISCOUNT, DOCTRINES, PERKS } from '../data/techs';
import type { Building, City, Ent, MatchState, Player, ProdItem, SimEvent, Unit, WorkZone } from './types';
import { DT, TICK_RATE } from './types';
import { AI_LEVELS } from '../data/ai';
import { buildingMaxHp, distTo, enemies, exileCapital, sec, unitCost } from './world';
import { nearEnemies } from './spatial';
import { hasPerk, modAdd, modMul } from './mods';
import { exitTile, spawnUnit } from './lifecycle';
import { BUILD_REACH, nextOrder } from './move';
import { give, orderMove } from './orders';
import { compOf, nav, nearestPassable, nearestReachable, passable, type Nav } from './nav';

export const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]));

// ---------------------------------------------------------------- supply

interface SupplyCache { tick: number; used: number[]; cap: number[] }
const supplyCache = new WeakMap<MatchState, SupplyCache>();

function supplyInfo(s: MatchState): SupplyCache {
  let c = supplyCache.get(s);
  if (c && c.tick === s.tick) return c;
  c = { tick: s.tick, used: s.players.map(() => 0), cap: s.players.map(() => 0) };
  supplyCache.set(s, c);
  for (const id in s.ents) {
    const e = s.ents[id];
    if (e.owner < 0) continue;
    if (e.t === 'u') c.used[e.owner] += UNITS[e.kind].supply;
    else {
      if (e.built >= 1) c.cap[e.owner] += BUILDINGS[e.kind].supply ?? 0;
      const f = e.prod[0];
      if (f && f.left < f.total) c.used[e.owner] += UNITS[f.kind].supply;
    }
  }
  for (const city of s.cities) {
    if (city.owner < 0) continue;
    c.cap[city.owner] += CITY_LEVELS[city.level - 1].supply + modAdd(s.players[city.owner], 'citySupply');
    const f = city.prod[0];
    if (f && f.left < f.total) c.used[city.owner] += UNITS[f.kind].supply;
  }
  s.players.forEach((p, i) => {
    c!.cap[i] = Math.min(SUPPLY.max, c!.cap[i] + modAdd(p, 'supply'));
    // a last stand keeps a floor to fight with
    if (p.lastStand) c!.cap[i] = Math.max(c!.cap[i], LAST_STAND.supply);
  });
  return c;
}

export function supplyUsed(s: MatchState, p: number): number {
  return supplyInfo(s).used[p];
}
export function supplyCap(s: MatchState, p: number): number {
  return supplyInfo(s).cap[p];
}

// ---------------------------------------------------------------- income

/** Sandbox: human players never run short of anything (SANDBOX); research finishes at once. */
export function stepSandbox(s: MatchState) {
  if (!s.setup.sandbox) return;
  for (const p of s.players) {
    if (p.kind !== 'human') continue;
    p.cash = Math.max(p.cash, SANDBOX.cash);
    p.oil = Math.max(p.oil, SANDBOX.oil);
    p.science = Math.max(p.science, SANDBOX.science);
    p.cp = Math.max(p.cp, COMMAND.max);
  }
}

export function cityIncome(s: MatchState, c: City): { cash: number; science: number; cp: number } {
  if (c.owner < 0 || s.tick < c.calm) return { cash: 0, science: 0, cp: 0 };
  const L = CITY_LEVELS[c.level - 1];
  const p = s.players[c.owner];
  const spec = c.spec ? SPECS[c.spec] : null;
  return {
    cash: L.cash * (spec?.cashMul ?? 1) * modMul(p, 'cityCash') * modMul(p, 'allCash'),
    science: L.science * (spec?.scienceMul ?? 1) * modMul(p, 'cityScience') * modMul(p, 'allScience'),
    cp: (L.cp + (spec?.cp ?? 0)) / 60,
  };
}

export function buildingIncome(s: MatchState, b: Building): { cash: number; oil: number; science: number } {
  const d = BUILDINGS[b.kind];
  if (b.built < 1 || !d.income) return { cash: 0, oil: 0, science: 0 };
  const p = s.players[b.owner];
  let cash = d.income.cash ?? 0, oil = d.income.oil ?? 0, science = d.income.science ?? 0;
  if (b.kind === 'mine') {
    cash *= modMul(p, 'mineIncome');
    if (s.map.deposits[b.dep]?.rich) cash *= 2;
  }
  if (b.kind === 'derrick') oil *= modMul(p, 'derrickIncome');
  return { cash: cash * modMul(p, 'allCash'), oil, science: science * modMul(p, 'allScience') };
}

/** Per-second income of a player (for the HUD and AI). */
export function incomeOf(s: MatchState, p: number): { cash: number; oil: number; science: number; cp: number } {
  const out = { cash: 0, oil: 0, science: 0, cp: 0 };
  // a knocked-out player earns nothing, even from cities their insurgents hold
  if (!s.players[p]?.alive) return out;
  let hq = false;
  for (const id in s.ents) {
    const e = s.ents[id];
    if (e.t !== 'b' || e.owner !== p) continue;
    const inc = buildingIncome(s, e);
    out.cash += inc.cash;
    out.oil += inc.oil;
    out.science += inc.science;
    if (e.kind === 'hq') hq = true;
  }
  for (const c of s.cities) {
    if (c.owner !== p) continue;
    const inc = cityIncome(s, c);
    out.cash += inc.cash;
    out.science += inc.science;
    out.cp += inc.cp;
  }
  if (hq || exileCapital(s, p)) out.cp += COMMAND.hqRate / 60;
  out.cp *= modMul(s.players[p], 'cpRate');
  const ai = s.players[p].kind === 'ai' ? s.setup.players[p]?.ai : undefined;
  if (ai) { const m = AI_LEVELS[ai.difficulty].income; out.cash *= m; out.oil *= m; out.science *= m; }
  return out;
}

export function stepIncome(s: MatchState) {
  for (const p of s.players) {
    if (!p.alive) continue;
    const inc = incomeOf(s, p.id);
    p.cash += inc.cash * DT;
    p.oil += inc.oil * DT;
    p.science += inc.science * DT;
    p.cp = Math.min(COMMAND.max, p.cp + inc.cp * DT);
    p.stats.cashEarned += inc.cash * DT;
  }
}

// ---------------------------------------------------------------- research

export function techCost(s: MatchState, p: Player, id: string): number {
  const t = TECH_BY_ID.get(id)!;
  let c = TECH_COST[id] ?? ERAS[t.era].cost;
  c *= 1 + TECH_ESCALATE * p.techs.filter((k) => TECH_BY_ID.get(k)?.era === t.era).length;
  if (s.players.some((o) => o.id !== p.id && o.team === p.team && o.techs.includes(id))) c *= 1 - ALLY_TECH_DISCOUNT;
  return Math.round(c);
}

/** Why a tech can't be researched now (null = it can). */
export function techBlocked(p: Player, id: string): string | null {
  const t = TECH_BY_ID.get(id);
  if (!t) return 'unknown tech';
  if (p.techs.includes(id)) return 'already researched';
  if (t.era > p.era) return `needs the ${ERAS[t.era].name} era`;
  for (const n of t.needs ?? []) if (!p.techs.includes(n)) return `needs ${TECH_BY_ID.get(n)?.name ?? n}`;
  return null;
}

export function stepResearch(s: MatchState, ev: SimEvent[]) {
  for (const p of s.players) {
    if (!p.alive) continue;
    const r = p.research;
    if (!r.cur) {
      while (r.queue.length && !r.cur) {
        const next = r.queue.shift()!;
        if (!techBlocked(p, next)) { r.cur = next; r.prog = 0; }
      }
      if (!r.cur) continue;
    }
    if (techBlocked(p, r.cur)) { r.cur = null; continue; }
    r.prog += p.science;
    p.science = 0;
    const cost = techCost(s, p, r.cur);
    if (r.prog < cost) continue;
    p.science = r.prog - cost;
    p.techs.push(r.cur);
    ev.push({ e: 'researched', p: p.id, tech: r.cur });
    r.cur = null;
    r.prog = 0;
    // a new era after enough techs of the current one
    const inEra = p.techs.filter((t) => TECH_BY_ID.get(t)?.era === p.era).length;
    if (p.era < ERAS.length - 1 && inEra >= TECHS_PER_ERA) {
      p.era++;
      ev.push({ e: 'era', p: p.id, era: p.era });
      if (DOCTRINES.some((d) => d.era === p.era)) p.doctrinePending = p.era;
    }
  }
}

// ---------------------------------------------------------------- construction & repair

export function stepConstruction(s: MatchState, ev: SimEvent[]) {
  // count Builders working on each building
  const crews = new Map<number, number[]>();
  for (const id in s.ents) {
    const u = s.ents[id];
    if (u.t !== 'u' || u.inside || u.order?.o !== 'build') continue;
    const b = s.ents[u.order.t];
    if (!b || b.t !== 'b') continue;
    if (distTo(b, u.x, u.y) > BUILD_REACH + UNITS[u.kind].radius + 0.05) continue;
    if (!crews.has(b.id)) crews.set(b.id, []);
    crews.get(b.id)!.push(u.id);
  }
  for (const [bid, crew] of crews) {
    const b = s.ents[bid] as Building;
    const d = BUILDINGS[b.kind];
    const p = s.players[b.owner];
    const rate = 1 + PRODUCTION.extraBuilder * (crew.length - 1);
    const max = buildingMaxHp(s, b);
    if (b.built < 1) {
      const dp = (rate / (d.buildTime * TICK_RATE)) * modMul(p, 'buildSpeed');
      b.built = Math.min(1, b.built + dp);
      b.hp = Math.min(max, b.hp + max * 0.9 * dp);
      if (b.built >= 1) {
        ev.push({ e: 'built', id: b.id, kind: b.kind, owner: b.owner });
        for (const uid of crew) nextOrder(s.ents[uid] as never);
        onBuilt(s, b, ev);
      }
    } else if (b.hp < max) {
      if (underFire(s, b)) continue;
      const crewRate = 1 + PRODUCTION.extraBuilder * (Math.min(crew.length, PRODUCTION.repairCrew) - 1);
      const heal = Math.min(max - b.hp, (Math.min(max / PRODUCTION.repairTime, PRODUCTION.repairMaxHps) / TICK_RATE) * crewRate);
      const price = (heal / max) * d.cost.cash * PRODUCTION.repairCost;
      if (p.cash < price) continue;
      p.cash -= price;
      b.hp += heal;
      if (b.hp >= max) for (const uid of crew) nextOrder(s.ents[uid] as never);
    } else {
      for (const uid of crew) nextOrder(s.ents[uid] as never);
    }
  }
}

/** How many of player `p`'s Builders are working on (or walking to) each building, by id. */
export function crewCounts(s: MatchState, p: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const id in s.ents) {
    const u = s.ents[id];
    if (u.t === 'u' && u.owner === p && u.order?.o === 'build') out[u.order.t] = (out[u.order.t] ?? 0) + 1;
  }
  return out;
}

/** Does building `b` reach into this work zone? */
export function inZone(z: WorkZone, b: Ent): boolean {
  return distTo(b, z.x, z.y) <= z.r;
}

/**
 * Busy crews: a human player's idle Builders go to work on their unfinished buildings by
 * themselves, the one with the fewest Builders first (then the nearest), so no project sits
 * unattended while a Builder stands around. The AI places its own crews. A Builder with a work
 * zone (WORK_ZONE) only takes work inside it: see `zoneWork`.
 */
export function stepCrews(s: MatchState) {
  if (s.tick % PRODUCTION.autoEvery) return;
  const sites: Building[][] = s.players.map(() => []);
  const worn: Building[][] = s.players.map(() => []);
  const idle: Unit[][] = s.players.map(() => []);
  const posted: Unit[][] = s.players.map(() => []);
  for (const id in s.ents) {
    const e = s.ents[id];
    if (e.owner < 0) continue;
    if (e.t === 'b') {
      if (e.hp <= 0) continue;
      if (e.built < 1) sites[e.owner].push(e);
      else if (e.hp < buildingMaxHp(s, e)) worn[e.owner].push(e);
    } else if (UNITS[e.kind].builds && !e.inside && !e.order && !e.queue.length && !e.hold) {
      if (e.post) posted[e.owner].push(e);
      else if (s.players[e.owner].kind === 'human') idle[e.owner].push(e);
    }
  }
  const n = nav(s);
  s.players.forEach((p, pi) => {
    if (!posted[pi].length && (!sites[pi].length || !idle[pi].length)) return;
    const crew = crewCounts(s, pi);
    for (const u of posted[pi]) zoneWork(s, n, u, sites[pi], worn[pi], crew);
    if (!sites[pi].length) return;
    for (const u of idle[pi]) {
      const comp = compOf(n, 'ground', Math.floor(u.x), Math.floor(u.y));
      let best: Building | null = null, bk = Infinity;
      for (const b of sites[pi]) {
        const d = Math.hypot(b.x - u.x, b.y - u.y);
        if (d > PRODUCTION.autoRadius) continue;
        const k = (crew[b.id] ?? 0) * 1e4 + d;
        if (k >= bk || !canReach(n, comp, b)) continue;
        bk = k;
        best = b;
      }
      if (!best) continue;
      give(u, { o: 'build', t: best.id }, false);
      crew[best.id] = (crew[best.id] ?? 0) + 1;
    }
  });
}

/** Can a Builder in ground area `comp` walk up to building `b`? */
function canReach(n: Nav, comp: number, b: Building): boolean {
  const near = nearestReachable(n, 'ground', Math.floor(b.x), Math.floor(b.y), comp, Math.ceil(BUILDINGS[b.kind].w / 2) + 2);
  return !!near && distTo(b, near[0] + 0.5, near[1] + 0.5) <= BUILD_REACH + 1;
}

/**
 * An idle Builder with a work zone: it builds the zone's unfinished buildings (fewest Builders
 * first), then repairs its damaged ones (not while under fire); with nothing to do it walks back
 * if it strayed, else rests a while and walks on to the next stop around the zone's edge.
 */
function zoneWork(s: MatchState, n: Nav, u: Unit, sites: Building[], worn: Building[], crew: Record<number, number>) {
  const z = u.post!;
  const comp = compOf(n, 'ground', Math.floor(u.x), Math.floor(u.y));
  const pick = (list: Building[], repair: boolean): Building | null => {
    let best: Building | null = null, bk = Infinity;
    for (const b of list) {
      if (!inZone(z, b)) continue;
      const k = (crew[b.id] ?? 0) * 1e4 + Math.hypot(b.x - u.x, b.y - u.y);
      if (k >= bk || (repair && (crew[b.id] ?? 0) >= PRODUCTION.repairCrew) || !canReach(n, comp, b) || (repair && underFire(s, b))) continue;
      bk = k;
      best = b;
    }
    return best;
  };
  const job = pick(sites, false) ?? pick(worn, true);
  if (job) {
    give(u, { o: 'build', t: job.id }, false);
    crew[job.id] = (crew[job.id] ?? 0) + 1;
    z.wait = 0;
    return;
  }
  if (Math.hypot(u.x - z.x, u.y - z.y) > z.r + 0.5) {
    orderMove(s, [u], z.x, z.y, false, false);
    return;
  }
  // just got here: rest first
  if (!z.wait) { z.wait = s.tick + sec(WORK_ZONE.pause); return; }
  if (s.tick < z.wait) return;
  for (let k = 0; k < WORK_ZONE.points; k++) {
    const a = (z.leg / WORK_ZONE.points) * Math.PI * 2;
    z.leg = (z.leg + 1) % WORK_ZONE.points;
    const x = z.x + Math.cos(a) * z.r * WORK_ZONE.edge, y = z.y + Math.sin(a) * z.r * WORK_ZONE.edge;
    if (!passable(n, 'ground', Math.floor(x), Math.floor(y)) || compOf(n, 'ground', Math.floor(x), Math.floor(y)) !== comp) continue;
    orderMove(s, [u], x, y, false, false);
    z.wait = 0;
    return;
  }
}

/** Is an armed enemy close enough to this building that Builders can't patch it up? */
function underFire(s: MatchState, b: Building): boolean {
  let hit = false;
  nearEnemies(s, b.owner, b.x, b.y, PRODUCTION.repairBlockRadius + BUILDINGS[b.kind].w / 2, (e) => {
    if (hit || e.t !== 'u' || e.owner < 0 || !enemies(s, b.owner, e.owner) || !UNITS[e.kind].weapons.length) return;
    if (Math.hypot(e.x - b.x, e.y - b.y) <= PRODUCTION.repairBlockRadius + BUILDINGS[b.kind].w / 2) hit = true;
  });
  return hit;
}

/** Hooks for buildings that do something when finished. */
function onBuilt(s: MatchState, b: Building, ev: SimEvent[]) {
  if (b.kind === 'launch' && s.setup.victory.science && !s.launch) {
    s.launch = { id: b.id, done: s.tick + sec(VICTORY.launchTime), scrub: 0 };
    ev.push({ e: 'launch', p: b.owner, x: b.x, y: b.y, done: s.launch.done });
  }
}

// ---------------------------------------------------------------- training

function productionSpeed(s: MatchState, owner: number, x: number, y: number): number {
  const p = s.players[owner];
  let m = modMul(p, 'production');
  for (const c of s.cities) {
    if (c.owner !== owner || c.spec !== 'industry') continue;
    const spec = SPECS.industry;
    if (Math.hypot(c.x - x, c.y - y) <= spec.aura!) { m *= 1 + spec.productionAura!; break; }
  }
  const ai = p.kind === 'ai' ? s.setup.players[owner]?.ai : undefined;
  if (ai) m *= AI_LEVELS[ai.difficulty].production;
  return m;
}

function stepQueue(s: MatchState, owner: number, prod: ProdItem[], x: number, y: number, spawn: (kind: string) => void): boolean {
  const f = prod[0];
  if (!f) return false;
  if (f.left === f.total) {
    // starting needs free supply
    if (supplyUsed(s, owner) + UNITS[f.kind].supply > supplyCap(s, owner)) return true;
    supplyInfo(s).used[owner] += UNITS[f.kind].supply;
  }
  f.left -= productionSpeed(s, owner, x, y);
  if (f.left <= 0) {
    prod.shift();
    supplyInfo(s).used[owner] -= UNITS[f.kind].supply; // the unit itself is counted from next tick
    spawn(f.kind);
  }
  return false;
}

export function stepTraining(s: MatchState, ev: SimEvent[]) {
  for (const id in s.ents) {
    const b = s.ents[id];
    if (b.t !== 'b' || b.built < 1 || !b.prod.length) continue;
    b.blocked = stepQueue(s, b.owner, b.prod, b.x, b.y, (kind) => {
      const layer = UNITS[kind].layer;
      const rx = b.rally ? b.rally[0] : b.x, ry = b.rally ? b.rally[1] : b.ty + BUILDINGS[b.kind].h + 2;
      const at = exitTile(s, b, layer, rx, ry);
      if (!at) return;
      const u = spawnUnit(s, kind, b.owner, at[0], at[1]);
      s.players[b.owner].stats.unitsBuilt++;
      massProduction(s, b.owner, kind);
      ev.push({ e: 'trained', id: u.id, kind, owner: b.owner });
      if (b.rally) orderMove(s, [u], b.rally[0], b.rally[1], false, false);
      else if (layer === 'ground') {
        // no rally point: step clear of the door to a spot of its own, so new units don't pile up
        const col = (u.id % PRODUCTION.exitSpread) - (PRODUCTION.exitSpread - 1) / 2;
        const row = Math.floor(u.id / PRODUCTION.exitSpread) % 2;
        orderMove(s, [u], b.x + col, b.ty + BUILDINGS[b.kind].h + PRODUCTION.exitWalk + row, false, false);
      }
    });
  }
  for (const c of s.cities) {
    if (c.owner < 0 || !c.prod.length) continue;
    stepQueue(s, c.owner, c.prod, c.x, c.y, (kind) => {
      const layer = UNITS[kind].layer;
      let at: [number, number] | null = [c.x + 0.5, c.y + 1.5];
      if (layer === 'naval') {
        const n = nav(s);
        const t = nearestPassable(n, 'naval', c.x, c.y, 6);
        at = t ? [t[0] + 0.5, t[1] + 0.5] : null;
      }
      if (!at) return;
      const u = spawnUnit(s, kind, c.owner, at[0], at[1]);
      s.players[c.owner].stats.unitsBuilt++;
      massProduction(s, c.owner, kind);
      ev.push({ e: 'trained', id: u.id, kind, owner: c.owner });
      if (c.rally) orderMove(s, [u], c.rally[0], c.rally[1], false, false);
    });
  }
}

/** Mass Production: every PERKS.freeEvery-th unit is paid back when it comes out. */
function massProduction(s: MatchState, owner: number, kind: string) {
  const p = s.players[owner];
  if (!hasPerk(p, 'freeFourth') || p.stats.unitsBuilt % PERKS.freeEvery !== 0) return;
  const cost = unitCost(s, owner, kind);
  p.cash += cost.cash;
  p.oil += cost.oil;
}

export function newProdItem(kind: string): ProdItem {
  const total = sec(UNITS[kind].buildTime);
  return { kind, left: total, total };
}
