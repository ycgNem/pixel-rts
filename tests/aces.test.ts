// Wanted aces: one named ace per player, an aura around it, and a bounty on its head.
import { describe, expect, it } from 'vitest';
import { ACES } from '../src/data/rules';
import { UNITS } from '../src/data/units';
import { VETERANCY } from '../src/data/damage';
import { aceName, isAce } from '../src/sim/aces';
import { hurt, removeEnt } from '../src/sim/lifecycle';
import { unitMaxHp } from '../src/sim/world';
import type { MatchState, SimEvent, Unit } from '../src/sim/types';
import { add, match, openSpot, run } from './helpers';

const STARS = VETERANCY.thresholds.length;
/** Give a unit every star and this much xp. */
function star(u: Unit, xp = VETERANCY.thresholds[STARS - 1]) {
  u.vet = STARS;
  u.xp = xp;
  return u;
}
/** The ace events of a stretch of play. */
const acesIn = (ev: SimEvent[]) => ev.filter((e) => e.e === 'ace');

describe('wanted aces', () => {
  it('each player has one ace: their most experienced unit with every star, named', () => {
    const s = match();
    const at = openSpot(s);
    const a = star(add(s, 'rifleman', 0, at.x, at.y), 10);
    const b = star(add(s, 'rifleman', 0, at.x + 1, at.y), 20);
    star(add(s, 'rifleman', 0, at.x + 2, at.y), 1); // stars but less xp
    const ev = run(s, 1.05);
    expect(acesIn(ev).length).toBe(1);
    expect(isAce(s, b)).toBe(true);
    expect(isAce(s, a)).toBe(false);
    expect(aceName(s, b)).toMatch(/\w/);
    expect(aceName(s, a)).toBe('');
    // the title sticks, even when another unit catches up
    a.xp = 50;
    run(s, 2);
    expect(isAce(s, b)).toBe(true);
    // a rival's ace has another name
    const r = star(add(s, 'rifleman', 1, at.x, at.y + 6));
    run(s, 1.05);
    expect(isAce(s, r)).toBe(true);
    expect(aceName(s, r)).not.toBe(aceName(s, b));
  });

  it('a new ace gets a field promotion: healed to full, and tougher while it is the ace', () => {
    const s = match();
    const at = openSpot(s);
    const u = star(add(s, 'rifleman', 0, at.x, at.y), 20);
    const before = unitMaxHp(s, u);
    u.hp = 5;
    run(s, 1.05);
    expect(isAce(s, u)).toBe(true);
    expect(unitMaxHp(s, u)).toBe(Math.round(UNITS.rifleman.hp * (1 + STARS * VETERANCY.hpPerStar) * (1 + ACES.hp)));
    expect(unitMaxHp(s, u)).toBeGreaterThan(before);
    expect(u.hp).toBe(unitMaxHp(s, u));
  });

  it('allies near the ace hit harder; a starred unit that is not the ace gives nothing', () => {
    const s = match();
    const at = openSpot(s);
    const shooter = add(s, 'rifleman', 0, at.x, at.y);
    const target = add(s, 'heavytank', 1, at.x + 3, at.y);
    const hit = () => { target.hp = 1e6; shooter.vet = 0; shooter.xp = 0; hurt(s, target, 100, 'cannon', shooter, []); return 1e6 - target.hp; };
    const plain = hit();
    const ace = star(add(s, 'rifleman', 0, at.x, at.y + 2), 30);
    const spare = star(add(s, 'rifleman', 0, at.x + 1, at.y + 1), 5);
    run(s, 1.05);
    expect(isAce(s, ace)).toBe(true);
    shooter.x = at.x; shooter.y = at.y;
    expect(hit() / plain).toBeCloseTo(1 + ACES.aura);
    // out of its reach: the starred spare beside the shooter gives nothing
    ace.x = at.x; ace.y = at.y + ACES.radius + 2;
    expect(isAce(s, spare)).toBe(false);
    expect(hit() / plain).toBeCloseTo(1);
  });

  it('killing an ace pays its killer a bounty, and the next in line steps up under a new name', () => {
    const s = match();
    const at = openSpot(s);
    const ace = star(add(s, 'rifleman', 0, at.x, at.y), 30);
    const next = star(add(s, 'rifleman', 0, at.x + 1, at.y), 10);
    run(s, 1.05);
    const first = aceName(s, ace);
    const killer = add(s, 'rifleman', 1, at.x + 3, at.y);
    const p1 = s.players[1], cash = p1.cash, cp = p1.cp;
    const ev: SimEvent[] = [];
    hurt(s, ace, 1e6, 'cannon', killer, ev);
    const down = ev.find((e) => e.e === 'aceDown');
    expect(down && down.e === 'aceDown' && down.by).toBe(1);
    expect(down && down.e === 'aceDown' && down.name).toBe(first);
    expect(p1.cash - cash).toBeCloseTo(ACES.bountyCash);
    expect(p1.cp - cp).toBeCloseTo(ACES.bountyCp);
    expect(s.players[0].ace).toBe(-1);
    // no second announcement when the body is cleared, and the next ace steps up
    const later = run(s, 1.05);
    expect(later.some((e) => e.e === 'aceDown')).toBe(false);
    expect(isAce(s, next)).toBe(true);
    expect(aceName(s, next)).not.toBe(first);
  });

  it('an ace lost with no killing blow is announced, and nobody is paid', () => {
    const s = match();
    const at = openSpot(s);
    const ace = star(add(s, 'rifleman', 0, at.x, at.y));
    run(s, 1.05);
    const cash = s.players.map((p) => p.cash);
    const ev: SimEvent[] = [];
    removeEnt(s, ace, ev);
    const down = ev.find((e) => e.e === 'aceDown');
    expect(down && down.e === 'aceDown' && down.by).toBe(-1);
    expect(s.players.map((p) => p.cash)).toEqual(cash);
  });

  it('flak earns half the usual veterancy from aircraft', () => {
    const s = match();
    const at = openSpot(s);
    const flak = add(s, 'flaktrooper', 0, at.x, at.y);
    const plane = add(s, 'fighter', 1, at.x + 2, at.y);
    const max = unitMaxHp(s, plane);
    hurt(s, plane, 10, 'flak', flak, []);
    const done = max - plane.hp;
    const cost = (k: string) => UNITS[k].cost.cash + UNITS[k].cost.oil * 2;
    expect(flak.xp).toBeCloseTo((done / max) * (cost('fighter') / cost('flaktrooper')) * VETERANCY.vsAir);
  });

  it('survives a JSON round trip (the ace lives on the player)', () => {
    const s = match();
    const at = openSpot(s);
    star(add(s, 'rifleman', 0, at.x, at.y));
    run(s, 1.05);
    const t: MatchState = JSON.parse(JSON.stringify(s));
    expect(t.players[0].ace).toBe(s.players[0].ace);
    expect(t.players[0].aceNames).toEqual(s.players[0].aceNames);
  });
});
