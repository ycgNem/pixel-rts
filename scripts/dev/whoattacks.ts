// Debug: in a free-for-all, who sends waves at whom (counts of new waves by target owner).
//   node scripts/run.mjs scripts/dev/whoattacks.ts [--seeds 1,2,3] [--players 4] [--size medium] [--minutes 20]
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { TICK_RATE, type Command, type MatchSetup } from '../../src/sim/types';
import { setup } from '../../tests/helpers';

interface WaveLike { target: { id: number; city: boolean; spot?: boolean; help?: number } }

export async function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const n = +opt('players', '4');
  for (const seed of opt('seeds', '1,2,3').split(',').map(Number)) {
    const st = setup({ seed, mapType: 'pangaea', mapSize: opt('size', 'medium') as MatchSetup['mapSize'], weather: true, crates: true }, n);
    st.players.forEach((p) => { p.kind = 'ai'; p.ai = { difficulty: 'normal' }; });
    const s = createMatch(st);
    const ais = s.players.map((p) => createAi(s, p.id, 'normal'));
    const last: (WaveLike | null)[] = ais.map(() => null);
    const at: number[][] = ais.map(() => Array(n + 1).fill(0));
    while (!s.over && s.tick < +opt('minutes', '20') * 60 * TICK_RATE) {
      const cmds: Command[] = [];
      for (const ai of ais) cmds.push(...ai.think(s));
      step(s, cmds);
      ais.forEach((ai, i) => {
        const w = (ai as unknown as { wave: WaveLike | null }).wave;
        if (w && w !== last[i]) {
          const t = w.target;
          const o = t.help ? -1 : t.city ? s.cities[t.id].owner : t.spot ? t.id : s.ents[t.id]?.owner ?? -1;
          at[i][o < 0 ? n : o]++;
        }
        last[i] = w;
      });
    }
    console.log(`seed ${seed} (${(s.tick / 1200).toFixed(1)}m${s.over ? ', team ' + s.over.winners + ' won' : ''}) starts ${s.map.starts.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}`);
    at.forEach((row, i) => console.log(`  P${i} waves at: ${row.map((c, j) => `${j < n ? 'P' + j : 'neutral'} ${c}`).join(', ')}`));
  }
}
