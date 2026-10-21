// Builder work zones (WORK_ZONE): build and repair only inside, come back when strayed, walk the
// edge when idle, freed by Move and Stop, and sent to clients in snapshots.
import { describe, expect, it } from 'vitest';
import { WORK_ZONE } from '../src/data/rules';
import { placeBuilding } from '../src/sim/lifecycle';
import { buildingMaxHp } from '../src/sim/world';
import { SnapshotEncoder, applySnapshot } from '../src/net/protocol';
import { createMatch } from '../src/sim/match';
import type { Unit } from '../src/sim/types';
import { add, match, openSpot, run, setup } from './helpers';

describe('work zones', () => {
  it('a zoned Builder builds inside its zone and leaves sites outside it alone', () => {
    const s = match();
    const { x, y } = openSpot(s);
    const u = add(s, 'builder', 0, x, y);
    const inside = placeBuilding(s, 'lab', 0, Math.floor(x) + 3, Math.floor(y) - 1, 0);
    const outside = placeBuilding(s, 'lab', 0, Math.floor(x) - 14, Math.floor(y) - 1, 0);
    run(s, 0.05, [{ t: 'zone', p: 0, ids: [u.id], x, y, r: 8 }]);
    expect(u.post).toMatchObject({ x, y, r: 8 });
    run(s, 10);
    expect(inside.built).toBeGreaterThan(0.2);
    expect(outside.built).toBe(0);
  });

  it('repairs damaged buildings in the zone', () => {
    const s = match();
    const { x, y } = openSpot(s);
    const u = add(s, 'builder', 0, x, y);
    const b = placeBuilding(s, 'lab', 0, Math.floor(x) + 3, Math.floor(y) - 1, 1);
    b.hp = buildingMaxHp(s, b) / 2;
    run(s, 0.05, [{ t: 'zone', p: 0, ids: [u.id], x, y, r: 8 }]);
    run(s, 8);
    expect(b.hp).toBeGreaterThan(buildingMaxHp(s, b) / 2 + 50);
  });

  it('walks back when it strays, then walks the edge, never far outside', () => {
    const s = match();
    const { x, y } = openSpot(s);
    const u = add(s, 'builder', 0, x, y);
    run(s, 0.05, [{ t: 'zone', p: 0, ids: [u.id], x, y, r: 6 }]);
    u.x = x + 16;
    u.gx = u.x;
    run(s, 15);
    expect(Math.hypot(u.x - x, u.y - y)).toBeLessThan(6.5);
    // idle in the zone: it moves between stops on the edge
    const spots: [number, number][] = [];
    for (let i = 0; i < 12; i++) {
      run(s, 2);
      spots.push([u.x, u.y]);
      expect(Math.hypot(u.x - x, u.y - y)).toBeLessThan(6 + 1);
    }
    const spread = Math.max(...spots.map(([a, b]) => Math.hypot(a - spots[0][0], b - spots[0][1])));
    expect(spread).toBeGreaterThan(3);
  });

  it('a Move or Stop order frees the Builder, and the size is clamped', () => {
    const s = match();
    const { x, y } = openSpot(s);
    const a = add(s, 'builder', 0, x, y);
    const b = add(s, 'builder', 0, x + 1, y);
    run(s, 0.05, [{ t: 'zone', p: 0, ids: [a.id, b.id], x, y, r: 999 }]);
    expect(a.post?.r).toBe(WORK_ZONE.max);
    run(s, 0.05, [{ t: 'move', p: 0, ids: [a.id], x: x + 3, y }]);
    run(s, 0.05, [{ t: 'stop', p: 0, ids: [b.id] }]);
    expect(a.post).toBeUndefined();
    expect(b.post).toBeUndefined();
    // and only Builders take a zone
    const r = add(s, 'rifleman', 0, x, y + 1);
    const ev = run(s, 0.05, [{ t: 'zone', p: 0, ids: [r.id], x, y, r: 6 }]);
    expect(r.post).toBeUndefined();
    expect(ev.some((e) => e.e === 'reject')).toBe(true);
  });

  it('reaches clients in snapshots', () => {
    const host = match();
    const { x, y } = openSpot(host);
    const u = add(host, 'builder', 0, x, y);
    run(host, 0.05, [{ t: 'zone', p: 0, ids: [u.id], x, y, r: 7 }]);
    const client = createMatch(setup());
    applySnapshot(client, new SnapshotEncoder().encode(host, [], true));
    expect((client.ents[u.id] as Unit).post).toMatchObject({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: 7 });
  });
});
