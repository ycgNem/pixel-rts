// City contracts: a city posts a public job (a supply tender, a hold, or a bounty on a leader's city).
import { describe, expect, it } from 'vitest';
import { CONTRACTS, HOME_FRONT } from '../src/data/rules';
import { TECHS } from '../src/data/techs';
import { jobReward, minBid, supplyFloor } from '../src/sim/contracts';
import { capture } from '../src/sim/cities';
import { hqOf, sec } from '../src/sim/world';
import { createAi } from '../src/sim/ai';
import { step } from '../src/sim/match';
import type { City, ContractKind, MatchState, SimEvent } from '../src/sim/types';
import { TICK_RATE } from '../src/sim/types';
import { add, match, run } from './helpers';

/** Open a job of this kind at the neutral city farthest from every start. */
function job(s: MatchState, kind: ContractKind): City {
  let best: City | undefined, bd = -1;
  for (const c of s.cities) {
    if (c.owner >= 0) continue;
    const d = Math.min(...s.map.starts.map((st) => Math.hypot(st.x - c.x, st.y - c.y)));
    if (d > bd) { bd = d; best = c; }
  }
  const closes = kind === 'supply' ? s.tick + sec(CONTRACTS.tender) : 0;
  s.contract = { city: best!.id, kind, until: closes || s.tick + sec(CONTRACTS.open), holder: -1, since: 0, bids: [], closes, team: -1, level: best!.level };
  return best!;
}

const bid = (s: MatchState, p: number, city: number, cash: number): SimEvent[] => run(s, 1 / TICK_RATE, [{ t: 'contract', p, city, bid: cash }]);
const rejected = (ev: SimEvent[]) => ev.some((e) => e.e === 'reject');

describe('city contracts', () => {
  it('a fairly placed neutral city posts a job on time, the same in every run, and it lapses unfilled', () => {
    const s = match({}, 2), t = match({}, 2);
    run(s, CONTRACTS.first - 2);
    expect(s.contract).toBe(null);
    const ev = run(s, 3);
    run(t, CONTRACTS.first + 1);
    expect(ev.some((e) => e.e === 'contract')).toBe(true);
    expect(s.contract).toEqual(t.contract);
    const c = s.cities[s.contract!.city];
    expect(c.owner).toBe(-1);
    // nobody's doorstep: the two HQs are about as far from it
    const d = [0, 1].map((p) => { const hq = hqOf(s, p)!; return Math.hypot(hq.x - c.x, hq.y - c.y); });
    expect(Math.abs(d[0] - d[1]) / ((d[0] + d[1]) / 2)).toBeLessThanOrEqual(CONTRACTS.maxSpread);
    // hold jobs only at small cities
    if (s.contract!.kind === 'hold') expect(c.level).toBeLessThanOrEqual(CONTRACTS.holdMaxLevel);
    // nobody takes it up (passive players): it closes, and the next comes later
    const end = run(s, CONTRACTS.open + 1);
    expect(end.some((e) => e.e === 'contractEnd')).toBe(true);
    expect(s.contract).toBe(null);
    run(s, CONTRACTS.every + 1);
    expect(s.contract).not.toBe(null);
  });

  it('supply: a tender is open from the posting, each bid tops the last, and the highest buys the city', () => {
    const s = match({}, 2);
    const c = job(s, 'supply');
    const floor = supplyFloor(c);
    s.players[0].cash = s.players[1].cash = 5000;
    // no unit there yet
    expect(rejected(bid(s, 0, c.id, floor))).toBe(true);
    add(s, 'rifleman', 0, c.x + 1.5, c.y + 0.5);
    // a city taking bids can't be captured meanwhile
    run(s, 40);
    expect(c.owner).toBe(-1);
    expect(c.cap).toBe(0);
    add(s, 'rifleman', 1, c.x - 0.5, c.y + 1.5);
    // under the floor
    expect(rejected(bid(s, 0, c.id, floor - 1))).toBe(true);
    const first = bid(s, 0, c.id, floor);
    expect(first.some((e) => e.e === 'bid' && e.p === 0 && e.cash === floor)).toBe(true);
    expect(s.contract!.closes).toBeGreaterThan(s.tick);
    // a raise must beat the top bid by CONTRACTS.raise
    expect(minBid(s)).toBe(Math.ceil(floor * (1 + CONTRACTS.raise)));
    expect(rejected(bid(s, 1, c.id, floor + 1))).toBe(true);
    expect(rejected(bid(s, 1, c.id, minBid(s)))).toBe(false);
    // the top bidder can't bid against themself; P0 answers
    expect(rejected(bid(s, 1, c.id, minBid(s)))).toBe(true);
    const top = minBid(s);
    expect(rejected(bid(s, 0, c.id, top))).toBe(false);
    const cash0 = s.players[0].cash, cash1 = s.players[1].cash;
    // (run to the close, so the city's income afterwards doesn't count)
    const ev: SimEvent[] = [];
    while (s.contract) ev.push(...run(s, 1 / TICK_RATE));
    expect(ev.some((e) => e.e === 'contractDone' && e.p === 0 && e.kind === 'supply' && e.cash === top)).toBe(true);
    expect(c.owner).toBe(0);
    expect(s.contract).toBe(null);
    // the winner paid; the loser paid nothing (both earned the same meanwhile, give or take the city's last second)
    const paid = (s.players[1].cash - cash1) - (s.players[0].cash - cash0);
    expect(Math.abs(paid - top)).toBeLessThan(10);
  });

  it('supply: a late bid pushes the close back, and borders that reach the city can bid without a unit', () => {
    const s = match({}, 2);
    const c = job(s, 'supply');
    s.players[0].cash = s.players[1].cash = 5000;
    // P1's borders reach the city (they hold a city next to it); P0 has a unit there
    const next = s.cities.filter((k) => k.id !== c.id).sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
    next.owner = 1;
    next.level = 4;
    expect(Math.hypot(next.x - c.x, next.y - c.y)).toBeLessThan(HOME_FRONT.cityBase + HOME_FRONT.perLevel * next.level);
    add(s, 'rifleman', 0, c.x + 1.5, c.y + 0.5);
    expect(rejected(bid(s, 1, c.id, supplyFloor(c)))).toBe(false);
    // P0 waits for the last seconds, then outbids: the tender runs on so P1 can answer
    run(s, CONTRACTS.tender - 3);
    expect(rejected(bid(s, 0, c.id, minBid(s)))).toBe(false);
    expect(s.contract!.closes - s.tick).toBeGreaterThanOrEqual(sec(CONTRACTS.late) - 1);
    run(s, CONTRACTS.late - 5);
    expect(rejected(bid(s, 1, c.id, minBid(s)))).toBe(false);
    run(s, CONTRACTS.late + 1);
    expect(c.owner).toBe(1);
  });

  it('supply: a tender nobody bids on lapses at its close', () => {
    const s = match({}, 2);
    const c = job(s, 'supply');
    const ev = run(s, CONTRACTS.tender + 1);
    expect(ev.some((e) => e.e === 'contractEnd' && e.city === c.id)).toBe(true);
    expect(s.contract).toBe(null);
    expect(c.owner).toBe(-1);
  });

  it('supply: a winner who can no longer pay loses the city to the next bid', () => {
    const s = match({}, 2);
    const c = job(s, 'supply');
    s.players[0].cash = s.players[1].cash = 5000;
    add(s, 'rifleman', 0, c.x + 1.5, c.y + 0.5);
    add(s, 'rifleman', 1, c.x - 0.5, c.y + 1.5);
    bid(s, 1, c.id, supplyFloor(c));
    bid(s, 0, c.id, minBid(s));
    s.players[0].cash = 0;
    run(s, CONTRACTS.tender + 1);
    expect(c.owner).toBe(1);
  });

  it('supply: a city taken by force ends the job', () => {
    const s = match({}, 2);
    const c = job(s, 'supply');
    c.owner = 1;
    const ev = run(s, 1);
    expect(ev.some((e) => e.e === 'contractEnd')).toBe(true);
    expect(s.contract).toBe(null);
  });

  it('hold: keeping the city a minute pays the holder, and a change of hands restarts the clock', () => {
    const s = match({}, 2);
    const c = job(s, 'hold');
    c.owner = 1;
    run(s, CONTRACTS.hold / 2);
    // P0 takes it over: P1's half minute is lost
    c.owner = 0;
    run(s, CONTRACTS.hold / 2 + 2);
    expect(s.contract).not.toBe(null);
    const cash = s.players[0].cash, cp = s.players[0].cp;
    const want = jobReward(s, 'hold');
    const ev = run(s, CONTRACTS.hold / 2);
    const done = ev.find((e) => e.e === 'contractDone');
    expect(done && done.e === 'contractDone' && done.p).toBe(0);
    expect(s.players[0].cash - cash).toBeGreaterThanOrEqual(want.cash);
    expect(s.players[0].cp).toBeGreaterThan(cp);
    expect(s.contract).toBe(null);
    // a bigger city pays more
    expect(jobReward(s, 'hold', 3).cash - jobReward(s, 'hold', 1).cash).toBe(2 * CONTRACTS.holdPerLevel);
  });

  it('liberate: with no neutral city left, a runaway leader\'s city carries a bounty, and its taker is paid', () => {
    const s = match({}, 3);
    // P0 runs away: most cities and every tech; P1 and P2 hold the rest
    s.cities.forEach((c, i) => { c.owner = i % 4 === 3 ? 1 + (i % 2) : 0; c.level = 3; });
    s.players[0].techs = TECHS.map((t) => t.id);
    s.nextContract = s.tick;
    const ev = run(s, 1);
    const posted = ev.find((e) => e.e === 'contract');
    expect(posted && posted.e === 'contract' && posted.kind).toBe('liberate');
    const c = s.cities[s.contract!.city];
    expect(c.owner).toBe(0);
    const cash = s.players[2].cash;
    capture(s, c, 2, []);
    expect(c.level).toBe(2); // a capture costs a level...
    const paid = run(s, 1);
    expect(paid.some((e) => e.e === 'contractDone' && e.p === 2 && e.kind === 'liberate')).toBe(true);
    expect(s.players[2].cash - cash).toBeGreaterThanOrEqual(CONTRACTS.liberateCash);
    expect(c.level).toBe(3); // ...which a liberated city keeps
  });

  it('with two teams left, a leader\'s city carries no bounty', () => {
    const s = match({}, 2);
    s.cities.forEach((c, i) => { c.owner = i % 4 === 3 ? 1 : 0; c.level = 3; });
    s.players[0].techs = TECHS.map((t) => t.id);
    s.nextContract = s.tick;
    const ev = run(s, 1);
    expect(ev.some((e) => e.e === 'contract')).toBe(false);
    expect(s.contract).toBe(null);
  });

  it('an AI with money to spare walks a unit in and wins a tender near home', () => {
    const s = match({}, 2);
    s.players[0].kind = 'ai';
    const ai = createAi(s, 0, 'normal');
    // the nearest neutral city to its HQ
    const hq = hqOf(s, 0)!;
    const c = s.cities.filter((k) => k.owner < 0).sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
    s.contract = { city: c.id, kind: 'supply', until: s.tick + sec(CONTRACTS.tender), holder: -1, since: 0, bids: [], closes: s.tick + sec(CONTRACTS.tender), team: -1, level: c.level };
    s.players[0].cash = 3000;
    const ev: SimEvent[] = [];
    for (let i = 0; i < (CONTRACTS.open + CONTRACTS.tender) * TICK_RATE && s.contract; i++) ev.push(...step(s, ai.think(s)));
    expect(ev.some((e) => e.e === 'bid' && e.p === 0)).toBe(true);
    expect(ev.some((e) => e.e === 'contractDone' && e.p === 0 && e.city === c.id)).toBe(true);
    expect(c.owner).toBe(0);
  });

  it('is off when the lobby turns it off', () => {
    const s = match({ contracts: false }, 2);
    run(s, CONTRACTS.first + 5);
    expect(s.contract).toBe(null);
  });
});
