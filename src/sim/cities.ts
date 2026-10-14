// Cities: capture by infantry, contest, growth, specializations, unrest.
import { UNITS } from '../data/units';
import { ASSAULT, CAPTURE, CITY_LEVELS, NEUTRAL_GROWTH, SPECS } from '../data/cities';
import { EXILE, RESISTANCE } from '../data/rules';
import type { City, MatchState, SimEvent } from './types';
import { DT } from './types';
import { allied, exileCapital, fighting, sec, teamOf } from './world';
import { hasPerk, modMul } from './mods';
import { PERKS } from '../data/techs';
import { near } from './spatial';
import { nav, nearestPassable } from './nav';
import { spawnUnit } from './lifecycle';

/** How far from a city's middle infantry capture it (bigger cities reach further). */
export function captureRadius(c: City): number {
  return CAPTURE.radius + CAPTURE.radiusPerLevel * Math.max(0, c.level - 1);
}

/** No unit of a group ordered onto a city stands closer to its middle than this. */
export function assaultHole(c: City): number {
  return ASSAULT.hole + ASSAULT.holePerLevel * Math.max(0, c.level - 1);
}

/** Seconds one infantry takes to capture this city (more infantry go faster). */
export function captureSeconds(s: MatchState, c: City): number {
  const capital = c.owner >= 0 && s.players[c.owner].capital === c.id;
  return (CAPTURE.baseSeconds + CAPTURE.perLevel * (c.level - 1)) * (c.spec ? SPECS[c.spec].captureMul ?? 1 : 1) * (capital ? EXILE.captureMul : 1);
}

const EVERY = 4;

export function stepCities(s: MatchState, ev: SimEvent[]) {
  if (s.tick % EVERY !== 0) return;
  const dt = EVERY * DT;
  for (const c of s.cities) {
    const ground = new Set<number>();
    const infantry = new Map<number, Map<number, number>>(); // team -> player -> count
    near(s, c.x + 0.5, c.y + 0.5, captureRadius(c), (e) => {
      if (e.t !== 'u' || e.inside || e.owner < 0 || !fighting(s, e.owner)) return;
      const d = UNITS[e.kind];
      if (d.layer !== 'ground') return;
      if (Math.hypot(e.x - c.x - 0.5, e.y - c.y - 0.5) > captureRadius(c)) return;
      const team = teamOf(s, e.owner);
      ground.add(team);
      if (!d.captures) return;
      if (!infantry.has(team)) infantry.set(team, new Map());
      const m = infantry.get(team)!;
      m.set(e.owner, (m.get(e.owner) ?? 0) + 1);
    }, 0);
    const ownerTeam = c.owner >= 0 ? teamOf(s, c.owner) : -1;
    const hostile = [...ground].filter((t) => t !== ownerTeam);
    c.contested = hostile.length > 0 && (ground.has(ownerTeam) || hostile.length > 1);
    const capTeams = [...infantry.keys()].filter((t) => t !== ownerTeam);
    // a city taking bids (a supply contract) is under contract: nobody captures it meanwhile
    const bidding = s.contract?.kind === 'supply' && s.contract.city === c.id;
    if (capTeams.length === 1 && hostile.length === 1 && !ground.has(ownerTeam) && !bidding) {
      const team = capTeams[0];
      if (c.capTeam !== team) { c.capTeam = team; c.cap = 0; }
      const byPlayer = infantry.get(team)!;
      let count = 0, best = -1, bestN = -1;
      for (const [p, k] of [...byPlayer].sort((a, b) => a[0] - b[0])) {
        count += k;
        if (k > bestN) { bestN = k; best = p; }
      }
      const time = captureSeconds(s, c);
      c.cap += ((1 + CAPTURE.extraUnit * (Math.min(CAPTURE.maxUnits, count) - 1)) * dt * modMul(s.players[best], 'captureSpeed')) / time;
      c.capBy = best;
      if (c.cap >= 1) capture(s, c, best, ev);
    } else if (!c.contested && c.cap > 0) {
      c.cap = Math.max(0, c.cap - CAPTURE.decay * dt);
      if (c.cap === 0) c.capTeam = -1;
    }
    // a neutral city away from the starts grows on its own while nobody threatens it
    if (c.owner < 0 && hostile.length === 0 && c.level < NEUTRAL_GROWTH.maxLevel
      && s.map.starts.every((st) => Math.hypot(st.x - c.x, st.y - c.y) > NEUTRAL_GROWTH.homeRadius)) {
      c.grow += dt / NEUTRAL_GROWTH.every;
      if (c.grow >= 1) {
        c.grow = 0;
        c.level++;
        ev.push({ e: 'grow', city: c.id, level: c.level, owner: -1 });
      }
    }
    // growth while owned, calm and unthreatened
    if (c.owner >= 0 && hostile.length === 0 && c.level < CITY_LEVELS.length && s.tick >= c.calm) {
      c.grow += (dt / CITY_LEVELS[c.level - 1].grow) * modMul(s.players[c.owner], 'cityGrowth');
      if (c.grow >= 1) {
        c.grow = 0;
        c.level++;
        ev.push({ e: 'grow', city: c.id, level: c.level, owner: c.owner });
        if (c.level >= 2 && !c.spec) c.specPending = true;
      }
    }
  }
}

/** An exiled government raises partisans around its capital. */
export function stepPartisans(s: MatchState) {
  if (s.tick % sec(EXILE.partisanEvery) !== 0) return;
  for (const p of s.players) {
    if (!p.alive || p.capital < 0) continue;
    const c = s.cities[p.capital];
    if (!c || c.owner !== p.id) continue;
    let n = 0;
    near(s, c.x + 0.5, c.y + 0.5, EXILE.partisanRadius, (e) => {
      if (e.t === 'u' && e.owner === p.id && e.kind === EXILE.partisanKind && Math.hypot(e.x - c.x - 0.5, e.y - c.y - 0.5) <= EXILE.partisanRadius) n++;
    }, 0);
    if (n >= EXILE.partisans) continue;
    const t = nearestPassable(nav(s), 'ground', c.x, c.y + 2, 6);
    if (t) spawnUnit(s, EXILE.partisanKind, p.id, t[0] + 0.5, t[1] + 0.5);
  }
}

/** Occupied cities raise partisans for their former owner while the occupier leaves them unguarded. */
export function stepResistance(s: MatchState, ev: SimEvent[]) {
  if (s.tick % sec(RESISTANCE.every) !== 0) return;
  for (const c of s.cities) {
    if (c.resistFor < 0) continue;
    const p = s.players[c.resistFor];
    if (s.tick >= c.resistUntil || !p?.alive || c.owner < 0 || allied(s, c.owner, c.resistFor)) {
      c.resistFor = -1;
      continue;
    }
    if (c.risen >= RESISTANCE.max) continue;
    let guards = 0;
    near(s, c.x + 0.5, c.y + 0.5, captureRadius(c), (e) => {
      if (e.t === 'u' && !e.inside && allied(s, e.owner, c.owner) && UNITS[e.kind].captures && Math.hypot(e.x - c.x - 0.5, e.y - c.y - 0.5) <= captureRadius(c)) guards++;
    }, 0);
    if (guards >= RESISTANCE.garrison) continue;
    const t = nearestPassable(nav(s), 'ground', c.x, c.y + 1, 6);
    if (!t) continue;
    spawnUnit(s, RESISTANCE.kind, c.resistFor, t[0] + 0.5, t[1] + 0.5);
    c.risen++;
    ev.push({ e: 'resist', p: c.resistFor, city: c.id });
  }
}

/** City c changes hands to player `by` (a capture, or a city that joins by contract). */
export function capture(s: MatchState, c: City, by: number, ev: SimEvent[]) {
  const prev = c.owner;
  // taking back your own city is a liberation; taking someone else's starts a resistance
  const liberated = c.resistFor === by;
  const resists = !liberated && prev >= 0 && s.players[prev].alive && !allied(s, prev, by);
  c.resistFor = resists ? prev : -1;
  c.resistUntil = resists ? s.tick + sec(RESISTANCE.time) : 0;
  c.risen = 0;
  // Scientific Method: the archives come with the city
  if (prev >= 0 && hasPerk(s.players[by], 'stealResearch')) {
    const r = s.players[prev].research;
    const take = r.prog * PERKS.stealResearch;
    r.prog -= take;
    s.players[by].science += take;
  }
  c.owner = by;
  if (!s.players[by].held.includes(c.id)) s.players[by].held.push(c.id);
  c.level = Math.max(1, c.level - (prev >= 0 ? CAPTURE.levelLoss : 0));
  c.grow = 0;
  c.cap = 0;
  c.capTeam = -1;
  c.spec = null;
  c.specPending = c.level >= 2;
  c.calm = s.tick + (prev >= 0 ? sec(CAPTURE.unrest) : 0);
  c.prod = [];
  c.rally = null;
  s.players[by].stats.citiesCaptured++;
  ev.push({ e: 'capture', city: c.id, owner: by, prev });
}

/** Can this city train this unit now? */
export function cityTrains(s: MatchState, c: City, kind: string): boolean {
  if (c.owner < 0) return false;
  if (kind === 'builder') return exileCapital(s, c.owner) === c;
  if (kind === 'rifleman') return c.level >= CAPTURE.trainLevel;
  if (kind === 'rocket') return c.level >= CAPTURE.trainLevel && hasPerk(s.players[c.owner], 'cityRockets');
  if (kind === 'patrolboat') return c.spec === 'port';
  return false;
}
