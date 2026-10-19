// Debug: per player, buildings owned (not the HQ; unfinished ones count), cities owned, and the
// building cap, at a few marks over free-for-all AI matches. Shows whether the cap bites.
//   node scripts/run.mjs scripts/dev/buildcap.ts [--seeds 1-6] [--players 4] [--type pangaea] [--marks 5,10,20,30] [--ai normal]
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { buildingCap, buildingCount } from '../../src/sim/world';
import { TICK_RATE, type AiDifficulty, type Command, type MatchSetup } from '../../src/sim/types';
import { setup } from '../../tests/helpers';

export async function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const n = +opt('players', '4');
  const [a, b] = opt('seeds', '1-6').split('-').map(Number);
  const marks = opt('marks', '5,10,20,30').split(',').map(Number);
  const diff = opt('ai', 'normal') as AiDifficulty;
  for (let seed = a; seed <= b; seed++) {
    const st = setup({ seed, mapType: opt('type', 'pangaea') as MatchSetup['mapType'], mapSize: 'medium', weather: true, crates: true }, n);
    st.players.forEach((p) => { p.kind = 'ai'; p.ai = { difficulty: diff }; });
    const s = createMatch(st);
    const ais = s.players.map((p) => createAi(s, p.id, diff));
    const end = Math.max(...marks) * 60 * TICK_RATE;
    let peak = 0;
    const rows: string[] = [];
    while (!s.over && s.tick < end) {
      const cmds: Command[] = [];
      for (const ai of ais) cmds.push(...ai.think(s));
      step(s, cmds);
      if (s.tick % TICK_RATE === 0) for (const p of s.players) peak = Math.max(peak, buildingCount(s, p.id) / buildingCap(s, p.id));
      const m = marks.indexOf(s.tick / TICK_RATE / 60);
      if (m >= 0) rows.push(`  ${marks[m]}m: ` + s.players.map((p) => `${buildingCount(s, p.id)}/${buildingCap(s, p.id)} (${s.cities.filter((c) => c.owner === p.id).length}c)`).join('  '));
    }
    console.log(`seed ${seed}: peak use ${(peak * 100).toFixed(0)}% of cap`);
    for (const r of rows) console.log(r);
  }
}
