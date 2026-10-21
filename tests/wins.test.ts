// Win conditions as scripted headless matches: science, time limit, and the lobby toggles.
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/data/buildings';
import { TECHS } from '../src/data/techs';
import { COALITION, CONVOY, SCRUB, VICTORY } from '../src/data/rules';
import { hurt, placeBuilding } from '../src/sim/lifecycle';
import { placementProblem } from '../src/sim/commands';
import { score, supremacyFrom, supremacyShare, timeLimitOf } from '../src/sim/victory';
import { sec } from '../src/sim/world';
import { compOf, nav } from '../src/sim/nav';
import type { Building, Command, MatchState } from '../src/sim/types';
import { add, match, openSpot, run, setup, unitsOf } from './helpers';

/** Give player p every tech and plenty of resources. */
function rich(s: MatchState, p: number) {
  const pl = s.players[p];
  pl.techs = TECHS.map((t) => t.id);
  pl.cash = 200000;
  pl.oil = 20000;
}

/** A legal spot for `kind` near player p's start, searched in rings. */
function spotFor(s: MatchState, p: number, kind: string): { tx: number; ty: number } {
  const st = s.map.starts[p];
  for (let r = 4; r < 30; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = Math.floor(st.x) + dx, ty = Math.floor(st.y) + dy;
        if (!placementProblem(s, p, kind, tx, ty)) return { tx, ty };
      }
  throw new Error('no spot for ' + kind);
}

/** A land tile of ground area `land` beside water of sea `sea` (any sea if null), about `dist` tiles from (x, y). */
function beach(s: MatchState, land: number, sea: number | null, x: number, y: number, dist: number): { land: [number, number]; water: [number, number] } {
  const n = nav(s);
  let best: { land: [number, number]; water: [number, number] } | null = null, bd = Infinity;
  for (let ty = 1; ty < s.map.h - 1; ty++)
    for (let tx = 1; tx < s.map.w - 1; tx++) {
      if (compOf(n, 'ground', tx, ty) !== land) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = compOf(n, 'naval', tx + dx, ty + dy);
        if (c < 0 || (sea !== null && c !== sea)) continue;
        const d = Math.abs(Math.hypot(tx - x, ty - y) - dist);
        if (d < bd) { bd = d; best = { land: [tx, ty], water: [tx + dx, ty + dy] }; }
      }
    }
  if (!best) throw new Error('no beach');
  return best;
}

/** Order player p's builders to put up a launch site; returns once it is finished. */
function buildLaunchSite(s: MatchState, p: number): { site: Building; ev: ReturnType<typeof run> } {
  const ids = unitsOf(s, p, 'builder').map((u) => u.id);
  const at = spotFor(s, p, 'launch');
  const cmd: Command = { t: 'build', p, ids, kind: 'launch', ...at };
  const ev = run(s, 0.05, [cmd]);
  const site = Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.kind === 'launch' && e.owner === p)!;
  expect(site).toBeTruthy();
  for (let t = 0; t < BUILDINGS.launch.buildTime * 2 && site.built < 1; t += 5) ev.push(...run(s, 5));
  expect(site.built).toBe(1);
  return { site, ev };
}

describe('win conditions', () => {
  it('science: a finished launch site starts a countdown everyone hears about, then wins', () => {
    const s = match();
    rich(s, 0);
    const { ev } = buildLaunchSite(s, 0);
    const launch = ev.find((e) => e.e === 'launch');
    expect(launch).toBeTruthy();
    // the event is shared (every peer gets non-reject events), so everyone is told
    expect(launch && launch.e === 'launch' && launch.p).toBe(0);
    expect(s.launch).not.toBeNull();
    expect(s.over).toBeNull();
    run(s, VICTORY.launchTime - 2);
    expect(s.over).toBeNull();
    run(s, 3);
    expect(s.over?.reason).toBe('science');
    expect(s.over?.winners).toBe(s.players[0].team);
  });

  it('science: destroying the launch site stops the countdown', () => {
    const s = match();
    rich(s, 0);
    const { site } = buildLaunchSite(s, 0);
    expect(s.launch).not.toBeNull();
    site.hp = 0;
    run(s, 0.1);
    expect(s.launch).toBeNull();
    run(s, VICTORY.launchTime + 5);
    expect(s.over).toBeNull();
  });

  it('scrub: enemy infantry beside the site delay the launch, unless defending infantry are there', () => {
    const s = match();
    rich(s, 0);
    const { site } = buildLaunchSite(s, 0);
    const done = s.launch!.done;
    const edge = BUILDINGS.launch.h / 2 + 1;
    // the starting riflemen stand close enough to guard it: send them away
    for (const u of unitsOf(s, 0, 'rifleman')) delete s.ents[u.id];
    // the HQ's guns are close by: these have HP to spare for the test
    const foe = add(s, 'rifleman', 1, site.x, site.y + edge);
    foe.hold = true;
    foe.hp = 1e6;
    // guarded: nothing happens
    const guard = add(s, 'rifleman', 0, site.x + 1, site.y + edge);
    guard.hold = true;
    guard.hp = 1e6;
    run(s, SCRUB.time + 2);
    expect(s.launch!.done).toBe(done);
    // unguarded: the countdown slips, and everyone is told
    delete s.ents[guard.id];
    const ev = run(s, SCRUB.time + 1);
    if (!s.ents[foe.id]) throw new Error('the saboteur died');
    expect(s.launch!.done).toBe(done + sec(SCRUB.delay));
    expect(ev.some((e) => e.e === 'scrub' && e.by === 1)).toBe(true);
  });

  it('builders repair at most three at a time, and not while an armed enemy is close', () => {
    const s = match();
    rich(s, 0);
    const at = spotFor(s, 0, 'barracks');
    const ids = unitsOf(s, 0, 'builder').map((u) => u.id);
    run(s, 0.05, [{ t: 'build', p: 0, ids, kind: 'barracks', ...at }]);
    const b = Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.kind === 'barracks')!;
    for (let i = 0; i < 40 && b.built < 1; i++) run(s, 5);
    expect(b.built).toBe(1);
    // six builders heal no faster than three
    const heal = (n: number) => {
      const crew = [...ids];
      while (crew.length < n) crew.push(add(s, 'builder', 0, b.x, b.y + 3).id);
      b.hp = BUILDINGS.barracks.hp / 2;
      run(s, 0.05, [{ t: 'assist', p: 0, ids: crew.slice(0, n), target: b.id }]);
      run(s, 3);
      const before = b.hp;
      run(s, 2);
      return b.hp - before;
    };
    const three = heal(3), six = heal(6);
    expect(three).toBeGreaterThan(0);
    expect(six).toBeCloseTo(three, 0);
    // an enemy rifleman in range stops repairs
    const foe = add(s, 'rifleman', 1, b.x, b.y + BUILDINGS.barracks.h / 2 + 2);
    foe.hold = true;
    foe.hp = 1e6;
    b.hp = BUILDINGS.barracks.hp / 2;
    run(s, 1);
    const before = b.hp;
    run(s, 2);
    expect(b.hp).toBeLessThanOrEqual(before);
  });

  it('convoys: a coastal city sends merchant ships that pay at your dock, and sinking one pays the raider', () => {
    const s = match({ mapType: 'islands', seed: 3 });
    rich(s, 0);
    // a coastal city of ours with a dock beside it
    let dock: Building | undefined;
    for (const c of s.cities) {
      if (!c.coastal || dock) continue;
      for (let r = 2; r < 9 && !dock; r++)
        for (let dy = -r; dy <= r && !dock; dy++)
          for (let dx = -r; dx <= r && !dock; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (!placementProblem(s, 0, 'dock', c.x + dx, c.y + dy)) {
              dock = placeBuilding(s, 'dock', 0, c.x + dx, c.y + dy, 1);
              c.owner = 0;
              c.calm = 0;
            }
          }
    }
    expect(dock).toBeTruthy();
    const ev = run(s, CONVOY.every * 2 + 60);
    const paid = ev.filter((e) => e.e === 'convoy' && e.p === 0 && e.by === -1);
    expect(paid.length, 'a merchant arrived').toBeGreaterThan(0);
    // a merchant sunk by an enemy pays half its cargo to the enemy
    const m = add(s, CONVOY.kind, 0, dock!.x, dock!.y + 6);
    const cash1 = s.players[1].cash;
    hurt(s, m, 1e6, 'torpedo', add(s, 'rifleman', 1, m.x, m.y), []);
    expect(s.players[1].cash - cash1).toBe(Math.round(CONVOY.cash * CONVOY.loot));
  });

  it('islands: an invasion by transport ships takes out the enemy HQ', () => {
    const s = match({ mapType: 'islands', seed: 3 });
    rich(s, 0);
    const n = nav(s);
    const a = s.map.starts[0];
    // the start tile is under the HQ: ask where a starting builder stands
    const island = (p: number) => { const u = unitsOf(s, p, 'builder')[0]; return compOf(n, 'ground', Math.floor(u.x), Math.floor(u.y)); };
    const ours = island(0), theirs = island(1);
    expect(ours).toBeGreaterThanOrEqual(0);
    expect(ours, 'each start has its own island').not.toBe(theirs);
    // a landing beach on their island (out of reach of their HQ's guns), and one by our HQ on the same sea
    const hq = Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.kind === 'hq' && e.owner === 1)!;
    const land = beach(s, theirs, null, hq.x, hq.y, 12);
    const home = beach(s, ours, compOf(n, 'naval', land.water[0], land.water[1]), a.x, a.y, 6);
    // two ships, each with a Heavy Tank, an Artillery and two Rocket Troopers waiting on the shore
    // (the HQ outlasts four Heavy Tanks on its own: cracking it takes siege guns)
    const party: number[] = [];
    const ships = [0, 1].map(() => add(s, 'transport', 0, home.water[0] + 0.5, home.water[1] + 0.5));
    for (const ship of ships) {
      const ids = ['heavytank', 'artillery', 'rocket', 'rocket'].map((k) => add(s, k, 0, home.land[0] + 0.5, home.land[1] + 0.5).id);
      party.push(...ids);
      run(s, 0.05, [{ t: 'load', p: 0, ids, target: ship.id }]);
    }
    for (let i = 0; i < 60 && ships.some((sh) => sh.cargo.length < 4); i++) run(s, 1);
    expect(ships.map((sh) => sh.cargo.length), 'everyone aboard').toEqual([4, 4]);
    run(s, 0.05, [{ t: 'unload', p: 0, ids: ships.map((sh) => sh.id), x: land.land[0] + 0.5, y: land.land[1] + 0.5 }]);
    for (let i = 0; i < 240 && ships.some((sh) => sh.cargo.length); i++) run(s, 1);
    expect(ships.map((sh) => sh.cargo.length), 'everyone ashore').toEqual([0, 0]);
    const ashore = party.filter((id) => s.ents[id] && compOf(n, 'ground', Math.floor(s.ents[id].x), Math.floor(s.ents[id].y)) === theirs);
    expect(ashore.length).toBe(8);
    run(s, 0.05, [{ t: 'attack', p: 0, ids: ashore, target: hq.id }]);
    for (let i = 0; i < 600 && !s.over; i++) run(s, 1);
    expect(s.over?.reason).toBe('conquest');
    expect(s.over?.winners).toBe(s.players[0].team);
  });

  it('science off: a launch site does nothing', () => {
    const s = match({ victory: { conquest: true, supremacy: true, science: false } });
    rich(s, 0);
    const { ev } = buildLaunchSite(s, 0);
    expect(ev.some((e) => e.e === 'launch')).toBe(false);
    expect(s.launch).toBeNull();
    run(s, VICTORY.launchTime + 5);
    expect(s.over).toBeNull();
  });

  it('supremacy off: holding every city never wins', () => {
    const s = match({ victory: { conquest: true, supremacy: false, science: true } });
    for (const c of s.cities) c.owner = 0;
    s.tick = sec(VICTORY.supremacyFrom);
    run(s, VICTORY.supremacyTime + 5);
    expect(s.over).toBeNull();
  });

  it('supremacy: with four teams the clock opens ten minutes later', () => {
    const s = match({}, 4);
    expect(supremacyFrom(s)).toBe(VICTORY.supremacyFrom + 2 * VICTORY.supremacyFromPerTeam);
    for (const c of s.cities) c.owner = 0;
    s.tick = sec(VICTORY.supremacyFrom);
    run(s, 5);
    expect(s.supremacy[0] ?? -1, 'too early in a free-for-all').toBe(-1);
    s.tick = sec(supremacyFrom(s));
    run(s, 2);
    expect(s.supremacy[0]).toBeGreaterThanOrEqual(0);
  });

  it('supremacy: a 2v2 opens later than a duel and needs a bigger share', () => {
    const duel = match({}, 2);
    const s = match({ players: [0, 0, 1, 1].map((team, i) => ({ name: `P${i}`, team, color: i, kind: 'passive' as const })) });
    expect(supremacyFrom(duel)).toBe(VICTORY.supremacyFrom);
    expect(supremacyFrom(s)).toBe(VICTORY.supremacyFrom + 2 * VICTORY.supremacyFromPerPlayer);
    expect(supremacyShare(s)).toBe(VICTORY.teamShare);
    expect(supremacyShare(duel)).toBe(VICTORY.supremacyShares[2]);
    // a 4-way free-for-all keeps its later, per-team opening
    expect(supremacyFrom(match({}, 4))).toBe(VICTORY.supremacyFrom + 2 * VICTORY.supremacyFromPerTeam);
  });

  it('time limit: the best score wins when time runs out', () => {
    const s = match({ timeLimit: 120 });
    // team 1 holds two cities, so it is ahead on score
    s.cities.filter((c) => c.owner < 0).slice(0, 2).forEach((c) => (c.owner = 1));
    expect(score(s, s.players[1].team)).toBeGreaterThan(score(s, s.players[0].team));
    run(s, 119);
    expect(s.over).toBeNull();
    run(s, 2);
    expect(s.over?.reason).toBe('time');
    expect(s.over?.winners).toBe(s.players[1].team);
  });

  it('time limit: Auto is 45 min in a big or naval match, and none in a small land one', () => {
    const base = setup({ timeLimit: -1 }, 2);
    expect(timeLimitOf(base)).toBe(0);
    expect(timeLimitOf({ ...base, mapType: 'islands' })).toBe(VICTORY.autoLimit);
    expect(timeLimitOf(setup({ timeLimit: -1 }, VICTORY.autoLimitPlayers))).toBe(VICTORY.autoLimit);
    // a set limit is kept as it is
    expect(timeLimitOf({ ...base, mapType: 'islands', timeLimit: 0 })).toBe(0);
    // and the match ends on it
    const s = match({ timeLimit: -1, mapType: 'continents' });
    s.tick = sec(VICTORY.autoLimit) - 1;
    run(s, 0.1);
    expect(s.over?.reason).toBe('time');
  });

  it('coalition: a launch turns everyone else on the launcher, until it stops', () => {
    const s = match({}, 3);
    rich(s, 0);
    for (const p of s.players) p.cp = 0;
    const { site, ev } = buildLaunchSite(s, 0);
    expect(s.coalition).toBe(s.players[0].team);
    expect(ev.some((e) => e.e === 'coalition' && e.team === s.players[0].team)).toBe(true);
    expect(s.players[1].cp).toBeGreaterThanOrEqual(COALITION.cp);
    expect(s.players[0].cp).toBeLessThan(COALITION.cp);
    // the coalition hits the leader harder than anyone else
    const at = openSpot(s);
    const shooter = add(s, 'rifleman', 1, at.x, at.y);
    const leader = add(s, 'heavytank', 0, at.x + 1, at.y);
    const other = add(s, 'heavytank', 2, at.x, at.y + 1);
    const hp0 = leader.hp, hp2 = other.hp;
    hurt(s, leader, 100, 'cannon', shooter, []);
    shooter.vet = 0; // the first hit may have earned a star
    hurt(s, other, 100, 'cannon', shooter, []);
    expect((hp0 - leader.hp) / (hp2 - other.hp)).toBeCloseTo(COALITION.damageVs);
    // the site falls: the coalition breaks up
    site.hp = 0;
    const after = run(s, 0.1);
    expect(s.coalition).toBe(-1);
    expect(after.some((e) => e.e === 'coalition' && e.team === -1)).toBe(true);
  });

  it('conquest: allies win together when the last enemy falls', () => {
    const s = match({}, 3);
    s.players[1].team = 0; // players 0 and 1 are allies against player 2
    const hq = Object.values(s.ents).find((e): e is Building => e.t === 'b' && e.kind === 'hq' && e.owner === 2)!;
    hq.hp = 0;
    run(s, 0.1);
    expect(s.over?.reason).toBe('conquest');
    expect(s.over?.winners).toBe(0);
    expect(s.players[0].alive && s.players[1].alive).toBe(true);
  });
});
