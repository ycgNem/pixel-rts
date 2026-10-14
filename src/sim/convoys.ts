// Merchant convoys (our twist, see CONVOY): coastal cities send unarmed merchant ships to their
// owner's Dock, which pay on arrival. They give the navy something to escort and something to
// raid, and make coastal cities worth holding.
import { CONVOY } from '../data/rules';
import { BUILDINGS } from '../data/buildings';
import type { Building, MatchState, SimEvent, Unit } from './types';
import { TICK_RATE } from './types';
import { spawnUnit } from './lifecycle';
import { orderMove } from './orders';
import { compOf, nav, nearestPassable, passable } from './nav';

/** Docks a merchant of `owner` in naval component `comp` can sail to, nearest first. */
function docksFor(s: MatchState, owner: number, x: number, y: number, comp: number): Building[] {
  const n = nav(s);
  const out: Building[] = [];
  for (const id in s.ents) {
    const b = s.ents[id];
    if (b.t !== 'b' || b.kind !== 'dock' || b.owner !== owner || b.built < 1) continue;
    const at = waterBy(s, b);
    if (at && compOf(n, 'naval', at[0], at[1]) === comp) out.push(b);
  }
  return out.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) || a.id - b.id);
}

/** A water tile beside a dock. */
function waterBy(s: MatchState, b: Building): [number, number] | null {
  const n = nav(s), d = BUILDINGS[b.kind];
  for (let r = 1; r <= 2; r++)
    for (let y = b.ty - r; y < b.ty + d.h + r; y++)
      for (let x = b.tx - r; x < b.tx + d.w + r; x++) if (passable(n, 'naval', x, y)) return [x, y];
  return null;
}

/** Once a second: merchants that reached a Dock pay up; idle ones head for one; cities send new ones. */
export function stepConvoys(s: MatchState, ev: SimEvent[]) {
  if (s.tick % TICK_RATE !== 0) return;
  const n = nav(s);
  const atSea = new Map<number, number>();
  for (const id in s.ents) {
    const u = s.ents[id];
    if (u.t !== 'u' || u.kind !== CONVOY.kind || u.owner < 0) continue;
    const docks = docksFor(s, u.owner, u.x, u.y, compOf(n, 'naval', Math.floor(u.x), Math.floor(u.y)));
    const dock = docks[0];
    if (dock && Math.hypot(u.x - dock.x, u.y - dock.y) <= BUILDINGS.dock.w / 2 + CONVOY.arrive) {
      const p = s.players[u.owner];
      p.cash += CONVOY.cash;
      p.oil += CONVOY.oil;
      p.stats.cashEarned += CONVOY.cash;
      delete s.ents[u.id];
      ev.push({ e: 'convoy', p: u.owner, by: -1, x: u.x, y: u.y, cash: CONVOY.cash, oil: CONVOY.oil });
      continue;
    }
    atSea.set(u.owner, (atSea.get(u.owner) ?? 0) + 1);
    if (dock && !u.order && !u.mv) {
      const w = waterBy(s, dock)!;
      orderMove(s, [u as Unit], w[0] + 0.5, w[1] + 0.5, false, false);
    }
  }
  const sec = s.tick / TICK_RATE;
  for (const c of s.cities) {
    if (c.owner < 0 || !c.coastal || s.tick < c.calm || !s.players[c.owner].alive) continue;
    // cities take turns (by id) so a coast full of them doesn't launch all at once
    if ((sec + c.id * 7) % (c.spec === 'port' ? CONVOY.portEvery : CONVOY.every) !== 0) continue;
    if ((atSea.get(c.owner) ?? 0) >= CONVOY.perPlayer) continue;
    const at = nearestPassable(n, 'naval', c.x, c.y, CONVOY.coast);
    if (!at) continue;
    const docks = docksFor(s, c.owner, at[0], at[1], compOf(n, 'naval', at[0], at[1]));
    if (!docks.length) continue;
    const u = spawnUnit(s, CONVOY.kind, c.owner, at[0] + 0.5, at[1] + 0.5);
    const w = waterBy(s, docks[0])!;
    orderMove(s, [u], w[0] + 0.5, w[1] + 0.5, false, false);
    atSea.set(c.owner, (atSea.get(c.owner) ?? 0) + 1);
  }
}
