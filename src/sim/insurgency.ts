// Insurgency (our twist, GAME_DESIGN §9): a player knocked out of a match that goes on keeps
// fighting. They drop squads of partisans at neutral cities or cities they once held, and they
// come back into the match by holding a big enough city for a while.
import { INSURGENCY } from '../data/rules';
import { CAPTURE } from '../data/cities';
import { UNITS } from '../data/units';
import { DAMAGE } from '../data/damage';
import type { City, MatchState, Player, SimEvent, Unit } from './types';
import { TICK_RATE } from './types';
import { allied, insurgent, sec } from './world';
import { nav, nearestPassable } from './nav';
import { spawnUnit } from './lifecycle';
import { captureRadius, captureSeconds } from './cities';
import { near } from './spatial';
import { cityGun } from './combat';

/** How many drop charges player p has banked now (0 while the next is on its way). */
export function charges(s: MatchState, p: Player): number {
  if (!insurgent(s, p) || s.tick < p.insurgeAt) return 0;
  return Math.min(INSURGENCY.maxCharges, 1 + Math.floor((s.tick - p.insurgeAt) / sec(INSURGENCY.every)));
}

/** How many war-chest troopers player p's drop of `n` squads brings (one per squad while the cash lasts). */
export function chestTroops(p: Player, n: number): number {
  return Math.max(0, Math.min(n, Math.floor(p.cash / INSURGENCY.chestCost)));
}

/**
 * How much of city c's capture bar `n` fresh squads of partisans (and `extra` war-chest troopers)
 * of player p would fill before the city's guns, and p's enemies' ground units standing in its
 * ring, shoot them all down (1 or more: they take it). An estimate for the UI and the AI: it
 * leaves out veterancy and perks, and the partisans' own fire.
 */
export function squadProgress(s: MatchState, c: City, n = 1, extra = 0, p = -1): number {
  const gun = cityGun(s, c);
  const time = captureSeconds(s, c);
  // the enemy units in the ring: they contest the capture (no head start) and shoot too
  const guards: Unit[] = [];
  const r = captureRadius(c);
  if (p >= 0) near(s, c.x + 0.5, c.y + 0.5, r, (e) => {
    if (e.t !== 'u' || e.inside || e.owner === p || allied(s, e.owner, p) || UNITS[e.kind].layer !== 'ground') return;
    if (Math.hypot(e.x - c.x - 0.5, e.y - c.y - 0.5) <= r) guards.push(e);
  }, 0);
  const fire = (kind: string) => {
    const d = UNITS[kind];
    let dps = gun && gun.hits.includes(d.layer) ? (gun.dmg * DAMAGE[gun.cls][d.armor]) / gun.cd : 0;
    for (const g of guards) for (const w of UNITS[g.kind].weapons) if (w.hits.includes(d.layer)) dps += (w.dmg * DAMAGE[w.cls][d.armor]) / w.cd;
    return dps;
  };
  // they land hidden: the capture runs unopposed for a while (unless someone stands in the ring);
  // then they are shot one man at a time, the toughest last, and each adds its share while it stands
  const men = [...Array(INSURGENCY.squad * n).fill(INSURGENCY.kind), ...Array(extra).fill(INSURGENCY.chestKind)];
  let done = guards.length ? 0 : (INSURGENCY.hidden * (1 + CAPTURE.extraUnit * (Math.min(CAPTURE.maxUnits, men.length) - 1))) / time;
  let alive = men.length;
  for (const kind of men) {
    const d = UNITS[kind];
    const dps = fire(kind);
    if (dps <= 0) return Infinity;
    done += ((d.hp / dps) * (1 + CAPTURE.extraUnit * (Math.min(CAPTURE.maxUnits, alive) - 1))) / time;
    alive--;
  }
  return done;
}

/** Why player p can't drop partisans at city c now (null = they can). */
export function dropBlocked(s: MatchState, p: Player, c: City | undefined): string | null {
  if (!insurgent(s, p)) return 'only a knocked-out player can raise partisans';
  if (!c) return 'no such city';
  if (c.owner >= 0 && c.owner !== p.id && allied(s, c.owner, p.id)) return 'an ally holds that city';
  if (c.owner >= 0 && !p.held.includes(c.id)) return 'only at a neutral city, or one you once held';
  if (s.tick < p.insurgeAt) return `partisans ready in ${Math.ceil((p.insurgeAt - s.tick) / TICK_RATE)}s`;
  return null;
}

/**
 * Drop every banked charge's squad of partisans around city c for player p (checked by the
 * caller), with what the war chest pays for.
 */
export function dropPartisans(s: MatchState, p: Player, c: City, ev: SimEvent[]) {
  const n = nav(s), squads = charges(s, p), extra = chestTroops(p, squads);
  p.cash -= extra * INSURGENCY.chestCost;
  const kinds = [...Array(INSURGENCY.squad * squads).fill(INSURGENCY.kind), ...Array(extra).fill(INSURGENCY.chestKind)];
  let count = 0;
  kinds.forEach((kind, i) => {
    const a = (i / kinds.length) * Math.PI * 2 + c.id;
    const r = 2 + Math.floor(i / 6);
    const t = nearestPassable(n, 'ground', Math.floor(c.x + 0.5 + Math.cos(a) * r), Math.floor(c.y + 0.5 + Math.sin(a) * r), 6);
    if (t) { spawnUnit(s, kind, p.id, t[0] + 0.5, t[1] + 0.5, true).hide = s.tick + sec(INSURGENCY.hidden); count++; }
  });
  p.insurgeAt = s.tick + sec(INSURGENCY.every);
  ev.push({ e: 'insurge', p: p.id, city: c.id, n: count });
}

/** Insurgents holding a big enough city re-found their government there after a while. */
export function stepInsurgency(s: MatchState, ev: SimEvent[]) {
  if (s.tick % TICK_RATE !== 0) return;
  const holds = (p: Player, c: City | undefined) => !!c && c.owner === p.id && c.level >= INSURGENCY.minLevel;
  for (const p of s.players) {
    if (!insurgent(s, p)) continue;
    if (p.rising >= 0 && holds(p, s.cities[p.rising])) {
      if (s.tick < p.risingAt) continue;
      p.alive = true;
      p.capital = p.rising;
      p.capitalAt = s.tick;
      p.comebacks++;
      ev.push({ e: 'refound', p: p.id, city: p.rising });
      p.rising = -1;
      continue;
    }
    // a new city to hold (the biggest), or none
    let best: City | undefined;
    for (const c of s.cities) if (holds(p, c) && (!best || c.level > best.level)) best = c;
    p.rising = best ? best.id : -1;
    if (best) {
      p.risingAt = s.tick + sec(INSURGENCY.hold);
      ev.push({ e: 'rising', p: p.id, city: best.id, at: p.risingAt });
    }
  }
}
