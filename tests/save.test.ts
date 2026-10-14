// Saved games (M15): a save is the whole MatchState, so loading it gives the identical match.
import { describe, expect, it } from 'vitest';
import { createMatch, step, stateHash } from '../src/sim/match';
import { createAi } from '../src/sim/ai';
import { decodeSave, encodeSave, SAVE_VERSION } from '../src/app/saves';
import type { Command } from '../src/sim/types';
import { TICK_RATE } from '../src/sim/types';
import { setup } from './helpers';

describe('saved games', () => {
  it('save → load gives an identical state that plays on identically', () => {
    const st = setup({ seed: 11, weather: true, crates: true }, 3);
    st.players.forEach((p) => { p.kind = 'ai'; p.ai = { difficulty: 'normal' }; });
    const s = createMatch(st);
    const ais = s.players.map((p) => createAi(s, p.id, 'normal'));
    for (let i = 0; i < 4 * 60 * TICK_RATE; i++) {
      const cmds: Command[] = [];
      for (const ai of ais) cmds.push(...ai.think(s));
      step(s, cmds);
    }
    const f = decodeSave(encodeSave(s, 1, 123))!;
    expect(f).not.toBeNull();
    expect(f.me).toBe(1);
    expect(stateHash(f.state)).toBe(stateHash(s));
    // the same commands from here give the same match
    for (let i = 0; i < 60 * TICK_RATE; i++) {
      const cmds: Command[] = i % 40 ? [] : [{ t: 'research', p: 0, tech: 'deepMining' }];
      step(s, cmds);
      step(f.state, cmds);
    }
    expect(stateHash(f.state)).toBe(stateHash(s));
  });

  it('refuses saves from another version and anything that is not a save', () => {
    const s = createMatch(setup());
    const ok = encodeSave(s, 0, 1);
    expect(decodeSave(ok)).not.toBeNull();
    expect(decodeSave(ok.replace(`"v":${SAVE_VERSION}`, `"v":${SAVE_VERSION + 1}`))).toBeNull();
    for (const bad of [null, '', 'not json', '{}', '[]', JSON.stringify({ v: SAVE_VERSION, me: 5, at: 1, state: s })]) expect(decodeSave(bad)).toBeNull();
  });
});
