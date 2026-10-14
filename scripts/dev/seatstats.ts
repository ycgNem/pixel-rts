// Debug: per start spot, the average cities, army value and cash income at a few marks over many
// free-for-all AI matches (to find which seats fall behind, and when).
//   node scripts/run.mjs scripts/dev/seatstats.ts [--seeds 1-8] [--players 4] [--size medium] [--marks 5,10,15] [--rot 0]
// --rot k gives player i the start spot of player (i + k) % n (geography moves, seat logic stays);
// the rows are per player.
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { armyValue } from '../../src/sim/lifecycle';
import { incomeOf } from '../../src/sim/economy';
import { TICK_RATE, type Command, type MatchSetup } from '../../src/sim/types';
import { setup } from '../../tests/helpers';

export async function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const n = +opt('players', '4');
  const [a, b] = opt('seeds', '1-8').split('-').map(Number);
  const marks = opt('marks', '5,10,15').split(',').map(Number);
  // [mark][seat] = [cities, army, income, alive]
  const sum = marks.map(() => Array.from({ length: n }, () => [0, 0, 0, 0]));
  let runs = 0;
  for (let seed = a; seed <= b; seed++) {
    const st = setup({ seed, mapType: 'pangaea', mapSize: opt('size', 'medium') as MatchSetup['mapSize'], weather: true, crates: true }, n);
    st.players.forEach((p) => { p.kind = 'ai'; p.ai = { difficulty: 'normal' }; });
    const s = createMatch(st);
    const rot = +opt('rot', '0');
    if (rot) {
      for (const e of Object.values(s.ents)) if (e.owner >= 0) e.owner = (e.owner - rot + n) % n;
      s.map.starts = s.map.starts.map((_, i) => s.map.starts[(i + rot) % n]);
    }
    const ais = s.players.map((p) => createAi(s, p.id, 'normal'));
    const end = Math.max(...marks) * 60 * TICK_RATE;
    while (!s.over && s.tick < end) {
      const cmds: Command[] = [];
      for (const ai of ais) cmds.push(...ai.think(s));
      step(s, cmds);
      const m = marks.indexOf(s.tick / TICK_RATE / 60);
      if (m >= 0)
        for (const p of s.players) {
          const r = sum[m][p.id];
          r[0] += s.cities.filter((c) => c.owner === p.id).length;
          r[1] += armyValue(s, p.id);
          r[2] += incomeOf(s, p.id).cash * 60;
          r[3] += p.alive ? 1 : 0;
        }
    }
    runs++;
  }
  marks.forEach((mk, m) => {
    console.log(`minute ${mk}:`);
    sum[m].forEach((r, i) => console.log(`  player ${i}: cities ${(r[0] / runs).toFixed(1)}  army ${Math.round(r[1] / runs)}  income ${Math.round(r[2] / runs)}/m  alive ${r[3]}/${runs}`));
  });
}
