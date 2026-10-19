// Selling troops: a share of the cost back, less for damaged units (PRODUCTION.unitSellRefund).
import { describe, expect, it } from 'vitest';
import { UNITS } from '../src/data/units';
import { PRODUCTION } from '../src/data/rules';
import { unitCost } from '../src/sim/world';
import { add, match, openSpot, run } from './helpers';

describe('selling units', () => {
  it('refunds part of the cost, scaled by health, and only for the owner', () => {
    const s = match();
    const { x, y } = openSpot(s);
    const tank = add(s, 'lighttank', 0, x, y);
    const hurt = add(s, 'rifleman', 0, x + 1, y);
    hurt.hp = UNITS.rifleman.hp / 2;
    const theirs = add(s, 'rifleman', 1, x + 2, y);
    const p = s.players[0];
    const cash = p.cash, oil = p.oil, lost = p.stats.unitsLost;
    const tc = unitCost(s, 0, 'lighttank'), rc = unitCost(s, 0, 'rifleman');
    // one tick of income comes in too, so compare against the refund within a dollar
    run(s, 0.05, [{ t: 'sellUnits', p: 0, ids: [tank.id, hurt.id, theirs.id] }]);
    expect(s.ents[tank.id]).toBeUndefined();
    expect(s.ents[hurt.id]).toBeUndefined();
    expect(s.ents[theirs.id]).toBeDefined();
    const want = Math.floor(tc.cash * PRODUCTION.unitSellRefund) + Math.floor(rc.cash * PRODUCTION.unitSellRefund * 0.5);
    expect(p.cash - cash).toBeGreaterThanOrEqual(want);
    expect(p.cash - cash).toBeLessThan(want + 1);
    expect(p.oil - oil).toBeGreaterThanOrEqual(Math.floor(tc.oil * PRODUCTION.unitSellRefund));
    // a sale isn't a loss
    expect(p.stats.unitsLost).toBe(lost);
  });

  it("won't sell a loaded transport (its troops would go with it) or a merchant ship", () => {
    const s = match();
    const { x, y } = openSpot(s);
    const boat = add(s, 'transport', 0, x, y);
    const rider = add(s, 'rifleman', 0, x, y);
    rider.inside = boat.id;
    boat.cargo.push(rider.id);
    const merchant = add(s, 'merchant', 0, x + 2, y);
    const cash = s.players[0].cash;
    run(s, 0.05, [{ t: 'sellUnits', p: 0, ids: [boat.id, rider.id, merchant.id] }]);
    expect(s.ents[boat.id]).toBeDefined();
    expect(s.ents[rider.id]).toBeDefined();
    expect(s.ents[merchant.id]).toBeDefined();
    expect(s.players[0].cash - cash).toBeLessThan(1);
  });
});
