// Elimination and the win conditions: conquest, supremacy, science, time limit (GAME_DESIGN §9).
import { COALITION, EXILE, INSURGENCY, SCRUB, VICTORY } from '../data/rules';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { COMMAND } from '../data/powers';
import type { City, MatchSetup, MatchState, Player, SimEvent } from './types';
import { TICK_RATE } from './types';
import { removeEnt, armyValue } from './lifecycle';
import { enemies, hqOf, sec } from './world';
import { startLaunch } from './economy';
import { near } from './spatial';

/** The share of all cities that wins by supremacy in this match (smaller with more teams). */
export function supremacyShare(s: MatchState): number {
  const teams = new Set(s.players.map((p) => p.team)).size;
  if (teams === 2 && s.players.length >= VICTORY.teamShareFrom) return VICTORY.teamShare;
  const t = VICTORY.supremacyShares;
  return t[Math.min(teams, t.length - 1)];
}

/** The second from which the supremacy clock can start in this match (later with more teams or players). */
export function supremacyFrom(s: MatchState): number {
  const teams = new Set(s.players.map((p) => p.team)).size;
  return VICTORY.supremacyFrom + Math.max(VICTORY.supremacyFromPerTeam * Math.max(0, teams - 2), VICTORY.supremacyFromPerPlayer * Math.max(0, s.players.length - 2));
}

/** Scrub: enemy infantry at the Launch Site with no defending infantry there delay the launch. */
function stepScrub(s: MatchState, ev: SimEvent[]) {
  const l = s.launch!, site = s.ents[l.id];
  if (!site) return;
  const r = BUILDINGS[site.kind].w / 2 + SCRUB.radius;
  const team = s.players[site.owner].team;
  let by = -1, guarded = false;
  near(s, site.x, site.y, r, (e) => {
    if (e.t !== 'u' || e.owner < 0 || !UNITS[e.kind].captures || e.inside) return;
    if (Math.max(Math.abs(e.x - site.x), Math.abs(e.y - site.y)) > r) return;
    if (s.players[e.owner].team === team) guarded = true;
    else if (enemies(s, site.owner, e.owner) && (by < 0 || e.owner < by)) by = e.owner;
  });
  if (by < 0) { l.scrub = 0; return; }
  if (guarded) return;
  l.scrub += TICK_RATE;
  if (l.scrub < sec(SCRUB.time)) return;
  l.scrub = 0;
  l.done += sec(SCRUB.delay);
  ev.push({ e: 'scrub', p: site.owner, by, x: site.x, y: site.y, done: l.done });
}

/** Who everyone else should gang up on: a team with a launch going, else one racing for supremacy. */
function leader(s: MatchState): number {
  if (s.launch) {
    const site = s.ents[s.launch.id];
    if (site) return s.players[site.owner].team;
  }
  let best = -1, since = Infinity;
  for (const [team, t] of Object.entries(s.supremacy)) if (t >= 0 && t < since) { since = t; best = +team; }
  return best;
}

/** Coalition: the rest of the world turns on whoever is about to win. */
export function stepCoalition(s: MatchState, ev: SimEvent[]) {
  if (s.over) return;
  const team = leader(s);
  if (team === s.coalition) return;
  s.coalition = team;
  if (team >= 0) for (const p of s.players) if (p.alive && p.team !== team) p.cp = Math.min(COMMAND.max, p.cp + COALITION.cp);
  ev.push({ e: 'coalition', team });
}

export function score(s: MatchState, team: number): number {
  let v = 0;
  for (const p of s.players) {
    if (p.team !== team) continue;
    v += p.techs.length * 50 + p.stats.valueDestroyed / 10 + armyValue(s, p.id) / 10;
  }
  for (const c of s.cities) if (c.owner >= 0 && s.players[c.owner].team === team) v += 100 * c.level;
  return Math.round(v);
}

/**
 * The city an HQ-less player governs from: the current capital while it qualifies, else the
 * largest one out of the attackers' reach (else the largest, farthest from them).
 */
function capitalFor(s: MatchState, p: Player): City | undefined {
  const ok = (c: City | undefined) => !!c && c.owner === p.id && c.level >= EXILE.minLevel;
  if (p.capital >= 0 && ok(s.cities[p.capital])) return s.cities[p.capital];
  const list = s.cities.filter(ok);
  if (list.length < 2) return list[0];
  // how far each city is from the nearest enemy fighting unit
  const far = new Map<number, number>();
  for (const c of list) far.set(c.id, Infinity);
  for (const id in s.ents) {
    const e = s.ents[id];
    if (e.t !== 'u' || e.owner < 0 || !enemies(s, p.id, e.owner) || !UNITS[e.kind].weapons.length) continue;
    for (const c of list) far.set(c.id, Math.min(far.get(c.id)!, Math.hypot(e.x - c.x, e.y - c.y)));
  }
  const safe = (c: City) => (far.get(c.id)! > EXILE.safeRadius ? 1 : 0);
  return list.sort((a, b) => safe(b) - safe(a) || b.level - a.level || far.get(b.id)! - far.get(a.id)! || b.grow - a.grow || a.id - b.id)[0];
}

export function stepVictory(s: MatchState, ev: SimEvent[]) {
  if (s.over) return;
  // eliminate players whose HQ fell (or who surrendered)
  for (const p of s.players) {
    if (!p.alive) continue;
    if (!p.surrendered && hqOf(s, p.id)) continue;
    // government in exile: the largest city carries on
    const cap = p.surrendered ? undefined : capitalFor(s, p);
    if (cap) {
      if (p.capital !== cap.id) {
        p.capital = cap.id;
        p.capitalAt = s.tick + sec(EXILE.delay);
        ev.push({ e: 'exile', p: p.id, city: cap.id });
      }
      continue;
    }
    p.alive = false;
    p.capital = -1;
    // Insurgency: the fight goes on from outside
    p.insurgeAt = s.tick + sec(INSURGENCY.first);
    p.rising = -1;
    for (const id of Object.keys(s.ents)) {
      const e = s.ents[+id];
      if (e && e.owner === p.id) removeEnt(s, e, ev);
    }
    for (const c of s.cities) if (c.owner === p.id) { c.owner = -1; c.prod = []; c.spec = null; c.specPending = false; }
    p.research.cur = null;
    p.research.queue = [];
    ev.push({ e: 'eliminated', p: p.id });
  }
  const allTeams = new Set(s.players.map((p) => p.team));
  const alive = new Set(s.players.filter((p) => p.alive).map((p) => p.team));
  const end = (winners: number, reason: string) => {
    s.over = { winners, reason, tick: s.tick };
    ev.push({ e: 'over', winners, reason });
  };
  if (alive.size === 0) return end(-1, 'draw');
  if (allTeams.size > 1 && alive.size === 1) return end([...alive][0], 'conquest');

  // supremacy: hold most of the cities for a while
  if (s.setup.victory.supremacy && s.cities.length && s.tick % TICK_RATE === 0 && s.tick >= sec(supremacyFrom(s))) {
    for (const team of alive) {
      const held = s.cities.filter((c) => c.owner >= 0 && s.players[c.owner].team === team).length;
      if (held / s.cities.length >= supremacyShare(s) && allTeams.size > 1) {
        if ((s.supremacy[team] ?? -1) < 0) s.supremacy[team] = s.tick;
        else if (s.tick - s.supremacy[team] >= sec(VICTORY.supremacyTime)) return end(team, 'supremacy');
      } else s.supremacy[team] = -1;
    }
  }
  // science: the launch completes (unless saboteurs keep scrubbing it)
  if (s.launch && s.tick % TICK_RATE === 0) stepScrub(s, ev);
  if (s.launch && s.tick >= s.launch.done) {
    const site = s.ents[s.launch.id];
    if (site) return end(s.players[site.owner].team, 'science');
    s.launch = null;
  }
  // a site that finished while another countdown ran starts its own once that one is over
  if (!s.launch && s.setup.victory.science && s.tick % TICK_RATE === 0) {
    for (const id in s.ents) {
      const b = s.ents[id];
      if (b.t === 'b' && b.kind === 'launch' && b.built >= 1 && b.hp > 0) { startLaunch(s, b, ev); break; }
    }
  }
  // time limit: best score
  const limit = timeLimitOf(s.setup);
  if (limit > 0 && s.tick >= sec(limit)) {
    let best = -1, bs = -Infinity;
    for (const team of [...alive].sort((a, b) => a - b)) {
      const sc = score(s, team);
      if (sc > bs) { bs = sc; best = team; }
    }
    return end(best, 'time');
  }
}

/** A match's time limit in seconds (0 = none), with 'Auto' (-1) settled by its size and map. */
export function timeLimitOf(setup: MatchSetup): number {
  if (setup.timeLimit >= 0) return setup.timeLimit;
  const big = setup.players.length >= VICTORY.autoLimitPlayers || VICTORY.autoLimitMaps.includes(setup.mapType);
  if (big) return VICTORY.autoLimit;
  return new Set(setup.players.map((p) => p.team)).size >= VICTORY.autoLimitTeams ? VICTORY.autoLimitLong : 0;
}
