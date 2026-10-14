// Map generator: determinism, fair starts, connectivity (M1 "done when").
import { describe, expect, it } from 'vitest';
import { generateMap, mapHash } from '../src/sim/mapgen';
import { TERRAIN } from '../src/data/terrain';
import type { GameMap } from '../src/sim/types';
import { setup } from './helpers';

function groundComponent(m: GameMap, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(m.w * m.h);
  const stack = [sy * m.w + sx];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % m.w, y = (i - x) / m.w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = ny * m.w + nx;
      if (seen[j] || TERRAIN[m.terrain[j]].ground === 0) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}

describe('map generator', () => {
  it('is deterministic: the same seed and settings give the same map', () => {
    for (const mapType of ['pangaea', 'continents', 'islands', 'lakes'] as const) {
      const a = generateMap(setup({ seed: 42, mapType, mapSize: 'medium' }, 4));
      const b = generateMap(setup({ seed: 42, mapType, mapSize: 'medium' }, 4));
      expect(mapHash(a)).toBe(mapHash(b));
    }
    expect(mapHash(generateMap(setup({ seed: 1 })))).not.toBe(mapHash(generateMap(setup({ seed: 2 }))));
  });

  it('gives every start the same resources nearby (50 seeds × all map types)', () => {
    for (const mapType of ['pangaea', 'continents', 'islands', 'lakes'] as const)
      for (let seed = 1; seed <= 50; seed++) {
        const players = 2 + (seed % 5);
        const m = generateMap(setup({ seed, mapType, mapSize: players > 4 ? 'large' : 'medium' }, players));
        expect(m.starts).toHaveLength(players);
        for (const st of m.starts) {
          const near = (kind: string) => m.deposits.filter((d) => d.kind === kind && !d.rich && Math.hypot(d.x + 1 - st.x, d.y + 1 - st.y) <= 10).length;
          expect(near('ore'), `ore at start, ${mapType} seed ${seed}`).toBeGreaterThanOrEqual(2);
          expect(near('oil'), `oil at start, ${mapType} seed ${seed}`).toBeGreaterThanOrEqual(1);
          // the HQ footprint is buildable ground
          for (let y = st.y - 2; y < st.y + 2; y++) for (let x = st.x - 2; x < st.x + 2; x++) expect(TERRAIN[m.terrain[y * m.w + x]].buildable).toBe(true);
        }
      }
  });

  it('is fair within each map: every start is as far from the middle and has as many cities nearest it (30 seeds)', () => {
    const cases: [Parameters<typeof setup>[0], number][] = [
      [{ mapType: 'pangaea', mapSize: 'small' }, 2], [{ mapType: 'lakes', mapSize: 'medium' }, 4],
      [{ mapType: 'pangaea', mapSize: 'medium' }, 3], [{ mapType: 'continents', mapSize: 'medium' }, 4],
      [{ mapType: 'pangaea', mapSize: 'large' }, 6],
    ];
    for (const [over, n] of cases) {
      let gap = 0, far = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const m = generateMap(setup({ ...over, seed }, n));
        const own = m.starts.map((st) => m.cities.filter((c) => {
          const d = Math.hypot(c.x - st.x, c.y - st.y);
          return m.starts.every((o) => Math.hypot(c.x - o.x, c.y - o.y) >= d);
        }).length);
        const mids = m.starts.map((st) => Math.hypot(st.x - m.w / 2, st.y - m.h / 2));
        gap += Math.max(...own) - Math.min(...own);
        far = Math.max(far, Math.max(...mids) - Math.min(...mids));
      }
      expect(gap / 30, `${over!.mapType} ${over!.mapSize} ${n}p: average city gap`).toBeLessThanOrEqual(1.3);
      expect(far, `${over!.mapType} ${over!.mapSize} ${n}p: distance-to-middle gap`).toBeLessThanOrEqual(10);
    }
  });

  it('favours no start on average: each side of the map holds the same ore and oil (30 seeds)', () => {
    // the extra deposits once went round a list of cities in turn, so start 1 of 4 averaged 6.3
    // ore deposits on its side and start 0 only 5.4
    for (const [over, n] of [[{ mapType: 'pangaea', mapSize: 'medium' }, 4], [{ mapType: 'pangaea', mapSize: 'large' }, 6]] as const) {
      const ore = Array(n).fill(0), oil = Array(n).fill(0);
      for (let seed = 1; seed <= 30; seed++) {
        const m = generateMap(setup({ ...over, seed }, n));
        m.starts.forEach((st, i) => {
          // (rich ore is scattered in the contested middle on purpose, so it doesn't count)
          const side = m.deposits.filter((d) => { const dd = Math.hypot(d.x - st.x, d.y - st.y); return !d.rich && m.starts.every((o) => Math.hypot(d.x - o.x, d.y - o.y) >= dd); });
          ore[i] += side.filter((d) => d.kind !== 'oil').length / 30;
          oil[i] += side.filter((d) => d.kind === 'oil').length / 30;
        });
      }
      expect(Math.max(...ore) - Math.min(...ore), `${n}p ore by start ${ore.map((v) => v.toFixed(2))}`).toBeLessThan(0.4);
      expect(Math.max(...oil) - Math.min(...oil), `${n}p oil by start ${oil.map((v) => v.toFixed(2))}`).toBeLessThan(0.4);
    }
  });

  it('connects every start by land on pangaea and lakes maps', () => {
    for (const mapType of ['pangaea', 'lakes'] as const)
      for (let seed = 1; seed <= 25; seed++) {
        const m = generateMap(setup({ seed, mapType, mapSize: 'large' }, 6));
        const comp = groundComponent(m, m.starts[0].x, m.starts[0].y);
        for (const st of m.starts) expect(comp[st.y * m.w + st.x], `${mapType} seed ${seed}`).toBe(1);
      }
  });

  it('puts every start on its own landmass with two cities, two ore and an oil (islands, continents; 50 seeds)', () => {
    for (const mapType of ['islands', 'continents'] as const)
      for (let seed = 1; seed <= 50; seed++) {
        const players = 2 + (seed % 5);
        const m = generateMap(setup({ seed, mapType, mapSize: players > 4 ? 'large' : players > 2 ? 'medium' : 'small' }, players));
        const comps = m.starts.map((st) => groundComponent(m, st.x, st.y));
        m.starts.forEach((st, i) => {
          const tag = `${mapType} seed ${seed} start ${i}`;
          for (const [j, o] of m.starts.entries()) if (j !== i) expect(comps[i][o.y * m.w + o.x], `${tag} reaches start ${j} by land`).toBe(0);
          const on = (x: number, y: number) => comps[i][Math.round(y) * m.w + Math.round(x)] === 1;
          expect(m.cities.filter((c) => on(c.x, c.y)).length, `${tag} cities`).toBeGreaterThanOrEqual(2);
          expect(m.deposits.filter((d) => d.kind === 'ore' && on(d.x, d.y)).length, `${tag} ore`).toBeGreaterThanOrEqual(2);
          expect(m.deposits.filter((d) => d.kind === 'oil' && on(d.x, d.y)).length, `${tag} oil`).toBeGreaterThanOrEqual(1);
        });
      }
  });

  it('places plenty of cities, including two near each start', () => {
    const m = generateMap(setup({ seed: 5, mapSize: 'large' }, 6));
    expect(m.cities.length).toBeGreaterThanOrEqual(6 * 4);
    for (const st of m.starts) expect(m.cities.filter((c) => Math.hypot(c.x - st.x, c.y - st.y) < 26).length).toBeGreaterThanOrEqual(2);
  });
});
