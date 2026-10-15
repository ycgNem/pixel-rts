// Core sim behavior: setup, determinism, JSON round-trip, economy, building, training.
import { describe, expect, it } from 'vitest';
import { createMatch, step, stateHash } from '../src/sim/match';
import { incomeOf, supplyCap, supplyUsed, techCost } from '../src/sim/economy';
import { modMul } from '../src/sim/mods';
import { ERAS, TECH_ESCALATE } from '../src/data/techs';
import { SUPPLY_DROP } from '../src/data/powers';
import { placementProblem } from '../src/sim/commands';
import { BUILDINGS } from '../src/data/buildings';
import { START } from '../src/data/rules';
import type { Building, Command } from '../src/sim/types';
import { TICK_RATE } from '../src/sim/types';
import { add, match, run, setup, unitsOf } from './helpers';

const hqOf = (s: ReturnType<typeof match>, p: number) => Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.kind === 'hq' && e.owner === p)!;

/** A free spot for a building near this player's HQ. */
function spotNear(s: ReturnType<typeof match>, p: number, kind: string): [number, number] {
  const hq = hqOf(s, p);
  for (let r = 3; r < 20; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = hq.tx + dx, y = hq.ty + dy;
        if (!placementProblem(s, p, kind, x, y)) return [x, y];
      }
  throw new Error('no spot');
}

describe('match setup', () => {
  it('gives every player an HQ, builders, riflemen and starting resources', () => {
    const s = match({}, 3);
    for (let p = 0; p < 3; p++) {
      expect(hqOf(s, p)).toBeTruthy();
      expect(unitsOf(s, p, 'builder')).toHaveLength(2);
      expect(unitsOf(s, p, 'rifleman')).toHaveLength(4);
      expect(s.players[p].cash).toBe(START.cash);
    }
  });

  it('survives a JSON round-trip and stays deterministic', () => {
    const cmds = (s: ReturnType<typeof match>): Command[] => [
      { t: 'move', p: 0, ids: unitsOf(s, 0, 'rifleman').map((u) => u.id), x: s.map.w / 2, y: s.map.h / 2, am: true },
      { t: 'move', p: 1, ids: unitsOf(s, 1, 'rifleman').map((u) => u.id), x: s.map.w / 2, y: s.map.h / 2, am: true },
    ];
    const a = match({ weather: true, crates: true });
    const b = match({ weather: true, crates: true });
    run(a, 1, cmds(a));
    run(b, 1, cmds(b));
    // continue b from a JSON copy of itself: nothing may be lost in serialization
    const c = JSON.parse(JSON.stringify(b));
    for (let i = 0; i < 60 * TICK_RATE; i++) { step(a, []); step(c, []); }
    expect(stateHash(a)).toBe(stateHash(c));
    expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(c)));
  });
});

describe('economy', () => {
  it('pays HQ income per second as in the data', () => {
    const s = match();
    const before = s.players[0].cash;
    run(s, 60);
    const inc = incomeOf(s, 0);
    expect(inc.cash).toBeCloseTo(BUILDINGS.hq.income!.cash!, 5);
    expect(s.players[0].cash - before).toBeCloseTo(inc.cash * 60, 0);
  });

  it('builders construct a mine on ore, which then pays its income', () => {
    const s = match();
    const hq = hqOf(s, 0);
    const dep = s.map.deposits.filter((d) => d.kind === 'ore').sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
    const builders = unitsOf(s, 0, 'builder').map((u) => u.id);
    expect(placementProblem(s, 0, 'mine', dep.x, dep.y)).toBeNull();
    expect(placementProblem(s, 0, 'mine', dep.x + 3, dep.y + 3)).toMatch(/ore/);
    const cashBefore = s.players[0].cash;
    run(s, 0.05, [{ t: 'build', p: 0, ids: builders, kind: 'mine', tx: dep.x, ty: dep.y }]);
    expect(s.players[0].cash).toBeCloseTo(cashBefore - BUILDINGS.mine.cost.cash, 0);
    run(s, 40);
    const mine = Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.kind === 'mine')!;
    expect(mine.built).toBe(1);
    expect(incomeOf(s, 0).cash).toBeCloseTo(BUILDINGS.hq.income!.cash! + BUILDINGS.mine.income!.cash!, 5);
  });

  it('builds a barracks and trains riflemen, limited by supply', () => {
    const s = match({ startMul: 10 });
    const [x, y] = spotNear(s, 0, 'barracks');
    const builders = unitsOf(s, 0, 'builder').map((u) => u.id);
    run(s, 0.05, [{ t: 'build', p: 0, ids: builders, kind: 'barracks', tx: x, ty: y }]);
    run(s, 40);
    const bar = Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.kind === 'barracks')!;
    expect(bar.built).toBe(1);
    run(s, 0.05, [{ t: 'train', p: 0, at: bar.id, kind: 'rifleman', n: 5 }]);
    run(s, 45);
    expect(unitsOf(s, 0, 'rifleman').length).toBe(4 + 5);
    // one short of the cap: one more trains, then production waits
    expect(supplyCap(s, 0)).toBe(BUILDINGS.hq.supply);
    while (supplyUsed(s, 0) < supplyCap(s, 0) - 1) { add(s, 'rifleman', 0, bar.x, bar.y + 3); step(s, []); }
    run(s, 0.05, [{ t: 'train', p: 0, at: bar.id, kind: 'rifleman', n: 5 }]);
    run(s, 60);
    expect(supplyUsed(s, 0)).toBe(supplyCap(s, 0));
    expect(bar.prod.length).toBe(4);
    expect(bar.blocked).toBe(true);
  });

  it('idle Builders join unfinished buildings by themselves, one Builder per project first', () => {
    const s = match({ startMul: 10, players: setup().players.map((p, i) => ({ ...p, kind: i === 0 ? 'human' : 'passive' })) });
    const [a, b] = unitsOf(s, 0, 'builder');
    const [x, y] = spotNear(s, 0, 'barracks');
    // only the first Builder is told to build; the idle second one joins it by itself
    run(s, 1, [{ t: 'build', p: 0, ids: [a.id], kind: 'barracks', tx: x, ty: y }]);
    const bar = Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.kind === 'barracks')!;
    expect(a.order).toEqual({ o: 'build', t: bar.id });
    expect(b.order).toEqual({ o: 'build', t: bar.id });
    // a second project with both selected: one moves over, the other keeps building the first
    const hq = hqOf(s, 0);
    const dep = s.map.deposits.filter((d) => d.kind === 'ore').sort((p, q) => Math.hypot(p.x - hq.x, p.y - hq.y) - Math.hypot(q.x - hq.x, q.y - hq.y))[0];
    run(s, 0.05, [{ t: 'build', p: 0, ids: [a.id, b.id], kind: 'mine', tx: dep.x, ty: dep.y }]);
    const mineB = Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.kind === 'mine')!;
    expect([a, b].map((u) => (u.order as { t: number }).t).sort()).toEqual([bar.id, mineB.id].sort());
    // the AI places its own crews
    const ai = match({ startMul: 10 });
    const [c, d] = unitsOf(ai, 0, 'builder');
    run(ai, 1, [{ t: 'build', p: 0, ids: [c.id], kind: 'barracks', tx: x, ty: y }]);
    expect(d.order).toBeNull();
  });

  it('queued buildings go to different Builders', () => {
    const s = match({ startMul: 10 });
    const ids = unitsOf(s, 0, 'builder').map((u) => u.id);
    const [x, y] = spotNear(s, 0, 'barracks');
    run(s, 0.05, [{ t: 'build', p: 0, ids, kind: 'barracks', tx: x, ty: y, q: true }]);
    const [x2, y2] = spotNear(s, 0, 'lab');
    run(s, 0.05, [{ t: 'build', p: 0, ids, kind: 'lab', tx: x2, ty: y2, q: true }]);
    const targets = unitsOf(s, 0, 'builder').map((u) => (u.order as { t: number } | null)?.t);
    expect(new Set(targets).size).toBe(2);
    expect(unitsOf(s, 0, 'builder').every((u) => !u.queue.length)).toBe(true);
  });

  it('refuses commands for things you cannot afford, have not unlocked or do not own', () => {
    const s = match();
    s.players[0].cash = 0;
    const ev = run(s, 0.05, [
      { t: 'build', p: 0, ids: unitsOf(s, 0, 'builder').map((u) => u.id), kind: 'barracks', tx: spotNear(s, 0, 'barracks')[0], ty: spotNear(s, 0, 'barracks')[1] },
      { t: 'build', p: 0, ids: unitsOf(s, 0, 'builder').map((u) => u.id), kind: 'turret', tx: 10, ty: 10 },
      { t: 'move', p: 0, ids: unitsOf(s, 1).map((u) => u.id), x: 5, y: 5 },
    ]);
    const rejects = ev.filter((e) => e.e === 'reject');
    expect(rejects.length).toBe(2);
    expect(unitsOf(s, 1).every((u) => !u.order)).toBe(true);
  });
});

describe('balance rules', () => {
  it('bonuses to the same stat add up instead of multiplying', () => {
    const s = match();
    const p = s.players[0];
    p.techs.push('urbanPlanning', 'massTransit');
    expect(modMul(p, 'cityGrowth')).toBeCloseTo(1.5, 5);
  });

  it('research finishes in the order it was queued, even when an order arrives as a tech completes', () => {
    const s = match();
    const p = s.players[0];
    p.science = 0;
    run(s, 0.05, [{ t: 'research', p: 0, tech: 'schooling' }, { t: 'research', p: 0, tech: 'urbanPlanning' }]);
    // finish the first tech, then order a third on the very tick it completes
    const order: string[] = [];
    let sent = false;
    for (let i = 0; i < 20 * 60 * 20 && order.length < 3; i++) {
      if (!sent && p.research.cur === 'schooling') p.science = 1e5;
      const cmds = !sent && p.techs.includes('schooling') ? [{ t: 'research' as const, p: 0, tech: 'deepMining' }] : [];
      if (cmds.length) sent = true;
      for (const e of step(s, cmds)) if (e.e === 'researched' && e.p === 0) order.push(e.tech);
      if (sent) p.science += 50;
    }
    expect(order).toEqual(['schooling', 'urbanPlanning', 'deepMining']);
  });

  it('each tech from an era makes the next one from that era dearer', () => {
    const s = match();
    const p = s.players[0];
    expect(techCost(s, p, 'rocketry')).toBe(ERAS[0].cost);
    p.techs.push('deepMining', 'oilRefining');
    expect(techCost(s, p, 'rocketry')).toBe(Math.round(ERAS[0].cost * (1 + 2 * TECH_ESCALATE)));
  });

  it('a supply drop is lend-lease: the minimum for the leader, the income gap for whoever is behind', () => {
    const s = match();
    // player 1 holds three cities, so earns more than player 0
    s.cities.filter((c) => c.owner < 0).slice(0, 3).forEach((c) => (c.owner = 1));
    const gap = incomeOf(s, 1).cash - incomeOf(s, 0).cash;
    expect(gap).toBeGreaterThan(0);
    const drop = (p: number) => {
      const pl = s.players[p];
      pl.cp = 10;
      pl.powerReady = {};
      const before = pl.cash, inc = incomeOf(s, p).cash;
      run(s, 0.05, [{ t: 'power', p, power: 'supplyDrop' }]);
      return pl.cash - before - inc * 0.05;
    };
    expect(drop(1)).toBeCloseTo(SUPPLY_DROP.minCash, 0);
    expect(drop(0)).toBeCloseTo(Math.min(SUPPLY_DROP.maxCash, SUPPLY_DROP.minCash + gap * SUPPLY_DROP.gapSeconds), -1);
    // never more than the cap
    s.cities.filter((c) => c.owner < 0).forEach((c) => (c.owner = 1));
    expect(drop(0)).toBeLessThanOrEqual(SUPPLY_DROP.maxCash + 1);
  });
});

describe('untrusted commands', () => {
  it('ignores commands with the wrong shape instead of crashing', () => {
    const s = match();
    const bad = [
      null, 42, { t: 'move', p: 0, ids: 'all', x: 1, y: 1 }, { t: 'move', p: 0, ids: [1], x: NaN, y: 1 },
      { t: 'train', p: 0, at: 1, kind: 'constructor', n: 1 }, { t: 'build', p: 0, ids: [], kind: '__proto__', tx: 1, ty: 1 },
      { t: 'trade', p: 0, trade: 'toString' }, { t: 'research', p: 0, tech: { id: 1 } }, { t: 'gift', p: 0, to: 1, cash: -500, oil: 0 },
      { t: 'nuke', p: 0 }, { t: 'stop', p: '0', ids: [] },
    ] as unknown as Command[];
    const cash = s.players[0].cash;
    expect(() => run(s, 0.05, bad)).not.toThrow();
    expect(s.players[0].cash).toBeGreaterThanOrEqual(cash);
  });

  it('the exchange trades cash for oil, and each trade costs more than the last', () => {
    const s = match();
    const p = s.players[0];
    p.cash = 5000;
    const oil = p.oil;
    run(s, 0.05, [{ t: 'trade', p: 0, trade: 'buyOil' }]);
    const first = 5000 - p.cash;
    expect(p.oil).toBeGreaterThan(oil);
    const before = p.cash;
    run(s, 0.05, [{ t: 'trade', p: 0, trade: 'buyOil' }]);
    expect(before - p.cash).toBeGreaterThan(first);
    // funding research needs a lab
    expect(run(s, 0.05, [{ t: 'trade', p: 0, trade: 'fundResearch' }]).some((e) => e.e === 'reject')).toBe(true);
  });
});

describe('determinism', () => {
  it('two runs of the same setup and commands give the same state', () => {
    const go = () => {
      const s = createMatch(setup({ seed: 99, weather: true, crates: true }, 3));
      const cmds: Command[] = [0, 1, 2].map((p) => ({ t: 'move', p, ids: unitsOf(s, p).map((u) => u.id), x: s.map.w / 2, y: s.map.h / 2, am: true }));
      run(s, 0.05, cmds);
      run(s, 90);
      return stateHash(s);
    };
    expect(go()).toBe(go());
  });
});
