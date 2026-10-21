// Sandbox: human players never run short of cash, oil, science or CP; AI players play normally.
import { describe, expect, it } from 'vitest';
import { SANDBOX } from '../src/data/rules';
import { COMMAND } from '../src/data/powers';
import { match, run } from './helpers';

describe('sandbox', () => {
  it('keeps a human player topped up, finishes research at once, and leaves the AI alone', () => {
    const s = match({ sandbox: true });
    s.players[0].kind = 'human';
    run(s, 0.05);
    const me = s.players[0], ai = s.players[1];
    expect(me.cash).toBeGreaterThanOrEqual(SANDBOX.cash);
    expect(me.oil).toBeGreaterThanOrEqual(SANDBOX.oil);
    expect(me.cp).toBeGreaterThanOrEqual(COMMAND.max);
    expect(ai.cash).toBeLessThan(SANDBOX.cash);
    // spending doesn't dent it
    const hq = Object.values(s.ents).find((e) => e.t === 'b' && e.owner === 0 && e.kind === 'hq')!;
    run(s, 0.05, [{ t: 'train', p: 0, at: hq.id, kind: 'builder', n: 5 }, { t: 'trade', p: 0, trade: 'buyOil' }]);
    expect(me.cash).toBeGreaterThanOrEqual(SANDBOX.cash);
    // research: a tech done the next tick
    run(s, 0.05, [{ t: 'research', p: 0, tech: 'deepMining' }]);
    run(s, 0.1);
    expect(me.techs).toContain('deepMining');
  });

  it('is off unless asked for', () => {
    const s = match();
    s.players[0].kind = 'human';
    run(s, 0.05);
    expect(s.players[0].cash).toBeLessThan(SANDBOX.cash);
  });
});
