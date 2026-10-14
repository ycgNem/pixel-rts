// City contracts (our twist, GAME_DESIGN §7): a city posts a public job, one at a time, at a place
// evenly placed between the players still in, so every match gets a focal point and a new player
// gets a goal.
// - supply: a tender. Players with a unit at the city, or whose borders reach it, bid; the
//   highest bid when it closes buys the city peacefully (a late bid adds time).
// - hold: take the city and keep it a minute for a reward.
// - liberate: when no neutral city fits, a runaway leader's city carries a bounty for whoever
//   takes it from them.
import { CONTRACTS } from '../data/rules';
import { UNITS } from '../data/units';
import { COMMAND } from '../data/powers';
import { CITY_LEVELS } from '../data/cities';
import type { City, Contract, ContractKind, MatchState, Player, SimEvent } from './types';
import { TICK_RATE } from './types';
import { hqOf, sec } from './world';
import { captureRadius, capture } from './cities';
import { rand } from './rng';
import { near } from './spatial';
import { score } from './victory';
import { claims } from './territory';

/** The lowest first bid for a supply tender at city c: a few minutes of its cash income. */
export function supplyFloor(c: City): number {
  return Math.round(CITY_LEVELS[c.level - 1].cash * 60 * CONTRACTS.floorMinutes);
}

/** The lowest bid the open supply tender takes now. */
export function minBid(s: MatchState): number {
  const k = s.contract;
  if (!k) return 0;
  const top = topBid(k);
  return top ? Math.ceil(top.cash * (1 + CONTRACTS.raise)) : supplyFloor(s.cities[k.city]);
}

/** The highest bid in a tender (the earlier of equal bids). */
export function topBid(k: Contract): { p: number; cash: number } | undefined {
  let best: { p: number; cash: number } | undefined;
  for (const b of k.bids) if (!best || b.cash > best.cash) best = b;
  return best;
}

/** What finishing a hold job (at a city of `level`) or a liberation pays now. */
export function jobReward(s: MatchState, kind: ContractKind, level = 1): { cash: number; cp: number } {
  const perMin = CONTRACTS.cashPerMin * (s.tick / TICK_RATE / 60);
  return kind === 'liberate'
    ? { cash: Math.round(CONTRACTS.liberateCash + perMin), cp: CONTRACTS.liberateCp }
    : { cash: Math.round(CONTRACTS.cash + CONTRACTS.holdPerLevel * (level - 1) + perMin), cp: CONTRACTS.cp };
}

/** Do player p's borders (the Home Front claim of one of their cities or their HQ) reach city c? */
export function bordersReach(s: MatchState, p: number, c: City): boolean {
  return claims(s).some((k) => k.owner === p && Math.hypot(k.x - c.x - 0.5, k.y - c.y - 0.5) <= k.r);
}

/** Does player p have a ground unit inside city c's capture ring? */
export function hasUnitAt(s: MatchState, p: number, c: City): boolean {
  let found = false;
  near(s, c.x + 0.5, c.y + 0.5, captureRadius(c), (e) => {
    if (found || e.t !== 'u' || e.owner !== p || e.inside || UNITS[e.kind].layer !== 'ground') return;
    if (Math.hypot(e.x - c.x - 0.5, e.y - c.y - 0.5) <= captureRadius(c)) found = true;
  }, 0);
  return found;
}

/** Why player p can't bid `cash` on the open supply tender at city c now (null = they can). */
export function bidBlocked(s: MatchState, p: Player, c: City | undefined, cash: number): string | null {
  const k = s.contract;
  if (!k || k.kind !== 'supply' || !c || k.city !== c.id) return 'that city has no supply contract open';
  if (!p.alive) return 'you are out of the match';
  const top = topBid(k);
  if (top?.p === p.id) return 'yours is the top bid';
  const least = minBid(s);
  if (cash < least) return `the bid must be at least $${least}`;
  if (p.cash < cash) return `you need $${cash}`;
  if (!hasUnitAt(s, p.id, c) && !bordersReach(s, p.id, c)) return `bring a ground unit inside ${c.name}'s ring first`;
  return null;
}

/** Record player p's bid (checked by the caller); a late one pushes the close back. */
export function placeBid(s: MatchState, p: Player, c: City, cash: number, ev: SimEvent[]) {
  const k = s.contract!;
  k.bids = k.bids.filter((b) => b.p !== p.id);
  k.bids.push({ p: p.id, cash });
  if (!k.closes) k.closes = s.tick + sec(CONTRACTS.tender);
  k.closes = Math.max(k.closes, s.tick + sec(CONTRACTS.late));
  k.until = Math.max(k.until, k.closes);
  ev.push({ e: 'bid', p: p.id, city: c.id, cash });
}

function close(s: MatchState) {
  s.contract = null;
  s.nextContract = s.tick + sec(CONTRACTS.every);
}

/** Where a player governs from: the HQ, or a capital in exile. */
function home(s: MatchState, p: Player): { x: number; y: number } | null {
  const hq = hqOf(s, p.id);
  if (hq) return { x: hq.x, y: hq.y };
  const c = p.capital >= 0 ? s.cities[p.capital] : undefined;
  return c ? { x: c.x + 0.5, y: c.y + 0.5 } : null;
}

/** Post a job: at a fairly placed neutral city, or else a bounty on a runaway leader's city. */
function post(s: MatchState, ev: SimEvent[]) {
  const living = s.players.filter((p) => p.alive);
  const homes = living.map((p) => home(s, p)).filter((h): h is { x: number; y: number } => !!h);
  if (!homes.length) { s.nextContract = s.tick + sec(CONTRACTS.every); return; }
  const dists = (c: City) => homes.map((h) => Math.hypot(h.x - c.x, h.y - c.y));
  // how unevenly placed: the gap between the farthest and the nearest home, against the average
  const spread = (c: City) => {
    const d = dists(c), mean = d.reduce((a, b) => a + b, 0) / d.length;
    return (Math.max(...d) - Math.min(...d)) / Math.max(1, mean);
  };
  const fair = s.cities.filter((c) => c.owner < 0 && c.cap === 0 && spread(c) <= CONTRACTS.maxSpread).sort((a, b) => spread(a) - spread(b) || a.id - b.id);
  let k: Contract | null = null;
  if (fair.length) {
    const c = fair[Math.floor(rand(s) * Math.min(CONTRACTS.choices, fair.length))];
    const kind: ContractKind = c.level <= CONTRACTS.holdMaxLevel && rand(s) < 0.5 ? 'hold' : 'supply';
    // a tender is open from the posting (bids can come in from the first second)
    const closes = kind === 'supply' ? s.tick + sec(CONTRACTS.tender) : 0;
    k = { city: c.id, kind, until: closes || s.tick + sec(CONTRACTS.open), holder: -1, since: 0, bids: [], closes, team: -1, level: c.level };
  } else {
    // nothing neutral fits: a runaway leader's city, the one nearest the others on average (only
    // with bountyTeams teams in: with two, the leader is everyone's target already)
    const teams = [...new Set(living.map((p) => p.team))].sort((a, b) => a - b);
    const avg = teams.reduce((a, t) => a + score(s, t), 0) / Math.max(1, teams.length);
    const lead = teams.find((t) => teams.length >= CONTRACTS.bountyTeams && score(s, t) > CONTRACTS.leaderOver * avg);
    if (lead !== undefined) {
      const others = living.filter((p) => p.team !== lead).map((p) => home(s, p)).filter((h): h is { x: number; y: number } => !!h);
      const reach = (c: City) => others.reduce((a, h) => a + Math.hypot(h.x - c.x, h.y - c.y), 0);
      const theirs = s.cities.filter((c) => c.owner >= 0 && s.players[c.owner].team === lead && s.players[c.owner].capital !== c.id).sort((a, b) => reach(a) - reach(b) || a.id - b.id);
      if (theirs.length) k = { city: theirs[0].id, kind: 'liberate', until: s.tick + sec(CONTRACTS.liberate), holder: -1, since: 0, bids: [], closes: 0, team: lead, level: theirs[0].level };
    }
  }
  if (!k) { s.nextContract = s.tick + sec(CONTRACTS.every); return; }
  s.contract = k;
  ev.push({ e: 'contract', city: k.city, kind: k.kind, until: k.until });
}

function pay(s: MatchState, p: Player, c: City, kind: ContractKind, ev: SimEvent[]) {
  const r = jobReward(s, kind, s.contract?.level ?? c.level);
  p.cash += r.cash;
  p.cp = Math.min(COMMAND.max, p.cp + r.cp);
  ev.push({ e: 'contractDone', p: p.id, city: c.id, kind, cash: r.cash, cp: r.cp });
  close(s);
}

export function stepContracts(s: MatchState, ev: SimEvent[]) {
  if (s.setup.contracts === false || s.tick % TICK_RATE !== 0) return;
  const k = s.contract;
  if (!k) {
    if (s.tick >= s.nextContract) post(s, ev);
    return;
  }
  const c = s.cities[k.city];
  if (k.kind === 'supply') {
    // taken by force: nobody is left to supply
    if (c.owner >= 0) { ev.push({ e: 'contractEnd', city: c.id }); close(s); return; }
    if (k.closes && s.tick >= k.closes) {
      // the highest bid that can still pay wins
      for (const b of [...k.bids].sort((x, y) => y.cash - x.cash || k.bids.indexOf(x) - k.bids.indexOf(y))) {
        const p = s.players[b.p];
        if (!p.alive || p.cash < b.cash) continue;
        p.cash -= b.cash;
        capture(s, c, p.id, ev);
        ev.push({ e: 'contractDone', p: p.id, city: c.id, kind: 'supply', cash: b.cash, cp: 0 });
        close(s);
        return;
      }
      ev.push({ e: 'contractEnd', city: c.id });
      close(s);
      return;
    }
    if (k.closes) return; // a tender runs to its close
  } else if (k.kind === 'hold') {
    if (c.owner !== k.holder) { k.holder = c.owner; k.since = s.tick; }
    const p = k.holder >= 0 ? s.players[k.holder] : undefined;
    if (p?.alive && s.tick - k.since >= sec(CONTRACTS.hold)) { pay(s, p, c, 'hold', ev); return; }
    // a hold under way (by a player still in) gets to finish
    if (p?.alive) return;
  } else {
    // liberated: taken from the leader by someone still in; the city keeps the size it had
    const p = c.owner >= 0 ? s.players[c.owner] : undefined;
    if (p && p.team !== k.team && p.alive) {
      c.level = Math.max(c.level, k.level);
      pay(s, p, c, 'liberate', ev);
      return;
    }
    if (p && p.team === k.team) k.level = c.level;
  }
  if (s.tick >= k.until) {
    ev.push({ e: 'contractEnd', city: c.id });
    close(s);
  }
}
