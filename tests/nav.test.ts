// Navigation shortcuts must give exactly the answers of the slow way.
import { describe, expect, it } from 'vitest';
import { FlowField, compOf, fieldTo, lineWalkable, nav, nearestPassable, nearestReachable, passable } from '../src/sim/nav';
import { placeBuilding } from '../src/sim/lifecycle';
import { match } from './helpers';

/** A tiny deterministic generator for test inputs. */
function lcg(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe('navigation', () => {
  it('the open-ground shortcut in lineWalkable agrees with sampling every step', () => {
    for (const mapType of ['pangaea', 'islands', 'lakes'] as const) {
      const s = match({ seed: 5, mapType, mapSize: 'medium' });
      const n = nav(s);
      // the same grids with no clearance known, which forces the sampled path
      const slow = { ...n, clearGround: new Uint8Array(n.w * n.h), clearNaval: new Uint8Array(n.w * n.h) };
      const r = lcg(42);
      let open = 0;
      for (let i = 0; i < 20000; i++) {
        const layer = r() < 0.7 ? 'ground' : 'naval';
        const x0 = r() * n.w, y0 = r() * n.h;
        const len = r() * 18, a = r() * Math.PI * 2;
        const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
        const rad = r() * 0.6;
        const fast = lineWalkable(n, layer, x0, y0, x1, y1, rad);
        expect(fast, `${mapType} ${layer} (${x0},${y0})→(${x1},${y1}) r${rad}`).toBe(lineWalkable(slow, layer, x0, y0, x1, y1, rad));
        if (fast) open++;
      }
      expect(open).toBeGreaterThan(1000);
    }
  });

  it('a flow field gives the same next step whatever order tiles are asked in', () => {
    const s = match({ seed: 9, mapType: 'lakes', mapSize: 'medium' });
    const n = nav(s);
    const goal = s.map.starts[0];
    const g = Math.floor(goal.y) * n.w + Math.floor(goal.x);
    const a = new FlowField(n, 'ground', [g]), b = new FlowField(n, 'ground', [g]);
    const tiles: [number, number][] = [];
    const r = lcg(7);
    for (let i = 0; i < 3000; i++) {
      const x = Math.floor(r() * n.w), y = Math.floor(r() * n.h);
      if (passable(n, 'ground', x, y)) tiles.push([x, y]);
    }
    const fromA = tiles.map(([x, y]) => a.next(x, y));
    // ask b the other way round, twice (the second time comes from its memory)
    const fromB = tiles.slice().reverse().map(([x, y]) => b.next(x, y)).reverse();
    expect(fromB).toEqual(fromA);
    expect(tiles.map(([x, y]) => b.next(x, y))).toEqual(fromA);
  });

  it('a field kept through a building going up elsewhere answers exactly like a new one; one near it is dropped', () => {
    const s = match({ seed: 9, mapType: 'pangaea', mapSize: 'medium' });
    let n = nav(s);
    const a = s.map.starts[0], b = s.map.starts[1];
    const [gx, gy] = nearestPassable(n, 'ground', Math.floor(a.x) + 6, Math.floor(a.y) + 6)!;
    const [sx, sy] = nearestReachable(n, 'ground', gx + 4, gy + 4, compOf(n, 'ground', gx, gy))!;
    const f = fieldTo(n, 'ground', gx, gy);
    // a short search around the goal only
    expect(f.ensure(sy * n.w + sx)).toBeLessThan(Infinity);
    placeBuilding(s, 'barracks', 1, Math.floor(b.x) + 5, Math.floor(b.y) + 5, 1);
    n = nav(s);
    expect(fieldTo(n, 'ground', gx, gy)).toBe(f);
    const fresh = new FlowField(n, 'ground', [gy * n.w + gx]);
    const r = lcg(3);
    for (let i = 0; i < 2000; i++) {
      const x = Math.floor(r() * n.w), y = Math.floor(r() * n.h);
      if (!passable(n, 'ground', x, y)) continue;
      expect(f.next(x, y), `(${x},${y})`).toBe(fresh.next(x, y));
      expect(f.dist[y * n.w + x]).toBe(fresh.dist[y * n.w + x]);
    }
    // a building beside the goal: that field is thrown away
    placeBuilding(s, 'barracks', 1, gx + 1, gy - 1, 1);
    n = nav(s);
    expect(fieldTo(n, 'ground', gx, gy)).not.toBe(f);
  });

  it('a search cut short by the tick budget carries on to the same answer', () => {
    const s = match({ seed: 9, mapType: 'lakes', mapSize: 'medium' });
    const n = nav(s);
    const goal = s.map.starts[0], far = s.map.starts[1];
    // just below each HQ
    const g = (Math.floor(goal.y) + 4) * n.w + Math.floor(goal.x);
    const t = (Math.floor(far.y) + 4) * n.w + Math.floor(far.x);
    const a = new FlowField(n, 'ground', [g]), b = new FlowField(n, 'ground', [g]);
    n.budget = 500;
    expect(a.ensure(t)).toBeNaN();
    n.budget = Infinity;
    expect(a.ensure(t)).toBe(b.ensure(t));
    expect(a.ensure(t)).toBeLessThan(Infinity);
  });
});
