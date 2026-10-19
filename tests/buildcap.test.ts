// The building cap: a base number of buildings plus more for every city held (BUILD_CAP).
import { describe, expect, it } from 'vitest';
import { placementProblem } from '../src/sim/commands';
import { placeBuilding } from '../src/sim/lifecycle';
import { buildingCap, buildingCount, hqOf } from '../src/sim/world';
import { BUILD_CAP } from '../src/data/rules';
import type { Building } from '../src/sim/types';
import { match, run, unitsOf } from './helpers';

function spotNear(s: ReturnType<typeof match>, p: number, kind: string): [number, number] {
  const hq = hqOf(s, p)!;
  for (let r = 3; r < 20; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (!placementProblem(s, p, kind, hq.tx + dx, hq.ty + dy)) return [hq.tx + dx, hq.ty + dy];
  throw new Error('no spot');
}

const barracksOf = (s: ReturnType<typeof match>, p: number) =>
  Object.values(s.ents).filter((e): e is Building => e.t === 'b' && e.owner === p && e.kind === 'barracks');

describe('building cap', () => {
  it('stops new buildings at the cap, and every city held raises it', () => {
    const s = match({ startMul: 10 });
    for (const c of s.cities) c.owner = -1;
    expect(buildingCap(s, 0)).toBe(BUILD_CAP.base);
    // the HQ doesn't count
    expect(buildingCount(s, 0)).toBe(0);
    // fill up to the cap with labs along the top edge (the filler only has to exist)
    for (let i = 0; i < BUILD_CAP.base; i++) placeBuilding(s, 'lab', 0, 2 + i * 3, 2, 1);
    expect(buildingCount(s, 0)).toBe(BUILD_CAP.base);

    const builders = unitsOf(s, 0, 'builder').map((u) => u.id);
    const [x, y] = spotNear(s, 0, 'barracks');
    const cash = s.players[0].cash;
    const ev = run(s, 0.05, [{ t: 'build', p: 0, ids: builders, kind: 'barracks', tx: x, ty: y }]);
    expect(ev.some((e) => e.e === 'reject' && e.p === 0 && /building limit/.test(e.why))).toBe(true);
    expect(barracksOf(s, 0)).toHaveLength(0);
    expect(s.players[0].cash).toBeGreaterThanOrEqual(cash);

    // a city raises the cap: the same order now goes through
    s.cities[0].owner = 0;
    expect(buildingCap(s, 0)).toBe(BUILD_CAP.base + BUILD_CAP.perCity);
    run(s, 0.05, [{ t: 'build', p: 0, ids: builders, kind: 'barracks', tx: x, ty: y }]);
    expect(barracksOf(s, 0)).toHaveLength(1);

    // losing the city again keeps what was built, but nothing new can go up
    s.cities[0].owner = -1;
    expect(buildingCount(s, 0)).toBe(BUILD_CAP.base + 1);
    const [x2, y2] = spotNear(s, 0, 'barracks');
    run(s, 0.05, [{ t: 'build', p: 0, ids: builders, kind: 'barracks', tx: x2, ty: y2 }]);
    expect(barracksOf(s, 0)).toHaveLength(1);
  });
});
