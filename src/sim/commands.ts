// Applying player commands. Every command is checked here (CLAUDE.md rule 2): the sender must own
// what it orders, afford what it buys, and have unlocked it. Bad commands are dropped with a
// 'reject' event so the sender's UI can say why.
import { UNITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { TERRAIN } from '../data/terrain';
import { SPECS } from '../data/cities';
import { DOCTRINES } from '../data/techs';
import { PRODUCTION } from '../data/rules';
import type { Building, Command, MatchState, SimEvent, Unit } from './types';
import { allied, buildingMaxHp, enemies, insurgent, missingBuilding, shortfall, unitCost, unitMaxHp } from './world';
import { dropBlocked, dropPartisans } from './insurgency';
import { bidBlocked, placeBid } from './contracts';
import { placeBuilding, removeEnt } from './lifecycle';
import { give, orderMove } from './orders';
import { techBlocked, newProdItem, crewCounts, TECH_BY_ID } from './economy';
import { cityTrains } from './cities';
import { trainsAt } from './laststand';
import { trade, tradeBlocked } from './exchange';
import { validCommand } from './validate';
import { usePower, useAbility } from './powers';
import { nav, passable, nearestReachable, compOf } from './nav';

export function applyCommand(s: MatchState, c: Command, ev: SimEvent[]) {
  // never trust the shape of a command (it may come from another peer)
  if (!validCommand(c)) return;
  const pl = s.players[c.p];
  if (!pl || s.over) return;
  // a knocked-out player commands only their insurgents (and can give up)
  if (!pl.alive && !(insurgent(s, pl) && INSURGENT_ORDERS.has(c.t))) return;
  const reject = (why: string) => ev.push({ e: 'reject', p: c.p, why });
  const mine = (ids: number[]): Unit[] => {
    const out: Unit[] = [];
    for (const id of ids.slice(0, 400)) {
      const e = s.ents[id];
      if (e && e.t === 'u' && e.owner === c.p && !e.inside) out.push(e);
    }
    return out;
  };
  switch (c.t) {
    case 'move': {
      const us = mine(c.ids);
      for (const u of us) u.dug = false;
      orderMove(s, us, clampX(s, c.x), clampY(s, c.y), !!c.q, !!c.am);
      break;
    }
    case 'attack': {
      const t = s.ents[c.target];
      if (!t || !enemies(s, c.p, t.owner)) return reject('not an enemy');
      for (const u of mine(c.ids)) if (UNITS[u.kind].weapons.length) give(u, { o: 'attack', t: t.id }, !!c.q);
      break;
    }
    case 'stop':
      for (const u of mine(c.ids)) { u.order = null; u.queue = []; u.tgt = 0; u.gx = u.x; u.gy = u.y; u.hold = false; }
      break;
    case 'hold':
      for (const u of mine(c.ids)) { u.order = null; u.queue = []; u.hold = true; u.gx = u.x; u.gy = u.y; u.tgt = 0; }
      break;
    case 'patrol':
      for (const u of mine(c.ids)) give(u, { o: 'patrol', ax: u.x, ay: u.y, bx: clampX(s, c.x), by: clampY(s, c.y), leg: 0 }, false);
      break;
    case 'build': {
      const d = BUILDINGS[c.kind];
      if (!d || d.start) return reject('cannot build that');
      if (d.tech && !pl.techs.includes(d.tech)) return reject(`needs ${TECH_BY_ID.get(d.tech)?.name}`);
      const need = missingBuilding(s, c.p, c.kind);
      if (need) return reject(`build a ${BUILDINGS[need].name} first`);
      const builders = mine(c.ids).filter((u) => UNITS[u.kind].builds);
      if (!builders.length) return reject('no builders');
      const why = placementProblem(s, c.p, c.kind, c.tx, c.ty);
      if (why) return reject(why);
      const short = shortfall(pl, d.cost);
      if (short) return reject(short);
      pl.cash -= d.cost.cash;
      pl.oil -= d.cost.oil;
      const dep = d.on ? s.map.deposits.findIndex((k) => k.x === c.tx && k.y === c.ty && k.kind === d.on) : -1;
      const b = placeBuilding(s, c.kind, c.p, c.tx, c.ty, 0, dep);
      ev.push({ e: 'placed', id: b.id, kind: b.kind, owner: c.p });
      // one Builder per project: the best placed one takes it, and the rest of the selection
      // pitches in only if it has nothing else to do (and not when queueing a row of buildings)
      const lead = leadBuilder(s, c.p, builders, b.x, b.y, !!c.q);
      give(lead.u, { o: 'build', t: b.id }, lead.q);
      if (!c.q) for (const u of builders) if (u !== lead.u && !u.order && !u.queue.length) give(u, { o: 'build', t: b.id }, false);
      break;
    }
    case 'assist': {
      const b = s.ents[c.target];
      if (!b || b.t !== 'b' || !allied(s, c.p, b.owner)) return reject('nothing to build there');
      for (const u of mine(c.ids)) if (UNITS[u.kind].builds) give(u, { o: 'build', t: b.id }, !!c.q);
      break;
    }
    case 'train': {
      const d = UNITS[c.kind];
      if (!d) return reject('unknown unit');
      if (d.tech && !pl.techs.includes(d.tech)) return reject(`needs ${TECH_BY_ID.get(d.tech)?.name}`);
      let prod;
      if (c.city) {
        const city = s.cities[c.at];
        if (!city || city.owner !== c.p || !cityTrains(s, city, c.kind)) return reject('this city cannot train that');
        prod = city.prod;
      } else {
        const b = s.ents[c.at];
        if (!b || b.t !== 'b' || b.owner !== c.p || b.built < 1 || !trainsAt(s, b, c.kind)) return reject('cannot train that here');
        prod = b.prod;
      }
      const cost = unitCost(s, c.p, c.kind);
      const n = Math.max(1, Math.min(PRODUCTION.queueMax, c.n | 0));
      for (let i = 0; i < n; i++) {
        if (prod.length >= PRODUCTION.queueMax) break;
        if (pl.cash < cost.cash || pl.oil < cost.oil) { if (i === 0) reject(shortfall(pl, cost)!); break; }
        pl.cash -= cost.cash;
        pl.oil -= cost.oil;
        prod.push(newProdItem(c.kind));
      }
      break;
    }
    case 'cancelTrain': {
      const prod = c.city ? (s.cities[c.at]?.owner === c.p ? s.cities[c.at].prod : null) : ownedBuilding(s, c.p, c.at)?.prod;
      if (!prod || c.index < 0 || c.index >= prod.length) return;
      const [item] = prod.splice(c.index, 1);
      const cost = unitCost(s, c.p, item.kind);
      pl.cash += cost.cash * PRODUCTION.cancelRefund;
      pl.oil += cost.oil * PRODUCTION.cancelRefund;
      break;
    }
    case 'rally': {
      const x = clampX(s, c.x), y = clampY(s, c.y);
      if (c.city) { const city = s.cities[c.at]; if (city?.owner === c.p) city.rally = [x, y]; }
      else { const b = ownedBuilding(s, c.p, c.at); if (b) b.rally = [x, y]; }
      break;
    }
    case 'cancelBuild': {
      const b = ownedBuilding(s, c.p, c.id);
      if (!b || b.built >= 1) return;
      const d = BUILDINGS[b.kind];
      pl.cash += d.cost.cash * PRODUCTION.buildCancelRefund;
      pl.oil += d.cost.oil * PRODUCTION.buildCancelRefund;
      b.hp = 0;
      break;
    }
    case 'sell': {
      const b = ownedBuilding(s, c.p, c.id);
      if (!b || b.built < 1 || b.kind === 'hq') return;
      const d = BUILDINGS[b.kind];
      pl.cash += d.cost.cash * PRODUCTION.sellRefund;
      b.hp = 0;
      break;
    }
    case 'trade': {
      const why = tradeBlocked(s, pl, c.trade);
      if (why) return reject(why);
      trade(s, pl, c.trade);
      break;
    }
    case 'research': {
      const why = techBlocked(pl, c.tech);
      if (why) return reject(why);
      if (pl.research.cur === c.tech || pl.research.queue.includes(c.tech)) return;
      // a new order starts now only when nothing is waiting (between techs `cur` is briefly empty
      // while the queue still holds the next one, and a new order must not jump ahead of it)
      if (!pl.research.cur && !pl.research.queue.length) { pl.research.cur = c.tech; pl.research.prog = 0; }
      else if (pl.research.queue.length < 5) pl.research.queue.push(c.tech);
      break;
    }
    case 'cancelResearch': {
      const r = pl.research;
      if (c.index === -1 && r.cur) { pl.science += r.prog; r.cur = null; r.prog = 0; }
      else if (c.index >= 0 && c.index < r.queue.length) r.queue.splice(c.index, 1);
      break;
    }
    case 'doctrine': {
      const d = DOCTRINES.find((k) => k.id === c.id);
      if (!d || pl.doctrinePending !== d.era) return reject('no doctrine choice waiting');
      pl.doctrines.push(d.id);
      pl.doctrinePending = 0;
      // a doctrine that lowers max HP (Blitz's buildings, say) brings everything down to it
      for (const id in s.ents) {
        const e = s.ents[id];
        if (e.owner === c.p) e.hp = Math.min(e.hp, e.t === 'u' ? unitMaxHp(s, e) : buildingMaxHp(s, e));
      }
      break;
    }
    case 'spec': {
      const city = s.cities[c.city];
      const spec = SPECS[c.spec];
      if (!city || city.owner !== c.p || !city.specPending || !spec) return reject('cannot specialize that city');
      if (spec.coastal && !city.coastal) return reject('that city is not on the coast');
      city.spec = c.spec;
      city.specPending = false;
      if (spec.guns) city.cd = [0];
      break;
    }
    case 'ability': {
      for (const u of mine(c.ids)) useAbility(s, u, c.x ?? u.x, c.y ?? u.y, ev);
      break;
    }
    case 'power': {
      const why = usePower(s, c.p, c.power, c.x ?? -1, c.y ?? -1, ev);
      if (why) reject(why);
      break;
    }
    case 'load': {
      const t = s.ents[c.target];
      if (!t || t.t !== 'u' || t.owner !== c.p || !UNITS[t.kind].carries) return reject('not a transport');
      for (const u of mine(c.ids)) if (UNITS[u.kind].layer === 'ground') give(u, { o: 'load', t: t.id }, false);
      break;
    }
    case 'unload': {
      const n = nav(s);
      for (const u of mine(c.ids)) {
        if (!u.cargo.length) continue;
        // sail to the water tile nearest the drop point
        const g = nearestReachable(n, 'naval', Math.floor(c.x), Math.floor(c.y), compOf(n, 'naval', Math.floor(u.x), Math.floor(u.y)));
        if (!g) continue;
        give(u, { o: 'unload', x: clampX(s, c.x), y: clampY(s, c.y), gx: g[0], gy: g[1] }, false);
      }
      break;
    }
    case 'gift': {
      const to = s.players[c.to];
      if (!to || !to.alive || to.id === c.p || to.team !== pl.team) return reject('can only send to allies');
      const cash = Math.max(0, Math.min(pl.cash, c.cash)), oil = Math.max(0, Math.min(pl.oil, c.oil));
      pl.cash -= cash; pl.oil -= oil; to.cash += cash; to.oil += oil;
      break;
    }
    case 'surrender':
      pl.surrendered = true;
      // an insurgent who gives up leaves the field (a player in the match is removed by stepVictory)
      if (!pl.alive) for (const e of Object.values(s.ents)) if (e.owner === c.p) removeEnt(s, e, ev);
      break;
    case 'contract': {
      const city = s.cities[c.city];
      const bid = Math.round(c.bid);
      const why = bidBlocked(s, pl, city, bid);
      if (why) return reject(why);
      placeBid(s, pl, city, bid, ev);
      break;
    }
    case 'insurge': {
      const city = s.cities[c.city];
      const why = dropBlocked(s, pl, city);
      if (why) return reject(why);
      dropPartisans(s, pl, city, ev);
      break;
    }
  }
}

/** the commands an insurgent may give */
const INSURGENT_ORDERS = new Set<Command['t']>(['move', 'attack', 'stop', 'hold', 'patrol', 'ability', 'insurge', 'surrender']);

function ownedBuilding(s: MatchState, p: number, id: number): Building | undefined {
  const b = s.ents[id];
  return b && b.t === 'b' && b.owner === p ? b : undefined;
}

const clampX = (s: MatchState, x: number) => Math.max(0.5, Math.min(s.map.w - 0.5, +x || 0));
const clampY = (s: MatchState, y: number) => Math.max(0.5, Math.min(s.map.h - 0.5, +y || 0));

/**
 * Why a building can't go at (tx, ty) for player p (null = it can). Shared by the sim, the
 * placement ghost in the UI, and the AI.
 */
export function placementProblem(s: MatchState, p: number, kind: string, tx: number, ty: number): string | null {
  const d = BUILDINGS[kind];
  if (!d) return 'unknown building';
  tx |= 0;
  ty |= 0;
  if (tx < 1 || ty < 1 || tx + d.w > s.map.w - 1 || ty + d.h > s.map.h - 1) return 'off the map';
  const n = nav(s);
  if (d.on) {
    const dep = s.map.deposits.find((k) => k.x === tx && k.y === ty && k.kind === d.on);
    if (!dep) return d.on === 'ore' ? 'must be built on ore' : 'must be built on an oil well';
  }
  for (let y = ty; y < ty + d.h; y++)
    for (let x = tx; x < tx + d.w; x++) {
      const t = s.map.terrain[y * s.map.w + x];
      if (!TERRAIN[t].buildable) return 'cannot build on ' + TERRAIN[t].name.toLowerCase();
      if (n.occ[y * s.map.w + x]) return 'something is in the way';
      if (!d.on && s.map.deposits.some((k) => x >= k.x && x < k.x + 2 && y >= k.y && y < k.y + 2)) return 'keep deposits free';
    }
  for (const c of s.cities) if (Math.max(Math.abs(c.x + 0.5 - (tx + d.w / 2)) - d.w / 2, Math.abs(c.y + 0.5 - (ty + d.h / 2)) - d.h / 2) < 2.5) return 'too close to a city';
  if (d.coastal) {
    let wet = false;
    for (let y = ty - 1; y <= ty + d.h && !wet; y++)
      for (let x = tx - 1; x <= tx + d.w; x++) if (passable(n, 'naval', x, y)) { wet = true; break; }
    if (!wet) return 'must touch water';
  }
  // enemy units standing on the spot block it; your own get pushed aside
  for (const id in s.ents) {
    const e = s.ents[id];
    if (e.t !== 'u' || e.inside || allied(s, e.owner, p) || UNITS[e.kind].layer !== 'ground') continue;
    if (e.x > tx && e.x < tx + d.w && e.y > ty && e.y < ty + d.h) return 'enemies in the way';
  }
  return null;
}

/**
 * Which of the selected Builders takes a new building: an idle one first, then one whose current
 * project already has company (it moves over now), then the least busy (queued behind its work
 * when the player queued the order). Nearest wins a tie.
 */
function leadBuilder(s: MatchState, p: number, builders: Unit[], x: number, y: number, queue: boolean): { u: Unit; q: boolean } {
  const crew = crewCounts(s, p);
  let best: { u: Unit; q: boolean } | null = null, bk = Infinity;
  for (const u of builders) {
    const shared = u.order?.o === 'build' && !u.queue.length ? crew[u.order.t] ?? 0 : 0;
    const tier = !u.order && !u.queue.length ? 0 : shared > 1 ? 1 : 2;
    const pending = (u.order ? 1 : 0) + u.queue.length;
    const k = tier * 1e6 + (tier === 1 ? -shared : tier === 2 ? pending : 0) * 1e4 + Math.hypot(u.x - x, u.y - y);
    if (k < bk) { bk = k; best = { u, q: tier === 2 && queue }; }
  }
  return best!;
}

