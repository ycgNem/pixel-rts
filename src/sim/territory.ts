// Home Front (our twist): every owned city and HQ claims the land around it. A tile belongs to the
// claim it is deepest inside (distance over radius), so borders fall between rivals' cities. On
// your team's own ground your units slowly heal and idle infantry dig in: a defender's edge that
// slows the snowball after one lost fight. Worked out from the cities and HQs, never stored.
import { HOME_FRONT } from '../data/rules';
import type { MatchState, SimEvent } from './types';
import { TICK_RATE } from './types';
import { unitMaxHp } from './world';

export interface Claim { team: number; owner: number; x: number; y: number; r: number }

/** Every claim on the map, in a stable order (cities by id, then HQs by id). */
export function claims(s: MatchState): Claim[] {
  const out: Claim[] = [];
  for (const c of s.cities) {
    if (c.owner < 0) continue;
    out.push({ team: s.players[c.owner].team, owner: c.owner, x: c.x + 0.5, y: c.y + 0.5, r: HOME_FRONT.cityBase + HOME_FRONT.perLevel * c.level });
  }
  for (const id in s.ents) {
    const e = s.ents[id];
    if (e.t === 'b' && e.kind === 'hq' && e.owner >= 0 && e.built >= 1) out.push({ team: s.players[e.owner].team, owner: e.owner, x: e.x, y: e.y, r: HOME_FRONT.hq });
  }
  return out;
}

/** The team whose ground (x, y) is, or -1. */
export function territoryAt(cl: Claim[], x: number, y: number): number {
  let best = -1, bk = 1;
  for (const c of cl) {
    const k = Math.hypot(x - c.x, y - c.y) / c.r;
    if (k < bk || (k === bk && best >= 0 && c.team < best)) { bk = k; best = c.team; }
  }
  return best;
}

/** Once a second: units on their own team's ground heal a little. */
export function stepHomeFront(s: MatchState, _ev: SimEvent[]) {
  if (s.tick % TICK_RATE !== 0) return;
  const cl = claims(s);
  if (!cl.length) return;
  for (const id in s.ents) {
    const u = s.ents[id];
    if (u.t !== 'u' || u.owner < 0 || u.inside) continue;
    const max = unitMaxHp(s, u);
    if (u.hp >= max) continue;
    if (territoryAt(cl, u.x, u.y) !== s.players[u.owner].team) continue;
    u.hp = Math.min(max, u.hp + max * HOME_FRONT.regen);
  }
}

/** Is this spot on the team's own ground? (for idle infantry digging in) */
export function onHomeGround(s: MatchState, team: number, x: number, y: number, cl = claims(s)): boolean {
  return territoryAt(cl, x, y) === team;
}
