// Last Stand (our twist): a player who held cities and has lost every one of them, but still has
// an HQ, fights for it: a supply floor, infantry trained at the HQ, and free defenders rallying to
// it (LAST_STAND). A decided match ends in a fight at the gates, not in a wait.
import { LAST_STAND } from '../data/rules';
import { UNITS } from '../data/units';
import type { Building, MatchState, Player, SimEvent } from './types';
import { hqOf, sec } from './world';
import { near } from './spatial';
import { nav, nearestPassable } from './nav';
import { spawnUnit } from './lifecycle';

/** Is player p making a last stand (cities held before, none now, the HQ still up)? */
export function lastStand(s: MatchState, p: Player): boolean {
  return p.alive && p.held.length > 0 && !s.cities.some((c) => c.owner === p.id) && !!hqOf(s, p.id);
}

/** Can building b train this kind of unit (its own list, or the HQ in a last stand)? */
export function trainsAt(s: MatchState, b: Building, kind: string): boolean {
  if (UNITS[kind].at.includes(b.kind)) return true;
  return b.kind === 'hq' && LAST_STAND.units.includes(kind) && lastStand(s, s.players[b.owner]);
}

/** Once a second: a last stand starts or ends (announced), and the HQ rallies a defender now and then. */
export function stepLastStand(s: MatchState, ev: SimEvent[]) {
  if (s.tick % sec(1) !== 0) return;
  for (const p of s.players) {
    const on = lastStand(s, p);
    if (on !== p.lastStand) {
      p.lastStand = on;
      if (on) ev.push({ e: 'lastStand', p: p.id });
    }
    if (!on || s.tick % sec(LAST_STAND.every) !== 0) continue;
    const hq = hqOf(s, p.id)!;
    let n = 0;
    near(s, hq.x, hq.y, LAST_STAND.radius, (e) => {
      if (e.t === 'u' && e.owner === p.id && e.kind === LAST_STAND.kind && Math.hypot(e.x - hq.x, e.y - hq.y) <= LAST_STAND.radius) n++;
    }, 0);
    if (n >= LAST_STAND.max) continue;
    const t = nearestPassable(nav(s), 'ground', Math.floor(hq.x), Math.floor(hq.y) + 3, 6);
    if (t) spawnUnit(s, LAST_STAND.kind, p.id, t[0] + 0.5, t[1] + 0.5);
  }
}
