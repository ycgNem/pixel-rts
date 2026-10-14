// HQ trace: in a 1v1 AI match, who damages player p's HQ, and what the attacker's wave was after.
//   node scripts/run.mjs scripts/dev/hqtrace.ts [--seed 3] [--levels easy,normal] [--p 0]
import { createMatch, step } from '../../src/sim/match';
import { createAi } from '../../src/sim/ai';
import { TICK_RATE, type AiDifficulty, type Command } from '../../src/sim/types';
import { setup } from '../../tests/helpers';

export async function main(args: string[]) {
  const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const levels = opt('levels', 'easy,normal').split(',') as AiDifficulty[];
  const who = +opt('p', '0');
  const st = setup({ seed: +opt('seed', '3'), mapType: 'pangaea', mapSize: 'small', weather: true, crates: true }, 2);
  st.players.forEach((p, i) => { p.kind = 'ai'; p.ai = { difficulty: levels[i] }; });
  const s = createMatch(st);
  const ais = s.players.map((p) => createAi(s, p.id, levels[p.id]));
  const hq = Object.values(s.ents).find((e) => e.t === 'b' && e.kind === 'hq' && e.owner === who)!;
  let hp = hq.hp;
  const t = () => (s.tick / TICK_RATE / 60).toFixed(2).padStart(6);
  while (!s.over && s.tick < 40 * 60 * TICK_RATE) {
    const cmds: Command[] = [];
    for (const ai of ais) cmds.push(...ai.think(s));
    step(s, cmds);
    if (!s.ents[hq.id]) { console.log(`${t()} HQ gone`); break; }
    if (hq.hp < hp - 1 && s.tick % (5 * TICK_RATE) === 0) {
      const shooters = Object.values(s.ents).filter((e) => e.owner >= 0 && e.owner !== who && e.tgt === hq.id);
      const kinds = new Map<string, number>();
      for (const e of shooters) kinds.set(`${e.kind}${e.t === 'u' && e.order ? ':' + e.order.o : ''}`, (kinds.get(`${e.kind}${e.t === 'u' && e.order ? ':' + e.order.o : ''}`) ?? 0) + 1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = (ais[1 - who] as any).wave;
      const target = w ? (w.target.city ? `city ${s.cities[w.target.id].name}` : w.target.spot ? 'spot' : s.ents[w.target.id]?.kind ?? '?') : 'no wave';
      console.log(`${t()} HQ ${Math.round(hq.hp)} (-${Math.round(hp - hq.hp)}); shooters ${[...kinds].map(([k, n]) => `${n}×${k}`).join(' ')}; wave: ${target}`);
      hp = hq.hp;
    }
  }
}
