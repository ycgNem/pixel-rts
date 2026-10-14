// Duel story: how a 1v1 AI match ends (waves, the HQ falling, exile, the last city).
//   node scripts/run.mjs scripts/dev/duelstory.ts [--seed 1] [--levels easy,normal] [--size small]
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { armyValue } from '../../src/sim/lifecycle';
import { TICK_RATE, type AiDifficulty, type Command, type MatchSetup } from '../../src/sim/types';
import { setup } from '../../tests/helpers';

export async function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const levels = opt('levels', 'normal,normal').split(',') as AiDifficulty[];
  const st = setup({ seed: +opt('seed', '1'), mapType: 'pangaea', mapSize: opt('size', 'small') as MatchSetup['mapSize'], weather: true, crates: true }, 2);
  st.players.forEach((p, i) => { p.kind = 'ai'; p.ai = { difficulty: levels[i] }; });
  const s = createMatch(st);
  const ais = s.players.map((p) => createAi(s, p.id, levels[p.id]));
  const t = () => (s.tick / TICK_RATE / 60).toFixed(1).padStart(5);
  let lastHit = [-1e9, -1e9];
  while (!s.over && s.tick < 40 * 60 * TICK_RATE) {
    const cmds: Command[] = [];
    for (const ai of ais) cmds.push(...ai.think(s));
    for (const e of step(s, cmds)) {
      if (e.e === 'attacked' && s.tick - lastHit[e.p] > 60 * TICK_RATE) { lastHit[e.p] = s.tick; console.log(`${t()} P${e.p} attacked at ${e.x.toFixed(0)},${e.y.toFixed(0)}`); }
      if (e.e === 'die' && e.b) console.log(`${t()} P${e.owner} lost ${e.kind}`);
      if (e.e === 'capture') console.log(`${t()} P${e.owner} took ${s.cities[e.city].name} (L${s.cities[e.city].level}) from ${e.prev}`);
      if (e.e === 'exile') console.log(`${t()} P${e.p} exile at ${s.cities[e.city].name} (L${s.cities[e.city].level})`);
      if (e.e === 'eliminated' || e.e === 'over') console.log(`${t()} ${JSON.stringify(e)}`);
    }
    if (s.tick % (120 * TICK_RATE) === 0) console.log(`${t()} armies ${s.players.map((p) => Math.round(armyValue(s, p.id))).join(' / ')}; cities ${s.players.map((p) => s.cities.filter((c) => c.owner === p.id).map((c) => c.level).join('')).join(' / ')}; techs ${s.players.map((p) => p.techs.length).join('/')}`);
  }
}
