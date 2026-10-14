// Transport ships: land units board from the shore and get off at another one.
import { UNITS } from '../data/units';
import type { MatchState, SimEvent, Unit } from './types';
import { nav, nearestPassable, passable } from './nav';
import { nextOrder } from './move';

export function cargoSupply(s: MatchState, t: Unit): number {
  let n = 0;
  for (const id of t.cargo) { const c = s.ents[id]; if (c) n += UNITS[c.kind].supply; }
  return n;
}

export function stepTransports(s: MatchState, ev: SimEvent[]) {
  if (s.tick % 2) return;
  const n = nav(s);
  for (const id in s.ents) {
    const u = s.ents[id];
    if (u.t !== 'u' || u.inside) continue;
    if (u.order?.o === 'load') {
      const t = s.ents[u.order.t];
      if (!t || t.t !== 'u' || !UNITS[t.kind].carries) { nextOrder(u); continue; }
      if (Math.hypot(t.x - u.x, t.y - u.y) > 1.9) continue;
      if (cargoSupply(s, t) + UNITS[u.kind].supply > UNITS[t.kind].carries!) { nextOrder(u); continue; }
      u.inside = t.id;
      t.cargo.push(u.id);
      u.order = null;
      u.queue = [];
      u.tgt = 0;
      continue;
    }
    if (u.order?.o === 'unload' && u.cargo.length) {
      const near = Math.hypot(u.order.x - u.x, u.order.y - u.y) < 3.5;
      if (!near && u.mv) continue;
      const shore = nearestPassable(n, 'ground', Math.floor(u.x), Math.floor(u.y), 2);
      if (!shore) { if (!u.mv) nextOrder(u); continue; }
      const taken = new Set<number>();
      for (const cid of u.cargo) {
        const c = s.ents[cid];
        if (!c || c.t !== 'u') continue;
        let spot: [number, number] | null = null;
        for (let r = 0; r < 4 && !spot; r++)
          for (let dy = -r; dy <= r && !spot; dy++)
            for (let dx = -r; dx <= r; dx++) {
              const x = shore[0] + dx, y = shore[1] + dy;
              if (!passable(n, 'ground', x, y) || taken.has(y * n.w + x)) continue;
              spot = [x, y];
              taken.add(y * n.w + x);
              break;
            }
        if (!spot) spot = shore;
        c.inside = 0;
        c.x = spot[0] + 0.5;
        c.y = spot[1] + 0.5;
        c.gx = c.x;
        c.gy = c.y;
        c.order = null;
      }
      u.cargo = [];
      nextOrder(u);
      ev.push({ e: 'ability', id: u.id, owner: u.owner, ab: 'unload', x: u.x, y: u.y });
    }
  }
}
