// Giving orders to groups: formation slots for moves, reachable goals, queueing.
import { UNITS } from '../data/units';
import { ASSAULT } from '../data/cities';
import { assaultHole } from './cities';
import type { MatchState, Order, Unit } from './types';
import { nav, compOf, nearestReachable, passable } from './nav';

/**
 * Order a group to move to (x, y). Each unit gets its own slot around the point (keeping roughly
 * the group's shape), and all share one flow field toward the goal tile.
 */
export function orderMove(s: MatchState, units: Unit[], x: number, y: number, queue: boolean, attackMove: boolean) {
  if (!units.length) return;
  const n = nav(s);
  // group ids come from the id counter so they are deterministic
  const grp = s.nextId++;
  // group by movement layer: each layer has its own reachable area
  const byLayer = new Map<string, Unit[]>();
  for (const u of units) {
    const l = UNITS[u.kind].layer;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(u);
  }
  for (const [layer, us] of byLayer) {
    const L = layer as 'ground' | 'naval' | 'air';
    const lead = us[0];
    const comp = compOf(n, L, Math.floor(lead.x), Math.floor(lead.y));
    const goal = L === 'air' ? [Math.floor(x), Math.floor(y)] as [number, number] : nearestReachable(n, L, Math.floor(x), Math.floor(y), comp);
    if (!goal) continue;
    const [gx, gy] = goal;
    let cx = L === 'air' || (gx === Math.floor(x) && gy === Math.floor(y)) ? x : gx + 0.5;
    let cy = L === 'air' || (gx === Math.floor(x) && gy === Math.floor(y)) ? y : gy + 0.5;
    // a group sent onto a city surrounds it instead of piling onto the middle
    let hole = 0;
    const city = L !== 'naval' && us.length > 1 ? s.cities.find((c) => Math.hypot(c.x + 0.5 - x, c.y + 0.5 - y) <= ASSAULT.snap) : undefined;
    if (city) { cx = city.x + 0.5; cy = city.y + 0.5; hole = assaultHole(city); }
    const slots = formation(s, us, cx, cy, L, comp, hole);
    us.forEach((u, i) => {
      const o: Order = { o: 'move', x: slots[i][0], y: slots[i][1], gx, gy, am: attackMove, grp };
      give(u, o, queue);
    });
  }
}

/** Slot positions around (x, y) for the group, assigned so units keep their relative places. */
export function formation(s: MatchState, units: Unit[], x: number, y: number, layer: 'ground' | 'naval' | 'air', comp: number, hole = 0): [number, number][] {
  if (units.length === 1 && !hole) return [[x, y]];
  const n = nav(s);
  const spacing = Math.max(...units.map((u) => UNITS[u.kind].radius)) * 2.3;
  // candidate slots in a square spiral, keeping only reachable ones
  const slots: [number, number][] = [];
  const need = units.length;
  for (let r = 0; slots.length < need && r < 40; r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const sx = x + dx * spacing, sy = y + dy * spacing;
        if (hole && Math.hypot(sx - x, sy - y) < hole) continue;
        if (layer !== 'air' && (!passable(n, layer, Math.floor(sx), Math.floor(sy)) || compOf(n, layer, Math.floor(sx), Math.floor(sy)) !== comp)) continue;
        slots.push([sx, sy]);
      }
  }
  while (slots.length < need) slots.push([x, y]);
  // keep the group's shape: each unit takes the free slot nearest its offset from the group center
  let mx = 0, my = 0;
  for (const u of units) { mx += u.x; my += u.y; }
  mx /= units.length;
  my /= units.length;
  const used = new Uint8Array(slots.length);
  const out: [number, number][] = new Array(units.length);
  const order = units.map((u, i) => i).sort((a, b) => {
    const da = Math.hypot(units[a].x - mx, units[a].y - my), db = Math.hypot(units[b].x - mx, units[b].y - my);
    return da - db || units[a].id - units[b].id;
  });
  const pool = slots.slice(0, Math.max(need, Math.min(slots.length, need * 2)));
  for (const i of order) {
    const u = units[i];
    const px = x + (u.x - mx) * 0.35, py = y + (u.y - my) * 0.35;
    let best = -1, bd = Infinity;
    for (let k = 0; k < pool.length; k++) {
      if (used[k]) continue;
      const d = (pool[k][0] - px) ** 2 + (pool[k][1] - py) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    used[best] = 1;
    out[i] = pool[best];
  }
  return out;
}

export function give(u: Unit, o: Order, queue: boolean) {
  if (queue && (u.order || u.queue.length)) {
    if (u.queue.length < 16) u.queue.push(o);
    return;
  }
  u.order = o;
  u.queue = [];
  u.tgt = 0;
  u._stuck = 0;
  u._best = 1e9;
  u._grp = -1;
  u.dug = false;
}
