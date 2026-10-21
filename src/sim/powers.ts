// Command Powers, unit abilities, timed effects, and supply crates.
import { UNITS, ABILITIES } from '../data/units';
import { POWERS, STRIKE, SUPPLY_DROP, PARADROP, FIELD_REPAIR, COMMAND, type PowerId } from '../data/powers';
import { CRATES, HOME_FRONT } from '../data/rules';
import { AUTO_DIG_EVERY, PERKS } from '../data/techs';
import { hasPerk } from './mods';
import type { MatchState, Player, SimEvent, Unit } from './types';
import { TICK_RATE } from './types';
import { incomes } from './economy';
import { sec, teamOf, maxHp, enemies } from './world';
import { rand, randRange } from './rng';
import { land } from './combat';
import { tileVisible } from './vision';
import { claims, onHomeGround } from './territory';
import { spawnUnit } from './lifecycle';
import { nav, passable, nearestPassable } from './nav';
import { near } from './spatial';
import { nextOrder } from './move';

/** Use a Command Power. Returns an error message, or null when it worked. */
/** What a power costs this player (Networked Warfare makes them cheaper). */
export function powerCost(pl: Player, id: PowerId): number {
  const c = POWERS[id].cost;
  return hasPerk(pl, 'cheapPowers') ? Math.max(1, c - PERKS.powerDiscount) : c;
}

export function usePower(s: MatchState, p: number, id: PowerId, x: number, y: number, ev: SimEvent[]): string | null {
  const def = POWERS[id];
  const pl = s.players[p];
  if (!def) return 'unknown power';
  if (pl.era < def.era) return 'not available yet';
  if (pl.cp < powerCost(pl, id)) return 'not enough Command Points';
  if ((pl.powerReady[id] ?? 0) > s.tick) return 'still recharging';
  if (def.targeted && (x < 0 || y < 0 || x >= s.map.w || y >= s.map.h)) return 'bad target';
  if (def.needsVision && !tileVisible(s, pl.team, x, y)) return 'you need to see the target';
  const team = pl.team;
  switch (id) {
    case 'recon':
      s.effects.push({ k: 'reveal', team, owner: p, x, y, r: def.radius!, until: s.tick + sec(def.duration!) });
      break;
    case 'supplyDrop':
      pl.cash += supplyDropCash(s, p);
      pl.oil += SUPPLY_DROP.oil;
      break;
    case 'repair':
      near(s, x, y, def.radius!, (e) => {
        if (e.owner !== p || Math.hypot(e.x - x, e.y - y) > def.radius!) return;
        if (e.t === 'b' && e.built < 1) return;
        const m = maxHp(s, e);
        e.hp = Math.min(m, e.hp + m * FIELD_REPAIR);
      });
      break;
    case 'rally':
      s.effects.push({ k: 'rally', team, owner: p, x, y, r: def.radius!, until: s.tick + sec(def.duration!) });
      break;
    case 'help':
      if (!s.players.some((o) => o.id !== p && o.alive && o.team === team)) return 'you have no allies';
      s.effects.push({ k: 'help', team, owner: p, x, y, r: def.radius!, until: s.tick + sec(def.duration!) });
      break;
    case 'strike':
      s.effects.push({ k: 'strike', team, owner: p, x, y, r: def.radius!, until: s.tick + sec(STRIKE.delay + 1), at: s.tick + sec(STRIKE.delay) });
      break;
    case 'paradrop': {
      const n = nav(s);
      for (let i = 0; i < PARADROP.count; i++) {
        const a = (i / PARADROP.count) * Math.PI * 2;
        const t = nearestPassable(n, 'ground', Math.floor(x + Math.cos(a) * 1.2), Math.floor(y + Math.sin(a) * 1.2), 6);
        if (!t) continue;
        spawnUnit(s, PARADROP.unit, p, t[0] + 0.5, t[1] + 0.5, true);
      }
      break;
    }
  }
  pl.cp -= powerCost(pl, id);
  pl.powerReady[id] = s.tick + sec(def.cooldown);
  ev.push({ e: 'power', p, power: id, x, y });
  return null;
}

/** Entrenchment, and Home Front: idle infantry dig in by themselves (everywhere with the perk, on home ground for all). */
export function stepAutoDig(s: MatchState) {
  if (s.tick % sec(AUTO_DIG_EVERY) !== 0) return;
  const cl = claims(s);
  for (const id in s.ents) {
    const u = s.ents[id];
    if (u.t !== 'u' || u.dug || u.order || u.mv || u.inside || u.queue.length || UNITS[u.kind].ability !== 'digIn') continue;
    const p = s.players[u.owner];
    if (hasPerk(p, 'autoDig') || (HOME_FRONT.dig && onHomeGround(s, p.team, u.x, u.y, cl))) u.dug = true;
  }
}

/** Use the selected units' ability. */
export function useAbility(s: MatchState, u: Unit, x: number, y: number, ev: SimEvent[]): boolean {
  const ab = UNITS[u.kind].ability;
  if (!ab || s.tick < u.abReady) return false;
  const def = ABILITIES[ab];
  const team = teamOf(s, u.owner);
  switch (ab) {
    case 'digIn':
      u.dug = !u.dug;
      if (u.dug) { u.order = null; u.queue = []; nextOrder(u); }
      break;
    case 'flare': {
      // fired at the target point, up to 12 tiles away
      const d = Math.hypot(x - u.x, y - u.y);
      const k = d > 12 ? 12 / d : 1;
      s.effects.push({ k: 'reveal', team, owner: u.owner, x: u.x + (x - u.x) * k, y: u.y + (y - u.y) * k, r: def.radius!, until: s.tick + sec(def.duration) });
      break;
    }
    case 'smoke':
      s.effects.push({ k: 'smoke', team, owner: u.owner, x: u.x, y: u.y, r: def.radius!, until: s.tick + sec(def.duration) });
      break;
    case 'sonar':
      s.effects.push({ k: 'reveal', team, owner: u.owner, x: u.x, y: u.y, r: def.radius!, until: s.tick + sec(def.duration) });
      break;
    case 'barrage':
    case 'afterburner':
    case 'steamroll':
    case 'carpet':
      u.abUntil = s.tick + sec(def.duration);
      break;
  }
  u.abReady = s.tick + sec(def.cooldown);
  ev.push({ e: 'ability', id: u.id, owner: u.owner, ab, x: u.x, y: u.y });
  return true;
}

/** Expire effects and land artillery strikes. */
export function stepEffects(s: MatchState, ev: SimEvent[]) {
  for (const fx of s.effects) {
    if (fx.k === 'strike' && fx.at !== undefined && s.tick === fx.at) {
      for (let i = 0; i < STRIKE.shells; i++) {
        const a = rand(s) * Math.PI * 2, r = Math.sqrt(rand(s)) * fx.r;
        land(s, fx.x + Math.cos(a) * r, fx.y + Math.sin(a) * r, STRIKE.dmg, STRIKE.splash, 'shell', ['ground', 'naval'], fx.owner, undefined, 0, ev);
      }
    }
  }
  if (s.effects.some((fx) => fx.until <= s.tick)) s.effects = s.effects.filter((fx) => fx.until > s.tick);
}

/** What a supply drop would pay player p right now (lend-lease: more the further behind they are). */
export function supplyDropCash(s: MatchState, p: number): number {
  const all = incomes(s);
  const mine = all[p].cash;
  let top = 0;
  for (const o of s.players) if (o.alive && enemies(s, p, o.id)) top = Math.max(top, all[o.id].cash);
  const gap = Math.max(0, top - mine) * SUPPLY_DROP.gapSeconds;
  return Math.round(Math.min(SUPPLY_DROP.maxCash, SUPPLY_DROP.minCash + gap));
}

/** Supply crates: drop one now and then; the first unit to touch it takes it. */
export function stepCrates(s: MatchState, ev: SimEvent[]) {
  if (!s.setup.crates) return;
  if (s.tick >= s.nextCrate) {
    s.nextCrate = s.tick + sec(randRange(s, ...CRATES.every));
    if (s.crates.length < CRATES.max) dropCrate(s, ev);
  }
  if (s.tick % 5 !== 0) return;
  for (const c of [...s.crates]) {
    let taker: Unit | undefined;
    near(s, c.x, c.y, 0.9, (e) => {
      if (taker || e.t !== 'u' || e.inside || e.owner < 0 || UNITS[e.kind].layer === 'air') return;
      if (Math.hypot(e.x - c.x, e.y - c.y) <= 0.9) taker = e;
    }, 0);
    if (!taker) {
      if (s.tick >= c.until) s.crates = s.crates.filter((k) => k !== c);
      continue;
    }
    const r = CRATES.rewards[c.reward];
    const p = s.players[taker.owner];
    // crates grow with the match so they still matter later
    const amount = Math.round(r.amount * (1 + CRATES.scalePerMin * (s.tick / TICK_RATE / 60)));
    if (r.kind === 'cash') p.cash += amount;
    else if (r.kind === 'oil') p.oil += amount;
    else if (r.kind === 'science') p.science += amount;
    else if (r.kind === 'cp') p.cp = Math.min(COMMAND.max, p.cp + r.amount);
    else if (r.kind === 'veteran' && taker.vet < 3) {
      taker.vet++;
      taker.xp = Math.max(taker.xp, [0, 1, 3, 6][taker.vet]);
      ev.push({ e: 'vet', id: taker.id, owner: taker.owner, stars: taker.vet });
    }
    s.crates = s.crates.filter((k) => k !== c);
    ev.push({ e: 'crate', id: c.id, x: c.x, y: c.y, p: taker.owner, reward: r.kind, amount: r.kind === 'cash' || r.kind === 'oil' || r.kind === 'science' ? amount : r.amount });
  }
}

function dropCrate(s: MatchState, ev: SimEvent[]) {
  const n = nav(s);
  const { w, h } = s.map;
  for (let tries = 0; tries < 40; tries++) {
    // crates favor the middle of the map, where the fighting is
    const a = rand(s) * Math.PI * 2, d = Math.sqrt(rand(s)) * w * 0.38;
    const x = Math.floor(w / 2 + Math.cos(a) * d), y = Math.floor(h / 2 + Math.sin(a) * d);
    if (!passable(n, 'ground', x, y)) continue;
    if (s.map.starts.some((st) => Math.hypot(st.x - x, st.y - y) < 18)) continue;
    let total = 0;
    for (const r of CRATES.rewards) total += r.weight;
    let roll = rand(s) * total, reward = 0;
    for (let i = 0; i < CRATES.rewards.length; i++) {
      roll -= CRATES.rewards[i].weight;
      if (roll <= 0) { reward = i; break; }
    }
    const crate = { id: s.nextId++, x: x + 0.5, y: y + 0.5, reward, until: s.tick + sec(240) };
    s.crates.push(crate);
    ev.push({ e: 'crateDrop', id: crate.id, x: crate.x, y: crate.y });
    return;
  }
}
