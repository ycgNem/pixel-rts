// Debug: one player's research commands and completions in the personality test match.
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { TICK_RATE, type AiPersonality, type Command } from '../../src/sim/types';
import { setup } from '../../tests/helpers';

export async function main(args: string[]) {
  const who = +(args[0] ?? 3);
  const styles: (AiPersonality | undefined)[] = [undefined, 'militarist', 'expansionist', 'scientist'];
  const st = setup({ seed: 3, mapType: 'pangaea', weather: true, crates: true }, 4);
  st.players.forEach((p, i) => { p.kind = 'ai'; p.ai = { difficulty: 'normal', personality: styles[i] }; });
  const s = createMatch(st);
  const ais = s.players.map((p) => createAi(s, p.id, 'normal', styles[p.id]));
  while (s.tick < 420 * TICK_RATE) {
    const cmds: Command[] = [];
    for (const ai of ais) cmds.push(...ai.think(s));
    for (const c of cmds) if (c.p === who && (c.t === 'research' || c.t === 'cancelResearch')) console.log(`${(s.tick / TICK_RATE).toFixed(0)}s cmd`, JSON.stringify(c), 'cur', s.players[who].research.cur, 'queue', s.players[who].research.queue.join());
    for (const e of step(s, cmds)) if ((e.e === 'researched' || e.e === 'reject') && e.p === who) console.log(`${(s.tick / TICK_RATE).toFixed(0)}s`, JSON.stringify(e));
  }
}
