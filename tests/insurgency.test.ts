// Insurgency: a knocked-out player fights on with partisan drops and can re-found their government.
import { describe, expect, it } from 'vitest';
import { INSURGENCY } from '../src/data/rules';
import { removeEnt } from '../src/sim/lifecycle';
import { createAi } from '../src/sim/ai';
import { step } from '../src/sim/match';
import { hqOf, insurgent, unitMaxHp } from '../src/sim/world';
import { canSee } from '../src/sim/vision';
import { charges, squadProgress } from '../src/sim/insurgency';
import type { City, Command, MatchState, SimEvent } from '../src/sim/types';
import { TICK_RATE } from '../src/sim/types';
import { add, match, run, unitsOf } from './helpers';

/** Knock player p out: their HQ goes, and the next tick finds them with no capital. */
function knockOut(s: MatchState, p: number) {
  const ev: SimEvent[] = [];
  removeEnt(s, hqOf(s, p)!, ev);
  run(s, 1 / TICK_RATE);
  expect(s.players[p].alive).toBe(false);
}

/** The neutral city farthest from every start (quiet ground for a test). */
function quietCity(s: MatchState): City {
  let best: City | undefined, bd = -1;
  for (const c of s.cities) {
    if (c.owner >= 0) continue;
    const d = Math.min(...s.map.starts.map((st) => Math.hypot(st.x - c.x, st.y - c.y)));
    if (d > bd) { bd = d; best = c; }
  }
  return best!;
}

const drop = (s: MatchState, p: number, city: number): SimEvent[] => run(s, 1 / TICK_RATE, [{ t: 'insurge', p, city }]);
const rejected = (ev: SimEvent[]) => ev.some((e) => e.e === 'reject');

describe('insurgency', () => {
  it('a knocked-out player drops partisans at a neutral city, on a cooldown, and only where allowed', () => {
    const s = match({}, 3);
    const c = quietCity(s);
    // still in the match: no drops
    expect(rejected(drop(s, 2, c.id))).toBe(true);
    knockOut(s, 2);
    const p = s.players[2];
    expect(insurgent(s, p)).toBe(true);
    // not straight away
    expect(rejected(drop(s, 2, c.id))).toBe(true);
    run(s, INSURGENCY.first);
    const ev = drop(s, 2, c.id);
    expect(rejected(ev)).toBe(false);
    expect(ev.some((e) => e.e === 'insurge' && e.p === 2 && e.city === c.id)).toBe(true);
    const squad = unitsOf(s, 2, INSURGENCY.kind);
    expect(squad.length).toBe(INSURGENCY.squad);
    for (const u of squad) expect(Math.hypot(u.x - c.x - 0.5, u.y - c.y - 0.5)).toBeLessThan(6);
    // then a cooldown
    expect(rejected(drop(s, 2, c.id))).toBe(true);
    run(s, INSURGENCY.every);
    // never at a rival's city they didn't hold
    const other = s.cities.find((o) => o.id !== c.id && o.owner < 0)!;
    other.owner = 0;
    expect(rejected(drop(s, 2, other.id))).toBe(true);
    // but at one they once held
    p.held.push(other.id);
    const before = unitsOf(s, 2, INSURGENCY.kind).length;
    expect(rejected(drop(s, 2, other.id))).toBe(false);
    expect(unitsOf(s, 2, INSURGENCY.kind).length).toBe(before + INSURGENCY.squad);
    // an insurgent moves their own units, and nothing else
    const ids = unitsOf(s, 2).map((u) => u.id);
    run(s, 1, [{ t: 'move', p: 2, ids, x: c.x + 3.5, y: c.y + 0.5 }]);
    expect(ids.some((id) => s.ents[id]?.t === 'u' && (s.ents[id] as { order: unknown }).order)).toBe(true);
    expect(rejected(run(s, 1 / TICK_RATE, [{ t: 'research', p: 2, tech: 'logistics' } as Command]))).toBe(false);
    expect(s.players[2].research.cur).toBe(null);
  });

  it('insurgents take a city and, holding a town long enough, re-found their government there', () => {
    const s = match({}, 3);
    const c = quietCity(s);
    c.level = INSURGENCY.minLevel;
    knockOut(s, 2);
    run(s, INSURGENCY.first);
    drop(s, 2, c.id);
    const ev = run(s, 60);
    expect(c.owner).toBe(2);
    expect(s.players[2].held).toContain(c.id);
    expect(ev.some((e) => e.e === 'rising' && e.p === 2 && e.city === c.id)).toBe(true);
    expect(s.players[2].alive).toBe(false);
    const back = run(s, INSURGENCY.hold);
    expect(back.some((e) => e.e === 'refound' && e.p === 2 && e.city === c.id)).toBe(true);
    expect(s.players[2].alive).toBe(true);
    expect(s.players[2].capital).toBe(c.id);
    // and the government in exile holds: still in a while later
    run(s, 5);
    expect(s.players[2].alive).toBe(true);
    // one comeback a match: knocked out again, they are out for good
    c.owner = 0;
    run(s, 1);
    expect(s.players[2].alive).toBe(false);
    expect(insurgent(s, s.players[2])).toBe(false);
    run(s, INSURGENCY.first + 1);
    expect(rejected(drop(s, 2, quietCity(s).id))).toBe(false); // dropped silently: not a player any more
    expect(unitsOf(s, 2).length).toBe(0);
  });

  it('banks a squad every cooldown, up to a cap, and a drop sends every banked squad', () => {
    const s = match({}, 3);
    const c = quietCity(s);
    knockOut(s, 2);
    const p = s.players[2];
    expect(charges(s, p)).toBe(0);
    run(s, INSURGENCY.first);
    expect(charges(s, p)).toBe(1);
    run(s, INSURGENCY.every);
    expect(charges(s, p)).toBe(2);
    // the bank stops filling at the cap
    run(s, INSURGENCY.every * (INSURGENCY.maxCharges + 1));
    expect(charges(s, p)).toBe(INSURGENCY.maxCharges);
    p.cash = 0; // (no war chest: partisans only)
    const ev = drop(s, 2, c.id);
    const men = INSURGENCY.squad * INSURGENCY.maxCharges;
    expect(ev.some((e) => e.e === 'insurge' && e.n === men)).toBe(true);
    expect(unitsOf(s, 2, INSURGENCY.kind).length).toBe(men);
    // the bank is empty again, and the next squad comes a full cooldown later
    expect(charges(s, p)).toBe(0);
    expect(rejected(drop(s, 2, c.id))).toBe(true);
    // more squads make a bigger city takeable
    c.level = 3;
    expect(squadProgress(s, c, INSURGENCY.maxCharges)).toBeGreaterThan(squadProgress(s, c, 1));
  });

  it('the war chest buys a trooper per squad while the cash lasts', () => {
    const s = match({}, 3);
    const c = quietCity(s);
    knockOut(s, 2);
    const p = s.players[2];
    run(s, INSURGENCY.first + INSURGENCY.every * 2);
    expect(charges(s, p)).toBe(3);
    p.cash = INSURGENCY.chestCost * 2 + 10;
    const ev = drop(s, 2, c.id);
    expect(ev.some((e) => e.e === 'insurge' && e.n === INSURGENCY.squad * 3 + 2)).toBe(true);
    expect(unitsOf(s, 2, INSURGENCY.chestKind).length).toBe(2);
    expect(p.cash).toBeCloseTo(10);
    // the troopers count in the odds
    c.level = 3;
    expect(squadProgress(s, c, 3, 2)).toBeGreaterThan(squadProgress(s, c, 3));
  });

  it('partisans land hidden: no eye or militia sees them for a while, or after they fire', () => {
    const s = match({}, 3);
    const c = quietCity(s);
    c.level = 1;
    knockOut(s, 2);
    run(s, INSURGENCY.first);
    s.players[2].cash = 0;
    drop(s, 2, c.id);
    const squad = unitsOf(s, 2, INSURGENCY.kind);
    const rival = s.players[0].team;
    expect(squad.every((u) => !canSee(s, rival, u))).toBe(true);
    // the city's militia can't find them either: the capture starts unopposed
    run(s, INSURGENCY.hidden - 2);
    expect(squad.every((u) => s.ents[u.id] && u.hp === unitMaxHp(s, u))).toBe(true);
    expect(c.cap).toBeGreaterThan(0);
    // then they're seen like anyone
    run(s, 3);
    expect(squad.filter((u) => s.ents[u.id]).every((u) => u.hide <= s.tick)).toBe(true);
    // and firing gives a hidden one away at once
    const u = add(s, INSURGENCY.kind, 2, c.x + 9, c.y);
    u.hide = s.tick + 100;
    const foe = add(s, 'rifleman', 0, c.x + 11, c.y);
    expect(canSee(s, rival, u)).toBe(false);
    run(s, 2, [{ t: 'attack', p: 2, ids: [u.id], target: foe.id }]);
    expect(u.hide).toBe(0);
  });

  it('counts enemy units standing in the ring against the odds', () => {
    const s = match({}, 3);
    const c = quietCity(s);
    c.level = 1;
    const clear = squadProgress(s, c, 2, 0, 2);
    add(s, 'rifleman', 0, c.x + 1.5, c.y + 0.5);
    add(s, 'rifleman', 0, c.x - 0.5, c.y + 0.5);
    const guarded = squadProgress(s, c, 2, 0, 2);
    expect(guarded).toBeLessThan(clear * 0.75);
    // their own units (or an ally's) don't count against them
    expect(squadProgress(s, c, 2, 0, 0)).toBe(clear);
  });

  it('tells which cities one squad can take past their militia', () => {
    const s = match({}, 3);
    const c = quietCity(s);
    c.level = 1;
    expect(squadProgress(s, c)).toBeGreaterThan(1);
    c.level = 4;
    expect(squadProgress(s, c)).toBeLessThan(1);
    // and it is right: a squad at the village takes it
    c.level = 1;
    knockOut(s, 2);
    run(s, INSURGENCY.first);
    drop(s, 2, c.id);
    run(s, 40);
    expect(c.owner).toBe(2);
  });

  it('losing the city stops the clock', () => {
    const s = match({}, 3);
    const c = quietCity(s);
    c.level = INSURGENCY.minLevel;
    knockOut(s, 2);
    run(s, INSURGENCY.first);
    drop(s, 2, c.id);
    run(s, 60);
    expect(s.players[2].rising).toBe(c.id);
    c.owner = 0;
    run(s, 2);
    expect(s.players[2].rising).toBe(-1);
    run(s, INSURGENCY.hold);
    expect(s.players[2].alive).toBe(false);
  });

  it('is off when the lobby turns it off, and a two-sided match still ends at the knockout', () => {
    const off = match({ insurgency: false }, 3);
    knockOut(off, 2);
    run(off, INSURGENCY.first);
    expect(rejected(drop(off, 2, quietCity(off).id))).toBe(false); // dropped silently: not a player any more
    expect(unitsOf(off, 2).length).toBe(0);
    const duel = match({}, 2);
    removeEnt(duel, hqOf(duel, 1)!, []);
    run(duel, 1);
    expect(duel.over?.reason).toBe('conquest');
  });

  it('a knocked-out AI fights on: it drops partisans by itself', () => {
    const s = match({}, 3);
    s.players[2].kind = 'ai';
    const ai = createAi(s, 2, 'normal');
    knockOut(s, 2);
    const ev: SimEvent[] = [];
    for (let i = 0; i < (INSURGENCY.first + 10) * TICK_RATE; i++) ev.push(...step(s, ai.think(s)));
    expect(ev.some((e) => e.e === 'insurge' && e.p === 2)).toBe(true);
    expect(unitsOf(s, 2).length).toBeGreaterThan(0);
  });
});
