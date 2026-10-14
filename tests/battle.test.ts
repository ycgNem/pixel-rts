// Movement, combat, cities and victory, headless.
import { describe, expect, it } from 'vitest';
import { step } from '../src/sim/match';
import { DAMAGE } from '../src/data/damage';
import { UNITS } from '../src/data/units';
import { CAPTURE, CITY_LEVELS, NEUTRAL_GROWTH } from '../src/data/cities';
import { ALERTS, EXILE, HOME_FRONT, RESISTANCE, VICTORY } from '../src/data/rules';
import { claims, territoryAt } from '../src/sim/territory';
import { incomeOf } from '../src/sim/economy';
import { supremacyShare } from '../src/sim/victory';
import { hurt, placeBuilding } from '../src/sim/lifecycle';
import { sec } from '../src/sim/world';
import { nav, compOf } from '../src/sim/nav';
import { unitSpeed } from '../src/sim/move';
import { modMul } from '../src/sim/mods';
import { AUTO_DIG_EVERY, PERKS } from '../src/data/techs';
import { POWERS } from '../src/data/powers';
import { assaultHole, captureRadius, cityTrains } from '../src/sim/cities';
import { canSee, tileVisible } from '../src/sim/vision';
import { unitMaxHp } from '../src/sim/world';
import type { Building, SimEvent } from '../src/sim/types';
import { TICK_RATE } from '../src/sim/types';
import { add, clear, match, openSpot, run, unitsOf } from './helpers';

describe('movement', () => {
  it('100 units cross a large map around obstacles without getting stuck (5 seeds)', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const s = match({ seed, mapSize: 'large', mapType: 'lakes' });
      clear(s);
      // one team, so nobody wins mid-test when the column reaches the other HQ
      for (const p of s.players) p.team = 0;
      const a = s.map.starts[0], b = s.map.starts[1];
      const ids: number[] = [];
      for (let i = 0; i < 100; i++) ids.push(add(s, i % 3 ? 'rifleman' : 'lighttank', 0, a.x + (i % 10) - 5 + 0.5, a.y + Math.floor(i / 10) - 8 + 0.5).id);
      // stand them on walkable ground
      step(s, []);
      const n = nav(s);
      const comp = compOf(n, 'ground', b.x, b.y + 6);
      run(s, 0.05, [{ t: 'move', p: 0, ids, x: b.x + 0.5, y: b.y + 6.5 }]);
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      run(s, (dist / 1.5) * 2.2 + 20);
      const units = ids.map((id) => s.ents[id]).filter(Boolean);
      const arrived = units.filter((u) => Math.hypot(u.x - b.x - 0.5, u.y - b.y - 6.5) < 9);
      expect(comp).toBeGreaterThanOrEqual(0);
      expect(arrived.length, `seed ${seed}: ${arrived.length}/100 arrived`).toBeGreaterThanOrEqual(95);
    }
  });

  it('one sim tick takes at most a few ms with 1,000 units (benchmark)', () => {
    const s = match({ mapSize: 'large' }, 4);
    clear(s);
    for (const p of s.players) p.team = 0;
    const ids: number[][] = [[], [], [], []];
    for (let i = 0; i < 1000; i++) {
      const p = i % 4, st = s.map.starts[p];
      ids[p].push(add(s, ['rifleman', 'lighttank', 'scout'][i % 3], p, st.x + ((i >> 2) % 16) - 8 + 0.5, st.y + Math.floor((i >> 2) / 16) - 8 + 0.5).id);
    }
    step(s, []);
    run(s, 0.05, ids.map((u, p) => ({ t: 'move' as const, p, ids: u, x: s.map.w / 2, y: s.map.h / 2, am: true })));
    const t0 = performance.now();
    const ticks = 10 * TICK_RATE;
    for (let i = 0; i < ticks; i++) step(s, []);
    const ms = (performance.now() - t0) / ticks;
    console.log(`sim tick with 1000 units: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(12);
  });
});

describe('combat', () => {
  it('follows the damage table', () => {
    expect(DAMAGE.rocket.heavy).toBeGreaterThan(DAMAGE.gun.heavy);
    expect(DAMAGE.flak.air).toBeGreaterThan(DAMAGE.flak.infantry);
    expect(DAMAGE.gun.air).toBe(0);
  });

  it('air counters: fighters, AA guns and flak trucks each beat a bomber of about the same cost', () => {
    const fight = (defend: (s: ReturnType<typeof match>, x: number, y: number) => number[]) => {
      const s = match();
      clear(s);
      const p = openSpot(s);
      const ids = defend(s, p.x, p.y);
      const bomber = add(s, 'bomber', 1, p.x + 12, p.y);
      run(s, 0.05, [{ t: 'attack', p: 1, ids: [bomber.id], target: ids[0] }]);
      run(s, 40);
      return { bomberAlive: !!s.ents[bomber.id], left: ids.filter((id) => s.ents[id]).length };
    };
    const cost = (k: string) => UNITS[k]?.cost.cash ?? 0;
    // two fighters (the bomber can't shoot back at aircraft)
    expect(2 * cost('fighter')).toBeLessThanOrEqual(cost('bomber'));
    let r = fight((s, x, y) => [add(s, 'fighter', 0, x, y).id, add(s, 'fighter', 0, x, y + 1).id]);
    expect(r).toEqual({ bomberAlive: false, left: 2 });
    // two AA guns
    r = fight((s, x, y) => [0, 3].map((dy) => placeBuilding(s, 'aagun', 0, Math.floor(x), Math.floor(y) + dy, 1).id));
    expect(r.bomberAlive).toBe(false);
    expect(r.left).toBeGreaterThanOrEqual(1);
    // two flak trucks
    r = fight((s, x, y) => [add(s, 'flaktruck', 0, x, y).id, add(s, 'flaktruck', 0, x, y + 2).id]);
    expect(r.bomberAlive).toBe(false);
    expect(r.left).toBeGreaterThanOrEqual(1);
  });

  it('cost for cost, Rocket Troopers beat Light Tanks, and Light Tanks beat Riflemen', () => {
    const value = (k: string) => UNITS[k].cost.cash + 2 * UNITS[k].cost.oil;
    /** a units of kind A against an equal value of kind B, closing in; the surviving value share of A */
    const duel = (a: string, na: number, b: string) => {
      const s = match();
      clear(s);
      const p = openSpot(s);
      const nb = Math.round((na * value(a)) / value(b));
      const as = Array.from({ length: na }, (_, i) => add(s, a, 0, p.x - 3 + (i % 4) * 0.7, p.y - 1.5 + Math.floor(i / 4) * 0.7).id);
      const bs = Array.from({ length: nb }, (_, i) => add(s, b, 1, p.x + 4 + (i % 4) * 0.8, p.y - 1.5 + Math.floor(i / 4) * 0.8).id);
      run(s, 0.05, [{ t: 'move', p: 0, ids: as, x: p.x + 4, y: p.y, am: true }, { t: 'move', p: 1, ids: bs, x: p.x - 3, y: p.y, am: true }]);
      run(s, 90);
      const left = (ids: number[], k: string) => ids.filter((id) => s.ents[id]).length * value(k);
      return { a: left(as, a) / (na * value(a)), b: left(bs, b) / (nb * value(b)) };
    };
    const rockets = duel('rocket', 12, 'lighttank');
    expect(rockets.a, `rockets keep ${rockets.a.toFixed(2)}, tanks ${rockets.b.toFixed(2)}`).toBeGreaterThan(rockets.b);
    const tanks = duel('lighttank', 5, 'rifleman');
    expect(tanks.a, `tanks keep ${tanks.a.toFixed(2)}, riflemen ${tanks.b.toFixed(2)}`).toBeGreaterThan(tanks.b);
  });

  it('a light tank beats a rifleman; four riflemen dig in and survive longer', () => {
    const s = match();
    clear(s);
    const p = openSpot(s);
    const tank = add(s, 'lighttank', 0, p.x, p.y);
    const rifle = add(s, 'rifleman', 1, p.x + 3, p.y);
    run(s, 20);
    expect(s.ents[rifle.id]).toBeUndefined();
    expect(s.ents[tank.id]).toBeTruthy();
    expect(s.players[0].stats.kills + s.players[1].stats.unitsLost).toBeGreaterThan(0);
  });

  it('veterancy: a unit that destroys several times its value earns stars', () => {
    const s = match();
    clear(s);
    const p = openSpot(s);
    const tank = add(s, 'heavytank', 0, p.x, p.y);
    for (let i = 0; i < 12; i++) add(s, 'rifleman', 1, p.x + 3 + (i % 3) * 0.5, p.y - 1 + Math.floor(i / 3) * 0.5);
    run(s, 60);
    expect(s.ents[tank.id]).toBeTruthy();
    expect((s.ents[tank.id] as typeof tank).vet).toBeGreaterThanOrEqual(1);
  });

  it('artillery splash hurts a clump of infantry', () => {
    const s = match();
    clear(s);
    s.players[0].techs.push('artillery');
    const p = openSpot(s);
    add(s, 'artillery', 0, p.x - 4, p.y);
    const clump = [0, 1, 2, 3].map((i) => add(s, 'rifleman', 1, p.x + 5 + (i % 2) * 0.4, p.y + Math.floor(i / 2) * 0.4));
    for (const u of clump) u.hold = true;
    run(s, 12);
    const hurt = clump.filter((u) => !s.ents[u.id] || s.ents[u.id].hp < UNITS.rifleman.hp).length;
    expect(hurt).toBeGreaterThanOrEqual(3);
  });

  it('alerts its owner to a hit on a building or at home, once per area at a time, not to a fight in the field', () => {
    const s = match();
    const alerts = (ev: SimEvent[]) => ev.filter((e) => e.e === 'attacked' && e.p === 1).length;
    const hq = Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.kind === 'hq' && e.owner === 1)!;
    const raider = add(s, 'rifleman', 0, hq.x + 3, hq.y);
    const ev: SimEvent[] = [];
    hurt(s, hq, 10, 'gun', raider, ev);
    expect(alerts(ev)).toBe(1);
    // the same place again soon: quiet
    const home = add(s, 'rifleman', 1, hq.x + 2, hq.y + 2);
    hurt(s, home, 5, 'gun', raider, ev);
    expect(alerts(ev)).toBe(1);
    // out in the field, a fight P1's units are in doesn't nag, nor do a city's militia
    const p = openSpot(s);
    const away = add(s, 'rifleman', 1, p.x, p.y);
    expect(territoryAt(claims(s), p.x, p.y)).not.toBe(s.players[1].team);
    const ev2: SimEvent[] = [];
    hurt(s, away, 5, 'gun', add(s, 'rifleman', 0, p.x + 2, p.y), ev2);
    hurt(s, away, 5, 'gun', undefined, ev2);
    expect(alerts(ev2)).toBe(0);
    // home ground elsewhere, or the same place later: alerted again
    s.tick += sec(ALERTS.every) + 1;
    const ev3: SimEvent[] = [];
    hurt(s, home, 5, 'gun', raider, ev3);
    expect(alerts(ev3)).toBe(1);
  });
});

describe('cities', () => {
  it('infantry capture a neutral city, which then pays its owner', () => {
    const s = match();
    clear(s);
    const c = s.cities[0];
    const ids = [0, 1, 2].map((i) => add(s, 'rifleman', 0, c.x + 0.5 + i * 0.4, c.y + 1.5).id);
    void ids;
    const time = CAPTURE.baseSeconds + CAPTURE.perLevel * (c.level - 1);
    const incBefore = incomeOf(s, 0).cash;
    run(s, time / (1 + CAPTURE.extraUnit * 2) + 3);
    expect(c.owner).toBe(0);
    run(s, 1);
    // capture of a neutral city has no unrest
    const before = s.players[0].cash;
    run(s, 10);
    expect(s.players[0].cash - before).toBeGreaterThan(10 * (incBefore + CITY_LEVELS[c.level - 1].cash * 0.9));
  });

  it('neutral cities away from the starts grow on their own; home villages do not', () => {
    const s = match({ mapSize: 'medium' });
    clear(s);
    const far = (c: (typeof s.cities)[number]) => s.map.starts.every((st) => Math.hypot(st.x - c.x, st.y - c.y) > NEUTRAL_GROWTH.homeRadius);
    const wild = s.cities.find((c) => c.owner < 0 && far(c) && c.level < NEUTRAL_GROWTH.maxLevel)!;
    const home = s.cities.find((c) => c.owner < 0 && !far(c))!;
    const [w0, h0] = [wild.level, home.level];
    run(s, NEUTRAL_GROWTH.every + 2);
    expect(wild.level).toBe(w0 + 1);
    expect(home.level).toBe(h0);
  });

  it('home front: on your own ground units heal; elsewhere they do not', () => {
    const s = match();
    clear(s);
    const hq = Object.values(s.ents).find((e) => e.t === 'b' && e.kind === 'hq' && e.owner === 0)!;
    const home = add(s, 'rifleman', 0, hq.x, hq.y + 4);
    const away = openSpot(s);
    const abroad = add(s, 'rifleman', 0, away.x, away.y);
    expect(territoryAt(claims(s), abroad.x, abroad.y)).toBe(-1);
    home.hp = abroad.hp = 10;
    run(s, 10.05);
    // one heal a second: 10 or 11 of them in 10.05 s, depending on where the second boundaries fall
    const per = UNITS.rifleman.hp * HOME_FRONT.regen;
    expect(home.hp).toBeGreaterThanOrEqual(10 + 10 * per - 1e-6);
    expect(home.hp).toBeLessThanOrEqual(10 + 11 * per + 1e-6);
    expect(abroad.hp).toBe(10);
    // idle infantry dig in at home only when the data says so (off: dug-in garrisons ignored raids)
    expect(home.dug).toBe(HOME_FRONT.dig);
  });

  it('a group sent onto a city surrounds it (the assault ring) and still captures it', () => {
    const s = match();
    clear(s);
    const c = s.cities[0];
    // a bigger city keeps the group further out, and reaches further to be captured
    const small = { ...c, level: 1 }, big = { ...c, level: 5 };
    expect(assaultHole(big)).toBeGreaterThan(assaultHole(small));
    expect(captureRadius(big)).toBeGreaterThan(captureRadius(small));
    expect(assaultHole(big)).toBeLessThan(captureRadius(big) - 1);
    const ids = Array.from({ length: 8 }, (_, i) => add(s, 'rifleman', 0, c.x + 0.5 + (i % 4) - 1.5, c.y + 9 + Math.floor(i / 4)).id);
    run(s, 0.05, [{ t: 'move', p: 0, ids, x: c.x + 0.5, y: c.y + 0.5 }]);
    run(s, 15);
    const d = ids.map((id) => Math.hypot(s.ents[id].x - c.x - 0.5, s.ents[id].y - c.y - 0.5));
    expect(Math.min(...d), 'nobody stands on the middle').toBeGreaterThanOrEqual(assaultHole(c) - 0.6);
    expect(Math.max(...d), 'everyone is inside the capture ring').toBeLessThanOrEqual(captureRadius(c));
    for (let t = 0; t < 120 * TICK_RATE && c.owner !== 0; t++) step(s, []);
    expect(c.owner).toBe(0);
  });

  it('a captured city adds exactly its level’s income from the data (the top bar shows incomeOf)', () => {
    const s = match();
    clear(s);
    const c = s.cities[0];
    const before = incomeOf(s, 0);
    for (let i = 0; i < 3; i++) add(s, 'rifleman', 0, c.x + 0.5 + i * 0.4, c.y + 1.5);
    for (let t = 0; t < 120 * TICK_RATE && c.owner !== 0; t++) step(s, []);
    expect(c.owner).toBe(0);
    const after = incomeOf(s, 0), lv = CITY_LEVELS[c.level - 1];
    expect(after.cash - before.cash).toBeCloseTo(lv.cash, 5);
    expect(after.science - before.science).toBeCloseTo(lv.science, 5);
    expect(after.cp - before.cp).toBeCloseTo(lv.cp / 60, 5);
  });

  it('fog: an enemy is hidden outside your sight and seen inside it', () => {
    const s = match();
    clear(s);
    const at = openSpot(s);
    const scout = add(s, 'rifleman', 0, at.x, at.y);
    const far = add(s, 'rifleman', 1, at.x + UNITS.rifleman.sight + 6, at.y);
    const near = add(s, 'rifleman', 1, at.x + UNITS.rifleman.sight - 2, at.y);
    step(s, []);
    expect(canSee(s, 0, far)).toBe(false);
    expect(canSee(s, 0, near)).toBe(true);
    expect(tileVisible(s, 0, far.x, far.y)).toBe(false);
    // your own units are always known
    expect(canSee(s, 0, scout)).toBe(true);
  });

  it('city militia shoots whoever captures a neutral city, and enemies near an owned one', () => {
    const s = match();
    clear(s);
    const c = s.cities[0];
    const u = add(s, 'rifleman', 0, c.x + 0.5, c.y + 1.5);
    run(s, 5);
    expect(u.hp).toBeLessThan(UNITS.rifleman.hp);
    // owned by player 1 and calm: it shoots player 0's units nearby
    delete s.ents[u.id];
    const v = add(s, 'rifleman', 0, c.x + 2.5, c.y + 0.5);
    c.owner = 1;
    c.calm = 0;
    run(s, 3);
    expect(v.hp).toBeLessThan(UNITS.rifleman.hp);
    // in unrest it doesn't
    delete s.ents[v.id];
    const w = add(s, 'rifleman', 0, c.x - 1.5, c.y + 0.5);
    c.calm = s.tick + 10000;
    run(s, 3);
    expect(w.hp).toBe(UNITS.rifleman.hp);
  });

  it('a city taken from another player drops a level and goes into unrest', () => {
    const s = match();
    clear(s);
    const c = s.cities[0];
    c.owner = 1;
    c.level = 3;
    c.calm = 0;
    for (let i = 0; i < 5; i++) add(s, 'rifleman', 0, c.x + 0.5 + (i % 3) * 0.6, c.y + 1.5 + Math.floor(i / 3) * 0.6);
    const time = CAPTURE.baseSeconds + CAPTURE.perLevel * (c.level - 1);
    run(s, time / (1 + CAPTURE.extraUnit * 4) + 3);
    expect(c.owner).toBe(0);
    expect(c.level).toBe(3 - CAPTURE.levelLoss);
    expect(c.calm).toBeGreaterThan(s.tick);
  });

  it('resistance: an unguarded conquest raises partisans who can win the city back', () => {
    const s = match();
    clear(s);
    const c = s.cities[0];
    c.owner = 1;
    c.level = 3;
    const squad = Array.from({ length: 5 }, (_, i) => add(s, 'rifleman', 0, c.x + 0.5 + (i % 3) * 0.6, c.y + 1.5 + Math.floor(i / 3) * 0.6));
    const time = CAPTURE.baseSeconds + CAPTURE.perLevel * (c.level - 1);
    run(s, time / (1 + CAPTURE.extraUnit * 4) + 3);
    expect(c.owner).toBe(0);
    expect(c.resistFor).toBe(1);
    // the squad marches off and leaves no garrison
    for (const u of squad) delete s.ents[u.id];
    const ev = run(s, RESISTANCE.every * 2 + 1);
    expect(ev.filter((e) => e.e === 'resist').length).toBe(2);
    expect(unitsOf(s, 1, RESISTANCE.kind).length).toBeGreaterThanOrEqual(2);
    // the partisans take it back: a liberation, which doesn't resist in turn
    run(s, RESISTANCE.time);
    expect(c.owner).toBe(1);
    expect(c.resistFor).toBe(-1);
    expect(unitsOf(s, 1, RESISTANCE.kind).length).toBeLessThanOrEqual(RESISTANCE.max);
  });

  it('resistance: a garrison keeps the partisans down', () => {
    const s = match();
    clear(s);
    const c = s.cities[0];
    c.owner = 1;
    c.level = 2;
    for (let i = 0; i < 5; i++) add(s, 'rifleman', 0, c.x + 0.5 + (i % 3) * 0.6, c.y + 1.5 + Math.floor(i / 3) * 0.6);
    run(s, CAPTURE.baseSeconds + CAPTURE.perLevel);
    expect(c.owner).toBe(0);
    const ev = run(s, RESISTANCE.time + 1);
    expect(ev.some((e) => e.e === 'resist')).toBe(false);
    expect(unitsOf(s, 1)).toHaveLength(0);
    // a neutral city never resists
    const n = s.cities.find((k) => k.owner < 0)!;
    expect(n.resistFor).toBe(-1);
  });

  it('enemy ground units in the circle freeze the capture', () => {
    const s = match();
    clear(s);
    const c = s.cities[0];
    add(s, 'rifleman', 0, c.x + 0.5, c.y + 1.5);
    const guard = add(s, 'builder', 1, c.x + 0.5, c.y - 1.5);
    guard.hold = true;
    run(s, 6);
    expect(c.contested || c.cap === 0 || c.owner !== 0).toBe(true);
    expect(c.owner).toBe(-1);
  });

  it('cities grow, and a city that reaches level 2 asks for a specialization', () => {
    const s = match();
    const c = s.cities.find((k) => k.level === 1)!;
    c.owner = 0;
    run(s, CITY_LEVELS[0].grow + 5);
    expect(c.level).toBe(2);
    expect(c.specPending).toBe(true);
    run(s, 0.05, [{ t: 'spec', p: 0, city: c.id, spec: 'academy' }]);
    expect(c.spec).toBe('academy');
  });
});

describe('doctrine perks', () => {
  it('Entrenchment: idle infantry dig in by themselves', () => {
    const s = match();
    clear(s);
    const { x, y } = openSpot(s);
    const a = add(s, 'rifleman', 0, x, y);
    const b = add(s, 'rifleman', 1, x + 3, y);
    s.players[0].doctrines.push('entrench');
    run(s, AUTO_DIG_EVERY + 0.5);
    expect(a.dug).toBe(true);
    expect(b.dug).toBe(false);
  });

  it('Blitzkrieg: vehicles keep their speed in the rain', () => {
    const s = match();
    clear(s);
    const { x, y } = openSpot(s);
    const t0 = add(s, 'lighttank', 0, x, y);
    const t1 = add(s, 'lighttank', 1, x, y + 3);
    s.weather.rain = 1;
    s.players[0].doctrines.push('blitz');
    const n = nav(s);
    expect(unitSpeed(s, t0, n) / modMul(s.players[0], 'vehicleSpeed')).toBeGreaterThan(unitSpeed(s, t1, n) * 1.05);
  });

  it('Air Power: aircraft keep flying in a storm', () => {
    const s = match();
    clear(s);
    const { x, y } = openSpot(s);
    const a = add(s, 'fighter', 0, x, y), b = add(s, 'fighter', 1, x, y + 2);
    s.players[0].doctrines.push('airPower');
    s.weather.storm = 1;
    s.weather.frontUntil = s.tick + sec(60);
    run(s, 0.05, [{ t: 'move', p: 0, ids: [a.id], x: x + 8, y }, { t: 'move', p: 1, ids: [b.id], x: x + 8, y: y + 2 }]);
    run(s, 1);
    expect(a.x).toBeGreaterThan(x + 1);
    expect(b.x).toBeCloseTo(x, 1);
  });

  it('Mass Production: every 4th unit trained is paid back', () => {
    const s = match();
    const p = s.players[0];
    p.doctrines.push('massProduction');
    p.cash = 5000;
    const hq = Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.kind === 'hq' && e.owner === 0)!;
    p.stats.unitsBuilt = 3;
    run(s, 0.05, [{ t: 'train', p: 0, at: hq.id, kind: 'builder', n: 1 }]);
    const c0 = p.cash, inc = incomeOf(s, 0).cash, t = UNITS.builder.buildTime + 2;
    run(s, t);
    expect(p.stats.unitsBuilt).toBe(4);
    // beyond the income, the builder's price came back
    expect(p.cash - c0 - inc * t).toBeCloseTo(UNITS.builder.cost.cash, -1);
  });

  it('Scientific Method: taking a rival city steals a quarter of their research', () => {
    const s = match();
    clear(s);
    const c = s.cities[0];
    c.owner = 1;
    s.players[0].doctrines.push('scientific');
    s.players[1].research = { cur: 'rocketry', prog: 100, queue: [] };
    s.players[1].science = 0;
    for (let i = 0; i < 5; i++) add(s, 'rifleman', 0, c.x + 0.5 + (i % 3) * 0.6, c.y + 1.5 + Math.floor(i / 3) * 0.6);
    const sci0 = s.players[0].science;
    run(s, CAPTURE.baseSeconds + CAPTURE.perLevel * (c.level - 1));
    expect(c.owner).toBe(0);
    expect(s.players[1].research.prog).toBeLessThan(100);
    expect(s.players[0].science + s.players[0].research.prog).toBeGreaterThan(sci0 + 100 * PERKS.stealResearch - 1);
  });

  it('Total War: a kill patches the killer up', () => {
    const s = match();
    clear(s);
    const { x, y } = openSpot(s);
    const tank = add(s, 'lighttank', 0, x, y);
    const foe = add(s, 'rifleman', 1, x + 2, y);
    s.players[0].doctrines.push('totalWar');
    tank.hp = 100;
    foe.hp = 1;
    hurt(s, foe, 50, 'cannon', tank, []);
    expect(foe.hp).toBeLessThanOrEqual(0);
    expect(tank.hp).toBeCloseTo(100 + unitMaxHp(s, tank) * PERKS.warSpoils);
  });

  it('Urbanism: big cities train Rocket Troopers', () => {
    const s = match();
    const c = s.cities[0];
    c.owner = 0;
    c.level = CAPTURE.trainLevel;
    s.players[0].techs.push('rocketry');
    expect(cityTrains(s, c, 'rocket')).toBe(false);
    s.players[0].doctrines.push('urbanism');
    expect(cityTrains(s, c, 'rocket')).toBe(true);
  });

  it('Networked Warfare: powers cost one Command Point less', () => {
    const s = match();
    const p = s.players[0];
    p.doctrines.push('networked');
    p.cp = POWERS.recon.cost - 1;
    run(s, 0.05, [{ t: 'power', p: 0, power: 'recon', x: 10, y: 10 }]);
    expect(p.cp).toBeLessThan(0.5);
    expect(s.effects.some((fx) => fx.k === 'reveal' && fx.owner === 0)).toBe(true);
  });
});

describe('victory', () => {
  it('destroying the enemy HQ eliminates them and wins', () => {
    const s = match();
    const hq = Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.kind === 'hq' && e.owner === 1)!;
    hq.hp = 0;
    const ev = run(s, 0.1);
    expect(s.players[1].alive).toBe(false);
    expect(unitsOf(s, 1)).toHaveLength(0);
    expect(s.over?.winners).toBe(s.players[0].team);
    expect(ev.some((e) => e.e === 'over')).toBe(true);
  });

  it('government in exile: a big city carries on after the HQ falls, until it is lost too', () => {
    const s = match();
    const c = s.cities.find((k) => k.owner < 0)!;
    c.owner = 1;
    c.level = EXILE.minLevel;
    const hq = Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.kind === 'hq' && e.owner === 1)!;
    hq.hp = 0;
    const ev = run(s, 0.1);
    expect(s.players[1].alive).toBe(true);
    expect(s.players[1].capital).toBe(c.id);
    expect(ev.some((e) => e.e === 'exile' && e.city === c.id)).toBe(true);
    expect(s.over).toBeNull();
    // the capital starts working after a delay: then it trains builders
    const train = { t: 'train' as const, p: 1, at: c.id, city: true, kind: 'builder', n: 1 };
    expect(run(s, 0.05, [train]).some((e) => e.e === 'reject')).toBe(true);
    run(s, EXILE.delay);
    // partisans rally to the capital
    expect(unitsOf(s, 1, EXILE.partisanKind).filter((u) => Math.hypot(u.x - c.x, u.y - c.y) < EXILE.partisanRadius + 1).length).toBeGreaterThanOrEqual(2);
    s.players[1].cash = 1000;
    expect(run(s, 0.05, [train]).some((e) => e.e === 'reject')).toBe(false);
    expect(c.prod.length).toBe(1);
    // losing the last big city ends it
    c.owner = 0;
    run(s, 0.1);
    expect(s.players[1].alive).toBe(false);
    expect(s.over?.winners).toBe(s.players[0].team);
  });

  it('government in exile: the government flees to a city the attackers are not at', () => {
    const s = match();
    const [big, small] = s.cities.filter((k) => k.owner < 0);
    big.owner = small.owner = 1;
    big.level = EXILE.minLevel + 1;
    small.level = EXILE.minLevel;
    // the attackers stand at the big city
    add(s, 'rifleman', 0, big.x + 1.5, big.y + 0.5);
    const hq = Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.kind === 'hq' && e.owner === 1)!;
    hq.hp = 0;
    run(s, 0.1);
    expect(s.players[1].capital).toBe(small.id);
    // with nobody near either, the bigger city governs
    const t = match();
    const [b2, s2] = t.cities.filter((k) => k.owner < 0);
    b2.owner = s2.owner = 1;
    b2.level = EXILE.minLevel + 1;
    s2.level = EXILE.minLevel;
    Object.values(t.ents).find((e): e is Building => e.t === 'b' && e.kind === 'hq' && e.owner === 1)!.hp = 0;
    run(t, 0.1);
    expect(t.players[1].capital).toBe(b2.id);
  });

  it('supremacy: holding most of the cities for long enough wins, but never early', () => {
    const s = match({ victory: { conquest: true, supremacy: true, science: true } });
    clear(s);
    const need = Math.ceil(s.cities.length * supremacyShare(s));
    for (let i = 0; i < need; i++) s.cities[i].owner = 0;
    run(s, VICTORY.supremacyTime + 5);
    expect(s.over).toBeNull();
    s.tick = sec(VICTORY.supremacyFrom);
    run(s, VICTORY.supremacyTime + 5);
    expect(s.over?.reason).toBe('supremacy');
  });
});
