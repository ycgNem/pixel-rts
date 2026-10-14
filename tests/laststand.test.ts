// Last Stand: a player who has lost every city but not the HQ fights at the gates; and a hopeless
// AI surrenders instead of waiting out a decided match.
import { describe, expect, it } from 'vitest';
import { LAST_STAND } from '../src/data/rules';
import { AI_SURRENDER } from '../src/data/ai';
import { createAi } from '../src/sim/ai';
import { step } from '../src/sim/match';
import { supplyCap } from '../src/sim/economy';
import { hqOf } from '../src/sim/world';
import type { SimEvent } from '../src/sim/types';
import { TICK_RATE } from '../src/sim/types';
import { add, match, run, unitsOf } from './helpers';

describe('last stand', () => {
  it('a player who lost every city keeps a supply floor, trains infantry at the HQ and gets defenders', () => {
    const s = match({}, 2);
    // nobody is in a last stand at the start (no city held yet)
    run(s, 2);
    expect(s.players[1].lastStand).toBe(false);
    // P1 once held a city and has lost it
    s.players[1].held.push(s.cities[0].id);
    const ev = run(s, 1.05);
    expect(ev.some((e) => e.e === 'lastStand' && e.p === 1)).toBe(true);
    expect(s.players[1].lastStand).toBe(true);
    expect(supplyCap(s, 1)).toBeGreaterThanOrEqual(LAST_STAND.supply);
    // the HQ trains riflemen now (it couldn't before)
    const hq = hqOf(s, 1)!;
    s.players[1].cash = 1000;
    const train = run(s, 0.05, [{ t: 'train', p: 1, at: hq.id, kind: 'rifleman', n: 1 }]);
    expect(train.some((e) => e.e === 'reject')).toBe(false);
    expect(hq.prod.some((f) => f.kind === 'rifleman')).toBe(true);
    expect(run(s, 0.05, [{ t: 'train', p: 0, at: hqOf(s, 0)!.id, kind: 'rifleman', n: 1 }]).some((e) => e.e === 'reject')).toBe(true);
    // defenders rally to the HQ, up to a cap
    run(s, LAST_STAND.every * (LAST_STAND.max + 2));
    const near = unitsOf(s, 1, LAST_STAND.kind).filter((u) => Math.hypot(u.x - hq.x, u.y - hq.y) <= LAST_STAND.radius);
    expect(near.length).toBeGreaterThanOrEqual(LAST_STAND.max);
    expect(near.length).toBeLessThanOrEqual(LAST_STAND.max + 2); // (plus any it trained)
    // retaking a city ends it
    s.cities[0].owner = 1;
    run(s, 1.05);
    expect(s.players[1].lastStand).toBe(false);
  });

  it('a hopeless AI surrenders', () => {
    const s = match({}, 2);
    s.players[1].kind = 'ai';
    const ai = createAi(s, 1, 'normal');
    s.tick = AI_SURRENDER.after * TICK_RATE;
    // P0 has a big army; P1 has no city and nothing
    const hq0 = hqOf(s, 0)!;
    for (let i = 0; i < 12; i++) add(s, 'heavytank', 0, hq0.x + (i % 4) - 2, hq0.y + 4 + Math.floor(i / 4));
    for (const c of s.cities) c.owner = c.id % 2 ? 0 : -1;
    // ...and is broke, its few riflemen gone
    s.players[1].cash = 0;
    for (const u of unitsOf(s, 1)) if (u.kind !== 'builder') delete s.ents[u.id];
    const ev: SimEvent[] = [];
    for (let i = 0; i < (AI_SURRENDER.wait + 5) * TICK_RATE && !s.over; i++) ev.push(...step(s, ai.think(s)));
    expect(s.players[1].surrendered).toBe(true);
    expect(s.over?.winners).toBe(s.players[0].team);
  });

  it('an AI with a city, or an ally, does not surrender', () => {
    const s = match({}, 2);
    s.players[1].kind = 'ai';
    const ai = createAi(s, 1, 'normal');
    s.tick = AI_SURRENDER.after * TICK_RATE;
    const hq0 = hqOf(s, 0)!;
    for (let i = 0; i < 12; i++) add(s, 'heavytank', 0, hq0.x + (i % 4) - 2, hq0.y + 4 + Math.floor(i / 4));
    s.cities[0].owner = 1;
    for (let i = 0; i < (AI_SURRENDER.wait + 5) * TICK_RATE && !s.over; i++) step(s, ai.think(s));
    expect(s.players[1].surrendered).toBe(false);
  });
});
