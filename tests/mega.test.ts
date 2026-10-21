// The mega units: a limit of three at a time, the Steamroller and the Carpet Bomb.
import { describe, expect, it } from 'vitest';
import { STEAMROLL, UNITS } from '../src/data/units';
import { placeBuilding } from '../src/sim/lifecycle';
import { unitSpeed } from '../src/sim/move';
import { nav } from '../src/sim/nav';
import { add, match, openSpot, run, unitsOf } from './helpers';

describe('mega units', () => {
  it('a player may have at most three of each, counting ones in training', () => {
    const s = match();
    const p = s.players[0];
    p.techs.push('compositeArmor');
    p.cash = 1e6;
    p.oil = 1e6;
    const { x, y } = openSpot(s);
    const f = placeBuilding(s, 'factory', 0, Math.floor(x) - 2, Math.floor(y) - 1, 1);
    add(s, 'megatank', 0, x + 6, y);
    // one already in the field: only two more get queued, and the rest of the order is refused
    const ev = run(s, 0.05, [{ t: 'train', p: 0, at: f.id, kind: 'megatank', n: 5 }]);
    expect(f.prod.filter((it) => it.kind === 'megatank')).toHaveLength(UNITS.megatank.limit! - 1);
    expect(ev.some((e) => e.e === 'reject' && e.p === 0)).toBe(false);
    const again = run(s, 0.05, [{ t: 'train', p: 0, at: f.id, kind: 'megatank', n: 1 }]);
    expect(again.some((e) => e.e === 'reject' && e.p === 0 && e.why.includes('at most'))).toBe(true);
    // the oil was only taken for the two that were queued
    expect(p.oil).toBeCloseTo(1e6 - 2 * UNITS.megatank.cost.oil, -1);
  });

  it('the Steamroller speeds the Mega Tank up and crushes enemy infantry under its tracks', () => {
    const s = match();
    const { x, y } = openSpot(s);
    const tank = add(s, 'megatank', 0, x, y);
    // guns silenced: only the tracks can hurt anyone
    tank.cd = tank.cd.map(() => 1e6);
    const under = add(s, 'rifleman', 1, x + 0.3, y);
    const away = add(s, 'rifleman', 1, x + 4, y);
    const n = nav(s);
    const slow = unitSpeed(s, tank, n);
    run(s, 0.05, [{ t: 'ability', p: 0, ids: [tank.id] }]);
    expect(unitSpeed(s, tank, n)).toBeCloseTo(slow * STEAMROLL.speed, 5);
    run(s, 1.5);
    expect(s.ents[under.id]).toBeUndefined();
    expect(s.ents[away.id]).toBeDefined();
    expect(s.ents[away.id].hp).toBe(UNITS.rifleman.hp);
  });

  it('the Carpet Bomb drops bombs all along the Mega Plane\'s path', () => {
    const s = match();
    const { x, y } = openSpot(s);
    const plane = add(s, 'megaplane', 0, x - 6, y);
    plane.cd = plane.cd.map(() => 1e6);
    const target = add(s, 'rifleman', 1, x + 2, y);
    run(s, 0.05, [{ t: 'move', p: 0, ids: [plane.id], x: x + 10, y }]);
    const ev = run(s, 0.05, [{ t: 'ability', p: 0, ids: [plane.id] }]).concat(run(s, 5));
    const bombs = ev.filter((e) => e.e === 'hit' && e.cls === 'bomb') as { x: number }[];
    expect(bombs.length).toBeGreaterThanOrEqual(8);
    // spread out along the flight, not piled on one spot
    expect(Math.max(...bombs.map((b) => b.x)) - Math.min(...bombs.map((b) => b.x))).toBeGreaterThan(6);
    expect(s.ents[target.id]?.hp ?? 0).toBeLessThan(UNITS.rifleman.hp);
    expect(unitsOf(s, 0, 'megaplane')).toHaveLength(1);
  });
});
